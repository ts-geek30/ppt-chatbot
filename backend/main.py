from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
import os
import uuid
import json
import shutil

import logging
logging.basicConfig(level=logging.INFO)

load_dotenv()

from ppt_parser import parse_ppt, slides_to_prompt_str, slides_to_json
from agent import store_template, run_agent_stream, get_template, refine_slide, session_store
from ppt_creator import create_ppt_from_template, debug_template, scan_template
from ppt_preview import pptx_to_images

app = FastAPI(title="PPT Chatbot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

NVIDIA_API_KEY  = os.getenv("NVIDIA_API_KEY", "")
NVIDIA_BASE_URL = os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")
NVIDIA_MODEL    = os.getenv("NVIDIA_MODEL", "meta/llama-3.3-70b-instruct")

logging.info(f"[startup] model={NVIDIA_MODEL} base_url={NVIDIA_BASE_URL}")

# Stores original uploaded PPT file paths per session
template_file_store: dict[str, str] = {}
# Stores pre-computed shape maps per session (scanned at upload time)
shape_map_store: dict[str, list] = {}

UPLOAD_DIR = "/tmp/slideai_uploads"
PREVIEW_DIR = "/tmp/slideai_previews"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(PREVIEW_DIR, exist_ok=True)

# Serve preview images as static files
app.mount("/previews", StaticFiles(directory=PREVIEW_DIR), name="previews")


# --- New session ---
@app.get("/new-session")
def new_session():
    return {"session_id": str(uuid.uuid4())}


# --- Upload PPT Template ---
@app.post("/upload-template")
async def upload_template(file: UploadFile = File(...), session_id: str = Form(...)):
    if not file.filename.endswith(".pptx"):
        raise HTTPException(status_code=400, detail="Only .pptx files are supported")

    # Save permanently for this session (needed for PPT creation later)
    save_path = os.path.join(UPLOAD_DIR, f"{session_id}.pptx")
    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    slides = parse_ppt(save_path)
    slide_structure_str = slides_to_prompt_str(slides)

    store_template(session_id, slide_structure_str)
    template_file_store[session_id] = save_path

    # Pre-compute shape map at upload time so create/preview are fast and accurate
    shape_map = scan_template(save_path)
    shape_map_store[session_id] = shape_map

    return {
        "message": "Template uploaded and parsed successfully",
        "session_id": session_id,
        "slides_detected": len(slides),
        "slide_structure": slide_structure_str
    }

# --- Process Raw Data (streaming SSE) ---
class ProcessRequest(BaseModel):
    session_id: str
    raw_data: str


@app.post("/process-data")
async def process_data(request: ProcessRequest):
    if not NVIDIA_API_KEY:
        raise HTTPException(status_code=500, detail="NVIDIA_API_KEY not set on server")

    if not get_template(request.session_id):
        raise HTTPException(status_code=400, detail="No PPT template found. Please upload your PPT first.")

    async def event_stream():
        async for chunk in run_agent_stream(
            session_id=request.session_id,
            raw_data=request.raw_data,
            openai_api_key=NVIDIA_API_KEY,
            base_url=NVIDIA_BASE_URL,
            model=NVIDIA_MODEL
        ):
            yield f"data: {json.dumps(chunk)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# --- Create PPT from mapped slides ---
class CreatePPTRequest(BaseModel):
    session_id: str
    slides: list[dict]   # the slide mappings from /process-data result


@app.post("/create-ppt")
async def create_ppt(request: CreatePPTRequest):
    template_path = template_file_store.get(request.session_id)
    if not template_path or not os.path.exists(template_path):
        raise HTTPException(status_code=400, detail="Original template not found. Please re-upload your PPT.")

    try:
        output_path = create_ppt_from_template(
            template_path=template_path,
            slide_mappings=request.slides,
            output_dir="/tmp/slideai_outputs",
            shape_map=shape_map_store.get(request.session_id),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PPT creation failed: {str(e)}")

    return FileResponse(
        path=output_path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename="SlideAI_Output.pptx",
        background=None
    )


# --- Preview PPT as slide images ---
class PreviewRequest(BaseModel):
    session_id: str
    slides: list[dict]   # same slide mappings — we create a temp PPT then render it


@app.post("/preview-ppt")
async def preview_ppt(request: PreviewRequest):
    template_path = template_file_store.get(request.session_id)
    if not template_path or not os.path.exists(template_path):
        raise HTTPException(status_code=400, detail="Template not found. Please re-upload your PPT.")

    try:
        # Build the filled PPT into a temp location
        filled_path = create_ppt_from_template(
            template_path=template_path,
            slide_mappings=request.slides,
            output_dir="/tmp/slideai_outputs",
            shape_map=shape_map_store.get(request.session_id),
        )

        # Convert to images
        image_paths = pptx_to_images(filled_path, output_dir=PREVIEW_DIR)

        # Return public URLs for each slide image
        # Extract relative path from PREVIEW_DIR
        image_urls = []
        for p in image_paths:
            rel = os.path.relpath(p, PREVIEW_DIR)
            image_urls.append(f"/previews/{rel}")

        return {"slides": image_urls, "total": len(image_urls)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preview generation failed: {str(e)}")


# --- Refine a single slide via follow-up chat ---
class RefineSlideRequest(BaseModel):
    session_id: str
    slide_number: int
    slide_title: str
    current_content: str
    instruction: str
    chat_history: list = []


@app.post("/refine-slide")
async def refine_slide_endpoint(request: RefineSlideRequest):
    if request.session_id not in session_store:
        raise HTTPException(
            status_code=400,
            detail=f"Session '{request.session_id}' not found. Please upload a PPT template first."
        )

    try:
        refined_content = await refine_slide(
            session_id=request.session_id,
            slide_number=request.slide_number,
            slide_title=request.slide_title,
            current_content=request.current_content,
            instruction=request.instruction,
            chat_history=request.chat_history,
            openai_api_key=NVIDIA_API_KEY,
            base_url=NVIDIA_BASE_URL,
            model=NVIDIA_MODEL,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"LLM refinement failed: {str(e)}"
        )

    return {"refined_content": refined_content}


# --- Debug: inspect template placeholder structure ---
@app.get("/debug-template/{session_id}")
def debug_template_endpoint(session_id: str):
    template_path = template_file_store.get(session_id)
    if not template_path or not os.path.exists(template_path):
        raise HTTPException(status_code=404, detail="Template not found")
    return {"slides": debug_template(template_path)}


# --- Debug: test-write known content into template ---
@app.post("/debug-write/{session_id}")
def debug_write_endpoint(session_id: str):
    """
    Writes hardcoded test content into the template to verify ppt_creator works.
    Call this to isolate whether the issue is in the creator or the agent output.
    """
    template_path = template_file_store.get(session_id)
    if not template_path or not os.path.exists(template_path):
        raise HTTPException(status_code=404, detail="Template not found")

    from pptx import Presentation
    prs = Presentation(template_path)
    test_mappings = []
    for i, _ in enumerate(prs.slides):
        test_mappings.append({
            "slide_number":     i + 1,
            "slide_title":      f"TEST TITLE SLIDE {i+1}",
            "suggested_content": f"- Test bullet point one\n- Test bullet point two\n- Test bullet point three",
            "reason":           "debug test",
        })

    try:
        out = create_ppt_from_template(
            template_path=template_path,
            slide_mappings=test_mappings,
            output_dir="/tmp/slideai_outputs",
            shape_map=shape_map_store.get(session_id),
        )
        return {"output_path": out, "mappings_applied": len(test_mappings)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
