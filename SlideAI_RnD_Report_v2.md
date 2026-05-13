# SlideAI — Deep R&D Report v2
### Post-Implementation Review + Next-Level Improvements

---

## 1. Current State Assessment (Honest Audit)

### What's solid now
- 5-stage pipeline: Strategist → Writers → Validation → Correction → Formatter
- Layout intelligence wired in — LLM gets layout type + content rules per slide
- Deck context passed to every Content Writer — prevents cross-slide repetition
- Char capacity uses actual font size from shapes (not hardcoded 18pt)
- Refinement is char-limit aware — won't overflow text boxes
- LibreOffice preview runs in ProcessPoolExecutor — non-blocking
- Confidence scores per slide with visual flagging in UI
- Tone selector (General / Executive / Technical / Sales)

### What's still weak or missing

| Area | Problem | Severity |
|---|---|---|
| Content ingestion | Only accepts pasted text — no PDF, DOCX, URL, CSV | High |
| Session persistence | In-memory dict — server restart kills all sessions | High |
| LLM reliability | JsonOutputParser fails silently on malformed JSON — no retry | High |
| Streaming accuracy | Steps stream before work starts — UI shows "Validating" before validation runs | Medium |
| ppt_creator | Only writes to ONE body shape per slide — multi-column/two-column layouts ignored | High |
| Template feedback | User gets no visual feedback on what the template looks like before mapping | Medium |
| Slide reorder/delete | No way to reorder or remove slides after mapping | Medium |
| History | Chat history lost on page refresh — localStorage only stores session_id | Medium |
| Rate limiting | No rate limiting on any endpoint — easy to abuse | Medium |
| Temp file cleanup | /tmp/slideai_uploads and /tmp/slideai_outputs grow forever | Low |
| Error UX | Generic "Connection error" on SSE failure — no retry button | Low |

---

## 2. Accuracy Improvements — Deep Analysis

### 2.1 LLM Output Reliability (Critical)

**Current problem:** `JsonOutputParser` from LangChain throws an exception if the LLM
returns malformed JSON (e.g., trailing commas, truncated output, markdown code fences).
The current code catches this at the stage level and returns an error to the user.
For a 10-slide deck, one bad JSON response kills the entire run.

**Root cause:** NVIDIA Llama models occasionally wrap JSON in markdown code fences
(` ```json ... ``` `) or add commentary before/after the JSON object.

**Fix — Robust JSON extraction with retry:**
```python
import re, json

def _extract_json(text: str) -> dict:
    """Extract JSON from LLM output even if wrapped in markdown or has commentary."""
    # Strip markdown code fences
    text = re.sub(r'^```(?:json)?\s*', '', text.strip(), flags=re.MULTILINE)
    text = re.sub(r'```\s*$', '', text.strip(), flags=re.MULTILINE)
    # Try direct parse first
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    # Find the first { ... } or [ ... ] block
    for pattern in [r'\{.*\}', r'\[.*\]']:
        match = re.search(pattern, text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
    raise ValueError(f"Could not extract JSON from: {text[:200]}")

# Replace JsonOutputParser with a custom parser that uses _extract_json
# Add retry: if parse fails, re-invoke the LLM with "Return ONLY valid JSON, no commentary"
```

**Add retry logic to each stage:**
```python
async def _invoke_with_retry(chain, inputs: dict, max_retries: int = 2) -> dict:
    last_error = None
    for attempt in range(max_retries + 1):
        try:
            return await chain.ainvoke(inputs)
        except Exception as e:
            last_error = e
            if attempt < max_retries:
                await asyncio.sleep(0.5 * (attempt + 1))  # backoff
    raise last_error
```

---

### 2.2 Multi-Shape Slide Writing (Critical)

**Current problem:** `ppt_creator.py` only writes to ONE title shape and ONE body shape
per slide. Two-column layouts, comparison slides, and KPI slides have 2–4 content areas.
The second column is always left blank.

**Fix — Multi-body shape support:**
```python
# In scan_template(), collect ALL body shapes, not just the first one
entry["body_shape_names"] = []  # list instead of single name

# In create_ppt_from_template(), split content across body shapes
# For two_column: split content_lines at midpoint → left column / right column
# For kpi: each KPI metric gets its own shape
# For comparison: left side vs right side split at "vs" or "---" separator

def _split_content_for_layout(lines: list[str], layout_type: str, n_bodies: int) -> list[list[str]]:
    if n_bodies <= 1 or layout_type not in ("two_column", "comparison", "kpi"):
        return [lines]
    mid = len(lines) // n_bodies
    return [lines[i*mid:(i+1)*mid] for i in range(n_bodies)]
```

---

### 2.3 Content Ingestion — Multi-Source Input

**Current problem:** Users can only paste raw text. Real-world use cases:
- Upload a PDF report → extract text → map to slides
- Paste a URL → scrape the page → map to slides
- Upload a CSV → parse rows → map to a data/table slide
- Upload a Word doc → extract paragraphs → map to slides

**Proposed `content_ingestion.py` module:**
```python
# Supported sources:
# 1. Plain text (current)
# 2. PDF → pdfplumber or PyMuPDF
# 3. DOCX → python-docx
# 4. URL → httpx + BeautifulSoup
# 5. CSV → pandas (for data/KPI slides)

async def ingest_content(source: str, source_type: str = "text") -> str:
    """
    Normalize any input source to plain text for the agent pipeline.
    Returns structured text with section markers for better outline mapping.
    """
    if source_type == "text":
        return source
    elif source_type == "pdf":
        return _extract_pdf(source)   # source = file path
    elif source_type == "docx":
        return _extract_docx(source)
    elif source_type == "url":
        return await _scrape_url(source)
    elif source_type == "csv":
        return _parse_csv_to_text(source)  # formats as "Key: Value" pairs
```

**New API endpoint:**
```python
@app.post("/upload-content")
async def upload_content(
    file: UploadFile = File(None),
    url: str = Form(None),
    session_id: str = Form(...),
):
    """Accept PDF, DOCX, CSV, or URL as content source."""
```

---

### 2.4 Semantic Content Chunking (Agent Accuracy)

**Current problem:** The Strategist Agent receives raw unstructured text and has to
simultaneously understand the content AND decide which slide it belongs to.
This is too much for one LLM call — it leads to poor distribution decisions.

**Fix — Pre-processing Content Analyst Agent:**
```
Raw text
    ↓
Content Analyst Agent (new Stage 0)
    ├── Splits text into semantic chunks
    ├── Tags each chunk: { text, type: fact|stat|narrative|quote|list, importance: 1-5 }
    ├── Identifies key entities: company names, numbers, dates, products
    └── Output: ranked_chunks[] sorted by importance

ranked_chunks[]
    ↓
Strategist Agent (Stage 1) — now only needs to assign chunks to slides
```

**Why this works:** Separating "understand the content" from "map to slides" gives
each agent a single, well-defined job. The Strategist becomes much more accurate
because it's working with pre-labelled chunks rather than raw prose.

---

### 2.5 Streaming Accuracy Fix

**Current problem:** The pipeline yields all 5 step events at the start with
`asyncio.sleep(0.2)` delays, then does the actual work. The UI shows "Validating"
before validation has actually started. This is misleading.

**Fix:** Yield each step event immediately BEFORE the corresponding work starts,
and yield a "step_done" event after it completes:

```python
# Current (wrong):
yield {"type": "step", "step": "validating", ...}
await asyncio.sleep(0.2)
# ... then do the actual work later

# Correct:
yield {"type": "step", "step": "validating", "status": "running", ...}
validation_report = await _validate_slides(...)
yield {"type": "step", "step": "validating", "status": "done", ...}
```

Frontend should track both `running` and `done` states per step.

---

### 2.6 Template Visual Preview at Upload

**Current problem:** Users upload a template and immediately see a text-based
slide structure. They have no visual confirmation that the right file was uploaded
or what the template looks like.

**Fix:** Generate thumbnail previews of the template at upload time (not just
after content is mapped). Return the first 3 slide thumbnails in the upload response.
The `UploadTemplate` component can show them as a preview strip.

```python
# In upload_template():
# After scan_template(), generate thumbnails of the original template
thumbnail_paths = pptx_to_images(save_path, output_dir=PREVIEW_DIR, max_slides=3)
thumbnail_urls = [f"/previews/{os.path.relpath(p, PREVIEW_DIR)}" for p in thumbnail_paths]
return { ..., "template_thumbnails": thumbnail_urls }
```

---

### 2.7 Session Persistence

**Current problem:** All session data lives in Python dicts. A server restart
(or Uvicorn reload) wipes everything. Users lose their template and have to re-upload.

**Fix — SQLite-backed session store (no Redis dependency):**
```python
import sqlite3, json, os

DB_PATH = "/tmp/slideai_sessions.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            slide_structure TEXT,
            template_path TEXT,
            char_limits TEXT,
            created_at REAL
        )
    """)
    conn.commit()
    conn.close()

def save_session(session_id: str, data: dict):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?, ?)
    """, (session_id, data["slide_structure"], data["template_path"],
          json.dumps(data["char_limits"]), time.time()))
    conn.commit()
    conn.close()

def load_session(session_id: str) -> dict | None:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {
        "slide_structure": row[1],
        "template_path":   row[2],
        "char_limits":     json.loads(row[3]),
    }
```

---

### 2.8 Temp File Cleanup

**Current problem:** Every PPT creation and preview generates files in `/tmp`.
These are never cleaned up. On a long-running server this fills disk.

**Fix — TTL-based cleanup on startup + background task:**
```python
import time, threading

def _cleanup_old_files(directory: str, max_age_hours: int = 24):
    """Delete files older than max_age_hours from directory."""
    cutoff = time.time() - (max_age_hours * 3600)
    for root, dirs, files in os.walk(directory, topdown=False):
        for f in files:
            path = os.path.join(root, f)
            if os.path.getmtime(path) < cutoff:
                os.remove(path)
        for d in dirs:
            dpath = os.path.join(root, d)
            try:
                os.rmdir(dpath)  # only removes if empty
            except OSError:
                pass

@app.on_event("startup")
async def startup_cleanup():
    # Clean up old files on startup
    for d in [UPLOAD_DIR, PREVIEW_DIR, "/tmp/slideai_outputs"]:
        _cleanup_old_files(d, max_age_hours=24)
```

---

## 3. Advanced Agent Architecture — Next Level

### 3.1 Retrieval-Augmented Content Mapping (RAG)

**The idea:** Instead of sending all raw content to the LLM at once, build a
vector index of the content chunks and retrieve only the most relevant chunks
for each slide. This:
- Handles very long documents (10,000+ words) without hitting context limits
- Improves accuracy by giving each slide agent only the content it needs
- Enables "content library" — users can build up a corpus over time

```
Content chunks → Embed with sentence-transformers → FAISS index
                                                          ↓
Strategist produces outline with slide topics
                                                          ↓
For each slide: retrieve top-K chunks by cosine similarity to slide topic
                                                          ↓
Content Writer Agent receives only the relevant chunks (not all raw data)
```

**Libraries needed:** `sentence-transformers`, `faiss-cpu`

---

### 3.2 Streaming Content Generation (Token-Level)

**Current:** Each Content Writer Agent returns a complete response before the
frontend sees anything. For a 10-slide deck, the user waits for all 10 concurrent
calls to finish before seeing any results.

**Improvement:** Stream each slide's content token-by-token as it's generated.
The frontend can render slides progressively — slide 1 appears while slides 2–10
are still being written.

```python
# Use LangChain's astream() instead of ainvoke()
async def _fill_slide_stream(llm, outline_item, deck_context, tone):
    async for chunk in chain.astream(inputs):
        yield {"type": "slide_token", "slide_number": n, "token": chunk}
```

---

### 3.3 Feedback Loop — User Ratings

**The idea:** After a user downloads a PPT, ask them to rate the output (1–5 stars).
Store the rating alongside the input data, slide structure, and output.
Use this to:
- Fine-tune prompts based on what worked
- Identify which layout types consistently get low ratings
- Build a dataset for future model fine-tuning

```python
@app.post("/rate-output")
async def rate_output(session_id: str, rating: int, feedback: str = ""):
    # Store in SQLite alongside the session data
    # Aggregate ratings by layout_type, tone, slide_count
```

---

### 3.4 Intelligent Slide Splitting

**Current problem:** When content is too long, the Strategist Agent is asked to
split it across slides. But it often doesn't — it just truncates.

**Fix — Deterministic overflow detection before the LLM:**
```python
def _detect_overflow(raw_data: str, slide_structure: list[dict]) -> dict:
    """
    Before calling the LLM, estimate if the content will overflow.
    Returns: { needs_extra_slides: bool, estimated_extra: int, content_density: float }
    """
    total_capacity = sum(s.get("layout_rules", {}).get("body_max_chars", 350)
                         for s in slide_structure)
    content_length = len(raw_data)
    density = content_length / max(total_capacity, 1)
    return {
        "needs_extra_slides": density > 1.5,
        "estimated_extra":    max(0, int((content_length - total_capacity) / 350)),
        "content_density":    round(density, 2),
    }
```

Pass this analysis to the Strategist Agent so it knows upfront how much splitting
is needed, rather than discovering it mid-generation.

---

### 3.5 Slide Dependency Graph

**The idea:** Some slides are semantically dependent on others.
A "Solution" slide should reference the "Problem" slide.
A "Results" slide should reference the "Approach" slide.

Build a dependency graph at outline time and pass it to Content Writers:

```python
# In the Strategist output, add:
{
  "slide_number": 4,
  "topic": "Our Solution",
  "depends_on": [2],  # Slide 2 is the Problem slide
  "reference_hint": "This slide directly addresses the problem stated in Slide 2"
}

# Content Writer for Slide 4 receives:
# - Its own outline item
# - The content of Slide 2 (the dependency)
# → Can write "Unlike the manual process described earlier, our platform..."
```

---

### 3.6 Template Intelligence — Image Placeholder Detection

**Current problem:** `ppt_creator.py` only handles text shapes. Many templates
have image placeholders (company logo, product screenshot, chart area).
These are currently ignored — the output PPT has blank image areas.

**Fix — Detect and report image placeholders:**
```python
# In scan_template(), also detect image shapes:
for shape in slide.shapes:
    if shape.is_placeholder:
        ph_type = shape.placeholder_format.type
        if ph_type in {8, 9, 10, 18}:  # PICTURE, CLIP_ART, BITMAP, MEDIA
            entry["image_placeholders"].append({
                "name": shape.name,
                "idx":  shape.placeholder_format.idx,
                "hint": "image area",
            })
```

Return image placeholder info to the frontend so users know which slides
need manual image insertion. Show a camera icon on those slide cards.

---

## 4. UX Improvements

### 4.1 Slide Reorder / Delete
After mapping, users need to be able to:
- Drag slides to reorder them
- Delete slides they don't want
- Duplicate a slide

This is pure frontend state management — no backend changes needed.
Use a simple drag-and-drop list (no library needed, just `draggable` HTML attribute).

### 4.2 Diff View in Refinement Chat
When a user refines a slide, show a before/after diff instead of just the new content.
Highlight added text in green, removed text in red (strikethrough).

```jsx
// Simple word-level diff
function DiffView({ before, after }) {
  // Split both into words, find additions/removals
  // Render with green/red highlights
}
```

### 4.3 Bulk Refinement
"Apply this instruction to ALL slides" — useful for tone changes.
Currently users have to open each slide individually.

```python
@app.post("/refine-all-slides")
async def refine_all_slides(request: RefineAllRequest):
    # Run refine_slide() concurrently for all slides
    # Same pattern as the Content Writer stage
```

### 4.4 Export to Google Slides
Use the Google Slides API to create a presentation directly in Google Drive.
This removes the download-and-upload friction for Google Workspace users.

### 4.5 Undo / Redo
Every time a user applies a refinement, push the previous state to an undo stack.
Simple array of slide states in React — no backend needed.

### 4.6 Content Length Indicator
Show a character count bar on each slide card — how full is the text box?
Green = within limit, amber = 80–100%, red = over limit.

---

## 5. Infrastructure & Production Readiness

### 5.1 Rate Limiting
```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@app.post("/process-data")
@limiter.limit("10/minute")
async def process_data(request: ProcessRequest):
    ...
```

### 5.2 File Size Validation
```python
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB

@app.post("/upload-template")
async def upload_template(file: UploadFile = File(...), ...):
    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(400, "File too large. Max 50 MB.")
    # Write content to disk instead of using shutil.copyfileobj
```

### 5.3 Health Check Endpoint
```python
@app.get("/health")
def health():
    return {
        "status": "ok",
        "sessions_active": len(session_store),
        "nvidia_key_set": bool(NVIDIA_API_KEY),
        "libreoffice_available": shutil.which("libreoffice") is not None,
    }
```

### 5.4 Request Timeout
```python
# Add timeout to all LLM calls
llm = ChatOpenAI(
    model=model,
    temperature=0.1,
    api_key=openai_api_key,
    base_url=base_url,
    request_timeout=30,  # 30 second timeout per LLM call
    max_retries=2,       # LangChain built-in retry
)
```

### 5.5 Structured Logging
Replace `logging.info(f"...")` with structured JSON logs:
```python
import structlog
logger = structlog.get_logger()
logger.info("slide_mapped", session_id=session_id, slide_number=n, confidence=conf)
```

---

## 6. Implementation Roadmap

### Sprint 1 — Reliability (1–2 days)
- [ ] Robust JSON extraction with retry (`_extract_json` + `_invoke_with_retry`)
- [ ] Fix streaming step accuracy (yield before/after each stage)
- [ ] SQLite session persistence
- [ ] Temp file cleanup on startup
- [ ] File size validation
- [ ] Health check endpoint
- [ ] LLM request timeout

### Sprint 2 — Accuracy (2–3 days)
- [ ] Multi-body shape support in `ppt_creator.py`
- [ ] Content Analyst Agent (Stage 0) — semantic chunking
- [ ] Overflow detection before LLM call
- [ ] Template thumbnail preview at upload
- [ ] Image placeholder detection and reporting

### Sprint 3 — Features (3–5 days)
- [ ] Multi-source content ingestion (PDF, DOCX, URL, CSV)
- [ ] Slide reorder / delete / duplicate UI
- [ ] Diff view in refinement chat
- [ ] Bulk refinement endpoint + UI
- [ ] Content length indicator on slide cards
- [ ] Undo / redo stack

### Sprint 4 — Scale (1 week)
- [ ] RAG-based content retrieval (sentence-transformers + FAISS)
- [ ] Token-level streaming for progressive slide rendering
- [ ] Slide dependency graph in outline
- [ ] User rating / feedback loop
- [ ] Rate limiting
- [ ] Structured logging

---

## 7. Biggest Single Impact Change

If you can only do one thing from this list:

**Implement robust JSON extraction with retry (Section 2.1)**

This is the most common failure mode in production LLM applications.
A single malformed JSON response from the LLM currently kills the entire pipeline
and shows the user an error. With retry + robust extraction, the pipeline becomes
dramatically more reliable without changing any of the agent logic.

Second biggest: **Multi-source content ingestion (Section 2.3)**
This is the feature users will ask for most — "can I just upload my PDF?"
It unlocks a completely new class of use cases and removes the biggest friction
point in the current workflow.

---
