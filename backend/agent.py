"""
agent.py — Six-stage multi-agent pipeline for slide content mapping.

Stage 0 — Content Analyst: chunks + ranks raw content
Stage 1 — Deck Strategist: maps chunks to slides with narrative arc
Stage 2 — Content Writers: concurrent per-slide writing
Stage 3 — Validation: quality review
Stage 4 — Self-Correction: targeted fixes (quality < 8 only)
Stage 5 — Formatter: no-LLM final pass
"""
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_core.messages import HumanMessage, AIMessage
from typing import Optional, AsyncGenerator
import asyncio, json, re, logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Robust JSON extraction + retry
# ---------------------------------------------------------------------------

def _extract_json(text) -> dict | list:
    """Extract JSON from LLM output even if wrapped in markdown or has commentary."""
    if isinstance(text, (dict, list)):
        return text
    cleaned = re.sub(r'^```(?:json)?\s*', '', str(text).strip(), flags=re.MULTILINE)
    cleaned = re.sub(r'```\s*$', '', cleaned.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    for pattern in [r'\{.*\}', r'\[.*\]']:
        m = re.search(pattern, cleaned, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                pass
    raise ValueError(f"Could not extract JSON: {cleaned[:300]}")


async def _invoke_with_retry(chain, inputs: dict, max_retries: int = 2):
    """Invoke a chain with automatic retry + exponential backoff."""
    last_error = None
    for attempt in range(max_retries + 1):
        try:
            raw = await chain.ainvoke(inputs)
            return _extract_json(raw) if not isinstance(raw, (dict, list)) else raw
        except Exception as e:
            last_error = e
            logger.warning(f"LLM attempt {attempt+1} failed: {e}")
            if attempt < max_retries:
                await asyncio.sleep(0.5 * (attempt + 1))
    raise last_error

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
    if len(text) <= limit:
        return text
    truncated = text[:limit]
    last_nl = truncated.rfind("\n")
    if last_nl > limit // 2:
        return truncated[:last_nl].rstrip()
    return truncated.rstrip() + "…"


def _build_deck_context(outline_items: list[dict]) -> str:
    return " | ".join(
        f"Slide {i['slide_number']} ({i.get('slide_type','content')}): {i.get('topic','')}"
        for i in outline_items
    )


def _detect_overflow(raw_data: str, slide_structure_str: str) -> dict:
    caps = re.findall(r'capacity=(\d+)', slide_structure_str)
    total_cap = sum(int(c) for c in caps) if caps else 2000
    density = len(raw_data) / max(total_cap, 1)
    return {
        "needs_extra_slides": density > 1.5,
        "estimated_extra":    max(0, int((len(raw_data) - total_cap) / 350)),
        "content_density":    round(density, 2),
    }

# ---------------------------------------------------------------------------
# Session store
# ---------------------------------------------------------------------------

session_store: dict[str, str] = {}

def store_template(session_id: str, slide_structure: str):
    session_store[session_id] = slide_structure

def get_template(session_id: str) -> Optional[str]:
    return session_store.get(session_id)

# ---------------------------------------------------------------------------
# Stage 0 — Content Analyst Agent
# ---------------------------------------------------------------------------

_ANALYST_SYSTEM = """You are a content analyst. Read raw text and extract structured content chunks.

For each distinct piece of information create a chunk:
- text: the actual content (max 150 chars)
- type: fact | stat | narrative | quote | list_item | heading
- importance: 1-5 (5 = must appear in the deck, 1 = filler)
- entities: key names, numbers, or terms

Rules:
- Split long paragraphs into individual chunks
- Stats and numbers are always importance 4-5
- Return 5-20 chunks maximum
- Return ONLY valid JSON, no commentary, no code fences

Output format:
{{"chunks": [{{"text": "...", "type": "stat", "importance": 5, "entities": ["..."]}}]}}"""

_ANALYST_HUMAN = "Analyse this content and return structured chunks:\n\n{raw_data}"

def _build_analyst_chain(llm):
    return ChatPromptTemplate.from_messages([
        ("system", _ANALYST_SYSTEM), ("human", _ANALYST_HUMAN)
    ]) | llm | StrOutputParser()

# ---------------------------------------------------------------------------
# Stage 1 — Deck Strategist Agent
# ---------------------------------------------------------------------------

_STRATEGIST_SYSTEM = """You are a presentation strategist. Map content chunks to slides with a clear narrative arc.

Rules:
1. NARRATIVE ARC: assign narrative_role: intro|problem|solution|evidence|data|roadmap|closing
2. CONTENT DENSITY: density > 1.5 means you MUST split content across extra slides
3. char_limit: use the capacity hint strictly - DO NOT EXCEED IT
4. SLIDE SPLITTING: continue slide_number sequence beyond template count if needed
5. slide_type: title, agenda, section, content, data, closing
6. layout_type: use the Type field from the slide structure (kpi, timeline, two_column, etc.)
7. CONFIDENCE: 0.0-1.0 - how well available chunks match this slide's purpose
8. EVERY slide in the template must be addressed
9. key_points must be plain text only - no markdown
10. Return ONLY valid JSON, no commentary, no code fences

Output format:
{{"outline": [{{"slide_number":1,"slide_type":"title","layout_type":"title","narrative_role":"intro","topic":"...","key_points":["..."],"char_limit":300,"confidence":0.9}}]}}"""

_STRATEGIST_HUMAN = """Slide Structure:
{slide_structure}

Content Chunks (ranked by importance):
{chunks_json}

Content Density Analysis: {density_info}
Tone/Audience: {tone}

Produce the strategic outline JSON now."""

def _build_strategist_chain(llm):
    return ChatPromptTemplate.from_messages([
        ("system", _STRATEGIST_SYSTEM), ("human", _STRATEGIST_HUMAN)
    ]) | llm | StrOutputParser()

# ---------------------------------------------------------------------------
# Stage 2 — Per-Slide Content Writer Agent
# ---------------------------------------------------------------------------

_CONTENT_SYSTEM = """You are a slide content writer. Write the final text for a single PowerPoint slide.

Rules:
1. STRICT BREVITY: short, punchy phrases - avoid full sentences
2. CHARACTER LIMIT: stay within the limit - prioritize the most important points
3. PLAIN TEXT ONLY: no markdown, no bold, no headers
4. FORMATTING: use plain hyphens (-) for bullets, one point per line
5. NO REPETITION: do not repeat topics covered by other slides in the deck context
6. TONE: match the specified tone/audience
7. Return ONLY valid JSON, no commentary, no code fences

Output format:
{{"slide_title":"Short title","suggested_content":"Line 1\\nLine 2","confidence_note":"brief reason"}}"""

_CONTENT_HUMAN = """Slide type: {slide_type}
Layout type: {layout_type}
Narrative role: {narrative_role}
Topic: {topic}
Key points: {key_points}
Character limit: {char_limit}
Tone/Audience: {tone}

Other slides (DO NOT repeat these topics):
{deck_context}

Write the slide content now."""

def _build_content_chain(llm):
    return ChatPromptTemplate.from_messages([
        ("system", _CONTENT_SYSTEM), ("human", _CONTENT_HUMAN)
    ]) | llm | StrOutputParser()


async def _fill_slide(llm, outline_item: dict, deck_context: str, tone: str) -> dict:
    chain = _build_content_chain(llm)
    try:
        raw    = await _invoke_with_retry(chain, {
            "slide_type":     outline_item.get("slide_type", "content"),
            "layout_type":    outline_item.get("layout_type", "content"),
            "narrative_role": outline_item.get("narrative_role", "content"),
            "topic":          outline_item.get("topic", ""),
            "key_points":     json.dumps(outline_item.get("key_points", [])),
            "char_limit":     outline_item.get("char_limit", 350),
            "tone":           tone,
            "deck_context":   deck_context,
        })
        result  = raw if isinstance(raw, dict) else {}
        title   = _strip_markdown(str(result.get("slide_title", "")))
        content = _strip_markdown(str(result.get("suggested_content", "")))
        content = _truncate_to_limit(content, int(outline_item.get("char_limit", 350)))
        return {
            "slide_number":      outline_item["slide_number"],
            "slide_title":       title,
            "suggested_content": content,
            "reason":            outline_item.get("topic", ""),
            "confidence":        outline_item.get("confidence", 1.0),
            "layout_type":       outline_item.get("layout_type", "content"),
            "narrative_role":    outline_item.get("narrative_role", "content"),
            "confidence_note":   result.get("confidence_note", ""),
        }
    except Exception as e:
        points  = outline_item.get("key_points", [])
        content = "\n".join(f"- {p}" for p in points) if points else ""
        return {
            "slide_number":      outline_item["slide_number"],
            "slide_title":       outline_item.get("topic", f"Slide {outline_item['slide_number']}"),
            "suggested_content": _truncate_to_limit(content, int(outline_item.get("char_limit", 350))),
            "reason":            f"fallback: {str(e)[:60]}",
            "confidence":        0.3,
            "layout_type":       outline_item.get("layout_type", "content"),
            "narrative_role":    outline_item.get("narrative_role", "content"),
            "confidence_note":   "fallback used due to error",
        }

# ---------------------------------------------------------------------------
# Stage 3 — Validation Agent
# ---------------------------------------------------------------------------

_VALIDATION_SYSTEM = """You are a presentation quality reviewer. Review slide drafts and identify issues.

Check for:
1. REPETITION: same key point on multiple slides
2. GAPS: important outline topics not covered anywhere
3. FLOW: does the narrative arc make sense?
4. OVERFLOW: content length exceeds char_limit
5. WEAK: very generic or placeholder-like content

overall_quality is 0-10 (8+ = no correction needed).
Return ONLY valid JSON, no commentary, no code fences.

Output format:
{{"overall_quality":8,"issues":[{{"type":"repetition|gap|flow|overflow|weak","slide_numbers":[2,4],"description":"...","suggestion":"..."}}]}}"""

_VALIDATION_HUMAN = "Slide drafts:\n{slides_json}\n\nOutline topics:\n{outline_summary}\n\nReturn quality report JSON now."

def _build_validation_chain(llm):
    return ChatPromptTemplate.from_messages([
        ("system", _VALIDATION_SYSTEM), ("human", _VALIDATION_HUMAN)
    ]) | llm | StrOutputParser()


async def _validate_slides(llm, slides: list[dict], outline_items: list[dict]) -> dict:
    chain = _build_validation_chain(llm)
    summary = [
        {
            "slide_number":    s["slide_number"],
            "slide_title":     s["slide_title"],
            "content_preview": s["suggested_content"][:200],
            "char_limit":      next((o.get("char_limit", 350) for o in outline_items
                                     if o["slide_number"] == s["slide_number"]), 350),
            "content_length":  len(s["suggested_content"]),
        }
        for s in slides
    ]
    outline_summary = " | ".join(f"Slide {o['slide_number']}: {o.get('topic','')}" for o in outline_items)
    try:
        raw = await _invoke_with_retry(chain, {
            "slides_json":     json.dumps(summary, indent=2),
            "outline_summary": outline_summary,
        })
        return raw if isinstance(raw, dict) else {"overall_quality": 9, "issues": []}
    except Exception as e:
        logger.warning(f"Validation agent failed: {e}")
        return {"overall_quality": 9, "issues": []}

# ---------------------------------------------------------------------------
# Stage 4 — Self-Correction Agent
# ---------------------------------------------------------------------------

_CORRECTION_SYSTEM = """You are a presentation editor. Fix specific issues in slide content.

Rules:
- TARGETED fixes only - do not rewrite slides that have no issues
- Repetition: rewrite the lower-priority slide to cover a different angle
- Overflow: trim to fit within char_limit, keep the most important points
- Weak: strengthen with more specific language
- PLAIN TEXT ONLY, no markdown, hyphens (-) for bullets
- Return ONLY the slides that were changed
- Return ONLY valid JSON, no commentary, no code fences

Output format:
{{"corrected_slides":[{{"slide_number":3,"slide_title":"...","suggested_content":"..."}}]}}"""

_CORRECTION_HUMAN = "Issues:\n{issues_json}\n\nSlide drafts:\n{slides_json}\n\nFix only slides with issues. Return corrected_slides JSON now."

def _build_correction_chain(llm):
    return ChatPromptTemplate.from_messages([
        ("system", _CORRECTION_SYSTEM), ("human", _CORRECTION_HUMAN)
    ]) | llm | StrOutputParser()


async def _correct_slides(llm, slides: list[dict], validation_report: dict) -> list[dict]:
    issues = validation_report.get("issues", [])
    if not issues:
        return slides
    chain = _build_correction_chain(llm)
    slides_by_num = {s["slide_number"]: s for s in slides}
    for iteration in range(2):
        try:
            raw = await _invoke_with_retry(chain, {
                "issues_json": json.dumps(issues, indent=2),
                "slides_json": json.dumps([
                    {"slide_number": s["slide_number"], "slide_title": s["slide_title"],
                     "suggested_content": s["suggested_content"]}
                    for s in slides
                ], indent=2),
            })
            result    = raw if isinstance(raw, dict) else {}
            corrected = result.get("corrected_slides", [])
            if not corrected:
                break
            for fix in corrected:
                num = fix.get("slide_number")
                if num and num in slides_by_num:
                    slides_by_num[num]["slide_title"]       = _strip_markdown(str(fix.get("slide_title", slides_by_num[num]["slide_title"])))
                    slides_by_num[num]["suggested_content"] = _strip_markdown(str(fix.get("suggested_content", slides_by_num[num]["suggested_content"])))
                    slides_by_num[num]["corrected"]         = True
            logger.info(f"Correction iteration {iteration+1}: fixed {len(corrected)} slide(s)")
            break
        except Exception as e:
            logger.warning(f"Correction iteration {iteration+1} failed: {e}")
            break
    return list(slides_by_num.values())

# ---------------------------------------------------------------------------
# Stage 5 — Formatter (no LLM)
# ---------------------------------------------------------------------------

def _format_slides(slides: list[dict]) -> list[dict]:
    number_re = re.compile(r'\b(\d{4,})\b')
    for slide in slides:
        content = slide.get("suggested_content", "")
        content = _strip_markdown(content)
        content = number_re.sub(lambda m: f"{int(m.group(1)):,}", content)
        content = re.sub(r'^[•·▪▸►]\s+', '- ', content, flags=re.MULTILINE)
        slide["suggested_content"] = content
        slide["word_count"]        = len(content.split())
    return slides

# ---------------------------------------------------------------------------
# Agent steps
# ---------------------------------------------------------------------------

AGENT_STEPS = [
    {"step": "analysing",    "label": "Analysing and chunking your content..."},
    {"step": "strategising", "label": "Building narrative strategy..."},
    {"step": "writing",      "label": "Writing slide content in parallel..."},
    {"step": "validating",   "label": "Validating deck quality..."},
    {"step": "formatting",   "label": "Formatting and finalising..."},
]

# ---------------------------------------------------------------------------
# Main streaming pipeline
# ---------------------------------------------------------------------------

async def run_agent_stream(
    session_id: str,
    raw_data: str,
    openai_api_key: str,
    base_url: str = "https://integrate.api.nvidia.com/v1",
    model: str = "meta/llama-3.3-70b-instruct",
    tone: str = "General",
) -> AsyncGenerator[dict, None]:

    slide_structure = get_template(session_id)
    if not slide_structure:
        yield {"type": "error", "message": "No PPT template found for this session."}
        return

    llm = ChatOpenAI(
        model=model, temperature=0.1,
        api_key=openai_api_key, base_url=base_url,
        request_timeout=45, max_retries=1,
    )

    overflow_info = _detect_overflow(raw_data, slide_structure)

    # ── Stage 0: Content Analyst ─────────────────────────────────────────────
    yield {"type": "step", "index": 0, "step": "analysing", "label": AGENT_STEPS[0]["label"], "status": "running"}
    try:
        analyst_raw    = await _invoke_with_retry(_build_analyst_chain(llm), {"raw_data": raw_data})
        analyst_result = analyst_raw if isinstance(analyst_raw, dict) else {}
        chunks         = analyst_result.get("chunks", [])
        chunks.sort(key=lambda c: c.get("importance", 1), reverse=True)
        chunks_json = json.dumps(chunks[:20], indent=2)
        logger.info(f"Content Analyst: {len(chunks)} chunks")
    except Exception as e:
        logger.warning(f"Content Analyst failed ({e}) — using raw text fallback")
        chunks_json = json.dumps([{"text": raw_data[:500], "type": "narrative", "importance": 3}])
    yield {"type": "step", "index": 0, "step": "analysing", "status": "done"}

    # ── Stage 1: Deck Strategist ─────────────────────────────────────────────
    yield {"type": "step", "index": 1, "step": "strategising", "label": AGENT_STEPS[1]["label"], "status": "running"}
    try:
        outline_raw   = await _invoke_with_retry(_build_strategist_chain(llm), {
            "slide_structure": slide_structure,
            "chunks_json":     chunks_json,
            "density_info":    json.dumps(overflow_info),
            "tone":            tone,
        })
        outline_result = outline_raw if isinstance(outline_raw, dict) else {}
        outline_items  = outline_result.get("outline", [])
        if not outline_items:
            yield {"type": "error", "message": "Strategist returned empty outline."}
            return
        logger.info(f"Strategist: {len(outline_items)} items, density={overflow_info['content_density']}")
    except Exception as e:
        yield {"type": "error", "message": f"Strategy stage failed: {str(e)}"}
        return
    yield {"type": "step", "index": 1, "step": "strategising", "status": "done"}

    # ── Stage 2: Concurrent Content Writers ──────────────────────────────────
    yield {"type": "step", "index": 2, "step": "writing", "label": AGENT_STEPS[2]["label"], "status": "running"}
    deck_context = _build_deck_context(outline_items)
    try:
        results = await asyncio.gather(
            *[_fill_slide(llm, item, deck_context, tone) for item in outline_items],
            return_exceptions=True,
        )
    except Exception as e:
        yield {"type": "error", "message": f"Content writing failed: {str(e)}"}
        return

    draft_slides = []
    for item, res in zip(outline_items, results):
        if isinstance(res, Exception):
            draft_slides.append({
                "slide_number": item["slide_number"],
                "slide_title":  item.get("topic", f"Slide {item['slide_number']}"),
                "suggested_content": "",
                "reason":       f"error: {str(res)[:60]}",
                "confidence":   0.2,
                "layout_type":  item.get("layout_type", "content"),
                "narrative_role": item.get("narrative_role", "content"),
            })
        else:
            draft_slides.append(res)
    yield {"type": "step", "index": 2, "step": "writing", "status": "done"}

    # ── Stage 3: Validation ───────────────────────────────────────────────────
    yield {"type": "step", "index": 3, "step": "validating", "label": AGENT_STEPS[3]["label"], "status": "running"}
    validation_report = await _validate_slides(llm, draft_slides, outline_items)
    quality = validation_report.get("overall_quality", 10)
    logger.info(f"Validation: quality={quality}/10, issues={len(validation_report.get('issues', []))}")
    yield {"type": "step", "index": 3, "step": "validating", "status": "done"}

    # ── Stage 4: Self-Correction ──────────────────────────────────────────────
    if quality < 8 and validation_report.get("issues"):
        logger.info("Running self-correction")
        draft_slides = await _correct_slides(llm, draft_slides, validation_report)

    # ── Stage 5: Formatter ────────────────────────────────────────────────────
    yield {"type": "step", "index": 4, "step": "formatting", "label": AGENT_STEPS[4]["label"], "status": "running"}
    final_slides = _format_slides(draft_slides)
    yield {"type": "step", "index": 4, "step": "formatting", "status": "done"}

    seen:  set[int]   = set()
    final: list[dict] = []
    for s in sorted(final_slides, key=lambda x: x["slide_number"]):
        n = s["slide_number"]
        if n not in seen:
            final.append(s)
            seen.add(n)

    yield {
        "type": "result",
        "data": {
            "slides":        final,
            "quality_score": quality,
            "issues_found":  len(validation_report.get("issues", [])),
            "tone":          tone,
            "density":       overflow_info["content_density"],
        },
    }

# ---------------------------------------------------------------------------
# Slide refinement
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
    model: str = "meta/llama-3.3-70b-instruct",
    char_limit: int = 400,
) -> str:
    llm = ChatOpenAI(
        model=model, temperature=0.2,
        api_key=openai_api_key, base_url=base_url,
        request_timeout=30, max_retries=1,
    )
    prompt = ChatPromptTemplate.from_messages([
        (
            "system",
            "You are a presentation content assistant focused on a single slide.\n"
            "Refine the slide content based on the user's instruction.\n"
            "Return only the refined content as plain text — no JSON, no markdown, no commentary.\n"
            "Use hyphens (-) for bullet points. One point per line.\n\n"
            f"Slide {slide_number} — \"{slide_title}\":\n{current_content}\n\n"
            f"IMPORTANT: Stay within {char_limit} characters. "
            f"Current content is {len(current_content)} chars. "
            "If adding content, be selective — keep only the most impactful points.",
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
    result = await chain.ainvoke({"chat_history": history_messages, "instruction": instruction})
    result = _strip_markdown(result)
    result = _truncate_to_limit(result, char_limit)
    return result
