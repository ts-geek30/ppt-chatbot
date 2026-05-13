# SlideAI — R&D Review & Advanced Agent Workflow

---

## 1. Current State — What's Working Well

- Two-stage pipeline (Outline → Content) is architecturally sound
- Shape scanning at upload time is smart — avoids re-scanning on every request
- Per-slide concurrent generation with `asyncio.gather()` is efficient
- SSE streaming gives good real-time feedback
- Session isolation via UUID is clean
- Font preservation in `_write_text` is a nice touch

---

## 2. Accuracy Problems Found

### 2.1 Agent — Outline Stage
**Problem:** The Outline Agent has no awareness of the actual content volume vs. slide count.
If the user pastes 2000 words for a 5-slide deck, the agent tries to compress everything
rather than intelligently deciding what to include vs. omit.

**Fix:** Add a pre-processing step — a "Content Analyst Agent" that scores and ranks
raw content by relevance before the Outline Agent sees it.

---

### 2.2 Agent — Content Stage
**Problem:** Each Content Agent call is fully isolated — it has no awareness of what
other slides are saying. This causes:
- Repetition across slides (same point on slide 2 and slide 4)
- No narrative flow — slides don't build on each other
- Title slide and closing slide often get generic filler content

**Fix:** Pass a "deck context" summary to each Content Agent so it knows what
neighboring slides contain. This is the biggest accuracy gap in the current system.

---

### 2.3 `ppt_parser.py` — Character Capacity Estimation
**Problem:** The `_emu_to_chars()` function uses a fixed `font_pt=18.0` default.
Most templates use 14–16pt for body text, so capacity is being underestimated by ~20%.
This causes the Outline Agent to set char_limits too low, resulting in content that
is more truncated than necessary.

**Fix:** Read the actual font size from the shape's text frame before estimating capacity.

---

### 2.4 `ppt_creator.py` — Shape Name Collisions
**Problem:** Shape names in PPTX are not guaranteed to be unique across slides.
If two slides both have a shape named "Text Box 3", the `shape_by_name` dict
will silently use whichever one was iterated last. This can cause content to be
written to the wrong shape.

**Fix:** Build the shape lookup per-slide (already done), but also add a uniqueness
check and log a warning when duplicate names are detected at scan time.

---

### 2.5 `layout_intelligence.py` — Not Wired Into Main Pipeline
**Problem:** `layout_intelligence.py` exists and has good classification logic,
but `main.py` calls `ppt_parser.slides_to_prompt_str()` — NOT
`layout_intelligence.slides_to_prompt_str()`. The layout type and per-layout
content rules are never passed to the LLM. This is a significant missed opportunity.

**Fix:** Wire `layout_intelligence.enrich_slides()` into the upload pipeline so
the Outline Agent gets `Type: kpi | max_bullets=4` etc. per slide.

---

### 2.6 Session Store — In-Memory Only
**Problem:** `session_store` and `template_file_store` are plain Python dicts.
A server restart wipes all sessions. Users lose their work silently.

**Fix:** Persist to Redis or SQLite. At minimum, check if the template file exists
on disk and re-parse it if the in-memory session is missing.

---

### 2.7 Refinement Agent — No Char Limit Awareness
**Problem:** The `refine_slide` function has no knowledge of the slide's character
capacity. A user can ask "add more detail" and the agent will happily produce
content that overflows the text box in the final PPT.

**Fix:** Pass `char_limit` to the refinement prompt so the agent self-constrains.

---

### 2.8 Preview — Blocking LibreOffice Call
**Problem:** `pptx_to_images()` runs LibreOffice as a blocking subprocess with a
60-second timeout. On a busy server, multiple concurrent preview requests will
queue up and block FastAPI's event loop.

**Fix:** Run LibreOffice in a `ProcessPoolExecutor` via `asyncio.run_in_executor()`
so it doesn't block the async event loop.

---

## 3. Missing Features (High Value)

### 3.1 Content Source Diversity
Currently only accepts raw pasted text. Users want to:
- Upload a PDF/Word doc and have it parsed automatically
- Paste a URL and have the page scraped
- Upload a CSV/Excel file for data slides

### 3.2 Tone & Audience Control
No way to tell the agent "write for a C-suite audience" or "use a casual tone".
This is a one-line addition to the prompt but has huge UX impact.

### 3.3 Slide Reorder / Delete
After mapping, users can refine individual slides but cannot reorder or delete them.
A drag-and-drop slide manager would complete the editing experience.

### 3.4 Confidence Scores
The agent should return a confidence score per slide (how well the raw data
matched the slide's expected content type). Low-confidence slides should be
visually flagged so users know where to focus their review.

### 3.5 Multi-Run Comparison
Users often want to run the agent twice with different raw data and compare results.
Currently each run overwrites the previous one in the UI.

### 3.6 Template Library
Users shouldn't have to upload a template every time. A library of common
templates (pitch deck, quarterly review, product roadmap) would reduce friction.

---

## 4. Advanced Agent Workflow (Proposed)

The current 2-stage pipeline becomes a **5-stage multi-agent pipeline** with
feedback loops, validation, and self-correction.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ADVANCED AGENT PIPELINE                         │
└─────────────────────────────────────────────────────────────────────┘

INPUT: raw_data (text / file / URL) + template structure

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STAGE 0 — Content Ingestion Agent  [NEW]
  ├── Accepts: plain text, PDF, DOCX, URL, CSV
  ├── Extracts and normalizes all content into structured chunks
  ├── Tags each chunk: { text, type: fact|stat|narrative|quote, importance: 1-5 }
  └── Output: ranked_chunks[]  (sorted by importance desc)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STAGE 1 — Deck Strategist Agent  [REPLACES current Outline Agent]
  ├── Input: ranked_chunks[] + enriched slide structure (with layout types)
  ├── Decides the narrative arc: what story does this deck tell?
  ├── Assigns content chunks to slides based on:
  │     - Slide layout type (kpi → stats, content → narrative, etc.)
  │     - Chunk importance score
  │     - Narrative flow (intro → problem → solution → data → close)
  ├── Flags slides with no matching content → marks as "low confidence"
  ├── Detects content overflow → proposes slide splits automatically
  └── Output: strategic_outline[]
        { slide_number, slide_type, layout_type, narrative_role,
          assigned_chunks[], char_limit, confidence: 0.0-1.0 }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STAGE 2 — Content Writer Agents  [ENHANCED from current Stage 2]
  ├── One agent per slide, all concurrent (asyncio.gather)
  ├── Each agent receives:
  │     - Its own outline item (slide_type, chunks, char_limit)
  │     - Deck context summary (what other slides cover — prevents repetition)
  │     - Tone/audience instruction (new user input)
  │     - Layout rules (max_bullets, title_max_chars from layout_intelligence)
  ├── Writes slide_title + suggested_content within char_limit
  ├── Returns confidence_note: why it made its choices
  └── Output: draft_slides[]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STAGE 3 — Validation Agent  [NEW]
  ├── Reviews all draft_slides as a complete deck
  ├── Checks for:
  │     - Repetition: same key point on multiple slides
  │     - Gaps: important chunks from ranked_chunks[] not used anywhere
  │     - Flow: does the narrative arc make sense slide-by-slide?
  │     - Overflow: content length vs. char_limit violations
  ├── Produces a validation_report:
  │     { issues[], suggestions[], overall_quality: 0-10 }
  └── If issues found → triggers Stage 4 (self-correction loop)
      If quality >= 8 → skip Stage 4, go straight to Stage 5

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STAGE 4 — Self-Correction Agent  [NEW — runs only if validation fails]
  ├── Receives: draft_slides[] + validation_report
  ├── Targeted fixes only — does NOT rewrite the whole deck
  ├── For each issue in validation_report:
  │     - Repetition → rewrites the lower-priority slide to use different angle
  │     - Gap → finds the best slide to insert the missing content
  │     - Overflow → trims content to fit char_limit
  ├── Max 2 correction iterations (prevents infinite loops)
  └── Output: corrected_slides[]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STAGE 5 — Formatter Agent  [NEW]
  ├── Final pass on all slides
  ├── Ensures consistent formatting across the deck:
  │     - Bullet style consistency (all "- " or all "• ")
  │     - Title casing consistency
  │     - Number formatting (1000 → 1,000 or 1K based on slide type)
  │     - Strips any residual markdown
  ├── Adds slide_metadata per slide:
  │     { confidence, content_source_chunks[], word_count, layout_type }
  └── Output: final_slides[]  → returned to frontend

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OUTPUT: final_slides[] with confidence scores + metadata
        → Rendered as slide cards in UI
        → Low-confidence cards visually flagged in amber
```

---

## 5. Advanced Refinement Loop (Per-Slide Chat)

Current refinement is a single LLM call with no awareness of the deck.
Proposed upgrade:

```
User instruction → Refinement Planner
                        ├── Classifies instruction type:
                        │     "concise"    → Compression Agent
                        │     "technical"  → Tone Rewriter Agent
                        │     "add data"   → Data Enrichment Agent (searches chunks)
                        │     "reorder"    → Structure Agent
                        │     free-form    → General Refinement Agent
                        └── Routes to specialist sub-agent
                                  ↓
                        Specialist produces refined content
                                  ↓
                        Char-limit validator checks output
                                  ↓
                        Returns to user with diff view (before/after)
```

---

## 6. Implementation Priority

| Priority | Item | Impact | Effort |
|---|---|---|---|
| P0 | Wire `layout_intelligence` into upload pipeline | High accuracy gain | 30 min |
| P0 | Fix char capacity — read actual font size | Reduces truncation | 1 hr |
| P1 | Add deck context to Content Writer Agents | Eliminates repetition | 2 hrs |
| P1 | Add Validation Agent (Stage 3) | Self-correcting output | 4 hrs |
| P1 | Pass char_limit to refinement prompt | Prevents overflow on refine | 30 min |
| P2 | Content Ingestion Agent (PDF/DOCX/URL) | Major UX unlock | 1 day |
| P2 | Tone/audience input field in UI | High perceived value | 2 hrs |
| P2 | Confidence scores on slide cards | Better user trust | 3 hrs |
| P2 | Run LibreOffice in executor (non-blocking) | Stability fix | 1 hr |
| P3 | Redis session persistence | Production readiness | 4 hrs |
| P3 | Slide reorder/delete UI | Complete editing flow | 1 day |
| P3 | Template library | Reduces onboarding friction | 2 days |

---

## 7. Quick Wins (Can Ship Today)

These are small code changes with immediate accuracy improvement:

**1. Wire layout intelligence (5 lines in `main.py`)**
```python
# In upload_template(), replace:
slide_structure_str = slides_to_prompt_str(slides)
# With:
from layout_intelligence import enrich_slides, slides_to_prompt_str as li_to_str
enriched = enrich_slides(slides)
slide_structure_str = li_to_str(enriched)
```

**2. Pass char_limit to refinement (1 line in `agent.py` + `main.py`)**
```python
# Add to refine_slide system prompt:
f"Character limit for this slide: {char_limit} chars. Stay within it."
```

**3. Add deck context to Content Agents (agent.py)**
```python
# Build a one-line summary of all other slides and pass it to each _fill_slide call
deck_summary = "; ".join([f"Slide {o['slide_number']}: {o['topic']}" for o in outline_items])
# Add to _CONTENT_HUMAN: "Other slides in this deck: {deck_summary} — do not repeat these topics."
```

**4. Add tone selector to UI (ChatWindow.jsx)**
```jsx
// Add a small dropdown above the textarea:
// Audience: [ General | Executive | Technical | Sales ]
// Pass as extra field in /process-data request body
```

---
