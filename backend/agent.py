"""
agent.py — Two-stage multi-agent pipeline for slide content mapping.

Stage 1 — Outline Agent:
  Input:  slide structure + raw data
  Output: JSON array of { slide_number, slide_type, topic, key_points[], char_limit }

Stage 2 — Content Agent (one call per slide, run concurrently):
  Input:  slide_type, topic, key_points, char_limit
  Output: { slide_title, suggested_content }  — plain text, within budget

This mirrors how Gamma/AiPPT work: outline first, then fill each slide in isolation.
"""
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser, JsonOutputParser
from langchain_core.messages import HumanMessage, AIMessage
from pydantic import BaseModel
from typing import Optional, AsyncGenerator
import asyncio
import json
import re

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _strip_markdown(text: str) -> str:
    text = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', text)
    text = re.sub(r'_{1,2}([^_]+)_{1,2}', r'\1', text)
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'`([^`]+)`', r'\1', text)
    text = re.sub(r'^\s*[-*•]\s+', '- ', text, flags=re.MULTILINE)
    return text.strip()


def _truncate_to_limit(text: str, limit: int) -> str:
    """Hard-truncate text to char limit, breaking at last newline if possible."""
    if len(text) <= limit:
        return text
    truncated = text[:limit]
    last_nl = truncated.rfind("\n")
    if last_nl > limit // 2:
        return truncated[:last_nl].rstrip()
    return truncated.rstrip() + "…"

# ---------------------------------------------------------------------------
# Session store
# ---------------------------------------------------------------------------

session_store: dict[str, str] = {}


def store_template(session_id: str, slide_structure: str):
    session_store[session_id] = slide_structure


def get_template(session_id: str) -> Optional[str]:
    return session_store.get(session_id)

# ---------------------------------------------------------------------------
# Stage 1 — Outline Agent
# ---------------------------------------------------------------------------

_OUTLINE_SYSTEM = """You are a presentation architect. Given a slide template structure and raw content, \
produce a structured outline that maps content to each slide.

For every slide in the structure output one JSON object. Rules:
1. slide_type must be one of: title, agenda, section, content, data, closing
2. topic: the main subject for this slide (short phrase)
3. key_points: array of strings — the actual content points to put on this slide
   - title/closing: 1 item max (tagline or closing message)
   - section/agenda: 1-5 short items
   - content: 3-5 bullet points
   - data: 2-4 key metrics or facts
4. char_limit: maximum characters for suggested_content (use the capacity hint from the structure)
5. EVERY slide in the structure must appear — if no content fits, use empty key_points []
6. NO markdown in key_points — plain text only
7. Return ONLY valid JSON, no explanation

Output format:
{{
  "outline": [
    {{
      "slide_number": 1,
      "slide_type": "title",
      "topic": "short topic phrase",
      "key_points": ["point 1", "point 2"],
      "char_limit": 300
    }}
  ]
}}"""

_OUTLINE_HUMAN = """Slide Structure:
{slide_structure}

Raw Content:
{raw_data}

Produce the outline JSON now."""


def _build_outline_chain(llm: ChatOpenAI):
    prompt = ChatPromptTemplate.from_messages([
        ("system", _OUTLINE_SYSTEM),
        ("human", _OUTLINE_HUMAN),
    ])
    return prompt | llm | JsonOutputParser()

# ---------------------------------------------------------------------------
# Stage 2 — Per-Slide Content Agent
# ---------------------------------------------------------------------------

_CONTENT_SYSTEM = """You are a slide content writer. Write the final text for a single PowerPoint slide.

Rules:
1. PLAIN TEXT ONLY — no markdown, no **bold**, no *italic*, no # headers, no backticks
2. Use plain hyphens (-) for bullet points if needed
3. Stay within the character limit provided
4. Be concise and presentation-ready — short punchy phrases, not paragraphs
5. Return ONLY a JSON object with slide_title and suggested_content, nothing else

Output format:
{{
  "slide_title": "Short title for the slide",
  "suggested_content": "Line 1\\nLine 2\\nLine 3"
}}"""

_CONTENT_HUMAN = """Slide type: {slide_type}
Topic: {topic}
Key points to include: {key_points}
Character limit for suggested_content: {char_limit}

Write the slide content now."""


def _build_content_chain(llm: ChatOpenAI):
    prompt = ChatPromptTemplate.from_messages([
        ("system", _CONTENT_SYSTEM),
        ("human", _CONTENT_HUMAN),
    ])
    return prompt | llm | JsonOutputParser()


async def _fill_slide(llm: ChatOpenAI, outline_item: dict) -> dict:
    """Run the content agent for a single slide outline item."""
    chain = _build_content_chain(llm)
    try:
        result = await chain.ainvoke({
            "slide_type":  outline_item.get("slide_type", "content"),
            "topic":       outline_item.get("topic", ""),
            "key_points":  json.dumps(outline_item.get("key_points", [])),
            "char_limit":  outline_item.get("char_limit", 350),
        })
        title   = _strip_markdown(str(result.get("slide_title", "")))
        content = _strip_markdown(str(result.get("suggested_content", "")))
        # Hard enforce char limit
        content = _truncate_to_limit(content, int(outline_item.get("char_limit", 350)))
        return {
            "slide_number":     outline_item["slide_number"],
            "slide_title":      title,
            "suggested_content": content,
            "reason":           outline_item.get("topic", ""),
        }
    except Exception as e:
        # Fallback: use key_points directly
        points  = outline_item.get("key_points", [])
        content = "\n".join(f"- {p}" for p in points) if points else ""
        return {
            "slide_number":     outline_item["slide_number"],
            "slide_title":      outline_item.get("topic", f"Slide {outline_item['slide_number']}"),
            "suggested_content": _truncate_to_limit(content, int(outline_item.get("char_limit", 350))),
            "reason":           f"fallback: {str(e)[:60]}",
        }

# ---------------------------------------------------------------------------
# Agent steps for streaming UI
# ---------------------------------------------------------------------------

AGENT_STEPS = [
    {"step": "reading",    "label": "Reading your raw data..."},
    {"step": "analyzing",  "label": "Analyzing slide structure..."},
    {"step": "mapping",    "label": "Building content outline..."},
    {"step": "refining",   "label": "Writing slide content..."},
]

# ---------------------------------------------------------------------------
# Main streaming pipeline
# ---------------------------------------------------------------------------

async def run_agent_stream(
    session_id: str,
    raw_data: str,
    openai_api_key: str,
    base_url: str = "https://integrate.api.nvidia.com/v1",
    model: str = "meta/llama-3.1-405b-instruct",
) -> AsyncGenerator[dict, None]:

    slide_structure = get_template(session_id)
    if not slide_structure:
        yield {"type": "error", "message": "No PPT template found for this session."}
        return

    # Stream step progress
    for i, step in enumerate(AGENT_STEPS):
        yield {"type": "step", "index": i, "step": step["step"], "label": step["label"]}
        await asyncio.sleep(0.3)

    llm = ChatOpenAI(
        model=model,
        temperature=0.1,      # low temp for consistent structured output
        api_key=openai_api_key,
        base_url=base_url,
    )

    # ── Stage 1: Outline ────────────────────────────────────────────────────
    try:
        outline_chain  = _build_outline_chain(llm)
        outline_result = await outline_chain.ainvoke({
            "slide_structure": slide_structure,
            "raw_data":        raw_data,
        })
        outline_items = outline_result.get("outline", [])
        if not outline_items:
            yield {"type": "error", "message": "Outline agent returned empty outline."}
            return
    except Exception as e:
        yield {"type": "error", "message": f"Outline stage failed: {str(e)}"}
        return

    # ── Stage 2: Fill each slide concurrently ───────────────────────────────
    try:
        tasks   = [_fill_slide(llm, item) for item in outline_items]
        results = await asyncio.gather(*tasks, return_exceptions=True)
    except Exception as e:
        yield {"type": "error", "message": f"Content stage failed: {str(e)}"}
        return

    # Collect results, handle any per-slide exceptions
    slides = []
    for item, res in zip(outline_items, results):
        if isinstance(res, Exception):
            slides.append({
                "slide_number":     item["slide_number"],
                "slide_title":      item.get("topic", f"Slide {item['slide_number']}"),
                "suggested_content": "",
                "reason":           f"error: {str(res)[:60]}",
            })
        else:
            slides.append(res)

    # Sort by slide_number and deduplicate
    seen: set[int] = set()
    final: list[dict] = []
    for s in sorted(slides, key=lambda x: x["slide_number"]):
        n = s["slide_number"]
        if n not in seen:
            final.append(s)
            seen.add(n)

    yield {"type": "result", "data": {"slides": final}}

# ---------------------------------------------------------------------------
# Slide refinement (single-slide follow-up chat)
# ---------------------------------------------------------------------------

async def refine_slide(
    session_id: str,
    slide_number: int,
    slide_title: str,
    current_content: str,
    instruction: str,
    chat_history: list[dict],
    openai_api_key: str,
    base_url: str = "https://integrate.api.nvidia.com/v1",
    model: str = "meta/llama-3.1-405b-instruct",
) -> str:
    llm = ChatOpenAI(
        model=model,
        temperature=0.2,
        api_key=openai_api_key,
        base_url=base_url,
    )

    prompt = ChatPromptTemplate.from_messages([
        (
            "system",
            "You are a presentation content assistant focused on a single slide.\n"
            "Refine the slide content based on the user's instruction.\n"
            "Return only the refined content as plain text — no JSON, no markdown, no commentary.\n\n"
            f"Slide {slide_number} — \"{slide_title}\":\n{current_content}",
        ),
        MessagesPlaceholder(variable_name="chat_history"),
        ("human", "{instruction}"),
    ])

    history_messages = []
    for msg in chat_history:
        role    = msg.get("role", "")
        content = msg.get("content", "")
        if role == "user":
            history_messages.append(HumanMessage(content=content))
        elif role == "assistant":
            history_messages.append(AIMessage(content=content))

    chain  = prompt | llm | StrOutputParser()
    result = await chain.ainvoke({
        "chat_history": history_messages,
        "instruction":  instruction,
    })
    return result
