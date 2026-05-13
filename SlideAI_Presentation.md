# SlideAI — Presentation Slides

---

## Slide 1 — Title

# SlideAI
### Upload your PPT template. Paste raw data. AI fills your slides.

---

## Slide 2 — The Problem & Solution

# The Problem

- Manually copying data into slides takes hours
- Raw content never fits slide layouts cleanly
- Formatting breaks, designs get ruined

**Solution:** SlideAI reads your template structure, classifies every slide's layout type, and runs a six-stage agentic pipeline to intelligently map any raw content into the right slides — preserving your design.

---

## Slide 3 — Overall Agentic Workflow

# How the Agent Works — End to End

```
User uploads .pptx
       ↓
ppt_parser.py extracts slide structure
(layouts, titles, shape dimensions, actual font sizes, char capacity)
       ↓
layout_intelligence.py classifies each slide
(title / agenda / section / content / two_column / kpi / timeline / table / closing)
       ↓
User pastes raw data + selects tone
       ↓
Six-Stage Agent Pipeline (NVIDIA Llama 3.3 70B)
       ↓
Filled .pptx returned for preview + download
```

- Session isolated per user via UUID — persisted in SQLite across server restarts
- Template scanned once at upload — shape map cached for fast writes
- Tone selector: General / Executive / Technical / Sales

---

## Slide 4 — Six-Stage Agent Pipeline (Core)

# Six Stages, One Coherent Deck

### Stage 0 — Content Analyst *(1 LLM call)*
- Chunks raw text into typed fragments: `fact | stat | narrative | quote | list_item | heading`
- Ranks each chunk by importance (1–5) — stats and numbers always score highest
- Outputs 5–20 structured chunks for the strategist

### Stage 1 — Deck Strategist *(1 LLM call)*
- Role: "Presentation Architect"
- Maps chunks to slides with a narrative arc: `intro → problem → solution → evidence → closing`
- Assigns `layout_type`, `narrative_role`, `char_limit`, and confidence per slide
- Detects content overflow (density > 1.5×) and plans extra slides automatically

### Stage 2 — Content Writers *(1 LLM call per slide, all concurrent)*
- Role: "Slide Content Writer"
- Input: `slide_type`, `layout_type`, `narrative_role`, `topic`, `key_points`, `char_limit`, `tone`
- Output: `{ slide_title, suggested_content }` — plain text, within budget
- All slides generated in parallel via `asyncio.gather()`
- Fallback: if any call fails, key_points used directly — no slide dropped

### Stage 3 — Validation Agent *(1 LLM call)*
- Reviews all draft slides for: repetition, gaps, flow issues, overflow, weak content
- Scores overall deck quality 0–10

### Stage 4 — Self-Correction Agent *(1 LLM call, only if quality < 8)*
- Targeted fixes only — rewrites only the flagged slides
- Runs up to 2 correction iterations

### Stage 5 — Formatter *(no LLM)*
- Strips markdown, normalises bullet characters, formats large numbers with commas
- Adds word count per slide

---

## Slide 5 — Layout Intelligence Engine

# Slide-Aware Content Rules

`layout_intelligence.py` classifies each slide into one of 10 layout types and enforces per-type content budgets:

| Layout Type | Max Body Chars | Max Bullets | Description |
|---|---|---|---|
| title | 120 | 1 | Cover — short title + tagline |
| agenda | 300 | 6 | Numbered section list |
| section | 100 | 1 | Section divider |
| content | 380 | 5 | Standard 3–5 bullet slide |
| two_column | 200/col | 4/col | Left + right content areas |
| kpi | 250 | 4 | Key numbers and metrics |
| timeline | 300 | 5 | Sequential milestones |
| table | 400 | 8 | Structured row data |
| comparison | 200 | 4 | Two-sided compare |
| closing | 150 | 2 | Thank you / contact |

- Char capacity derived from **actual shape dimensions + real font size** — not generic limits
- Two-column and KPI layouts split content across multiple body shapes automatically

---

## Slide 6 — Per-Slide Refinement + PPT Creation

# Refine → Preview → Download

### Refinement Chat
- Click any slide card → chat modal opens with current content in context
- User gives instruction: "make concise", "rewrite for technical audience", "add a statistic"
- Single LLM call with full multi-turn chat history → refined content applied back to slide
- Chat history preserved per slide across the session

### PPT Creation
- `ppt_creator.py` uses pre-scanned shape map (title shape + all body shapes per slide)
- Writes content using exact shape names — no guessing
- Dynamic font scaling: shrinks font in 2pt steps if content risks overflow (min 12pt)
- Multi-body content splitter: distributes lines across columns for two_column / kpi layouts
- Preserves original font size, color, paragraph formatting

### Preview
- LibreOffice headless → PDF → `pdf2image` → PNG per slide
- Rendered in browser before download via non-blocking `ProcessPoolExecutor`

---

## Slide 7 — Tech Stack & Key Design Choices

# Built On

| Layer | Technology |
|---|---|
| Backend | FastAPI · LangChain · python-pptx |
| LLM | NVIDIA AI — Llama 3.3 70B |
| Frontend | React + Vite · Server-Sent Events |
| Preview | LibreOffice + pdf2image |
| Persistence | SQLite (session survival across restarts) |
| Observability | LangSmith |

### Key Design Choices
- Six-stage pipeline: Analyst → Strategist → Writers → Validator → Corrector → Formatter
- Outline first → fill in isolation → validate → self-correct (mirrors Gamma / AiPPT approach)
- Char capacity derived from actual shape dimensions + real font size (not hardcoded defaults)
- LLM never sees the raw `.pptx` — only extracted text structure
- Backend stateless per refinement call — frontend owns chat history
- Session persisted in SQLite — survives server restarts without re-upload
- Tone selector (General / Executive / Technical / Sales) threads through all six stages

---

## Slide 8 — Prompt Engineering in SlideAI

# All 6 Prompts We Use — How & Why

Every stage has a dedicated system prompt with a clear role, strict rules, and a fixed JSON output format.

---

### Prompt 1 — Content Analyst (Stage 0)

Role: `"You are a content analyst."`

What it does: reads raw user text and breaks it into typed, ranked chunks.

```
System:
  You are a content analyst. Read raw text and extract structured content chunks.
  - type: fact | stat | narrative | quote | list_item | heading
  - importance: 1–5 (stats/numbers always 4–5)
  - Return 5–20 chunks max
  - Return ONLY valid JSON, no commentary, no code fences

  Output: {"chunks": [{"text": "...", "type": "stat", "importance": 5, "entities": ["..."]}]}

Human:
  Analyse this content and return structured chunks:
  "Revenue grew 42% YoY. New markets opened in 3 regions..."
```

---

### Prompt 2 — Deck Strategist (Stage 1)

Role: `"You are a presentation strategist."`

What it does: maps chunks to slides with a narrative arc (intro → problem → solution → evidence → closing).

```
System:
  Rules:
  - NARRATIVE ARC: assign narrative_role: intro|problem|solution|evidence|data|roadmap|closing
  - char_limit: use the capacity hint strictly — DO NOT EXCEED IT
  - layout_type: use the Type field from the slide structure (kpi, timeline, two_column, etc.)
  - EVERY slide in the template must be addressed
  - key_points must be plain text only — no markdown
  - Return ONLY valid JSON

  Output: {"outline": [{"slide_number":1, "slide_type":"title", "layout_type":"title",
           "narrative_role":"intro", "topic":"...", "key_points":["..."],
           "char_limit":300, "confidence":0.9}]}

Human:
  Slide Structure: [Slide 1 (title, capacity=120), Slide 2 (content, capacity=380)...]
  Content Chunks: [{"text":"Revenue grew 42%","type":"stat","importance":5}...]
  Content Density: {"needs_extra_slides": false, "content_density": 0.9}
  Tone: Executive
```

---

### Prompt 3 — Content Writer (Stage 2, one per slide, all concurrent)

Role: `"You are a slide content writer."`

What it does: writes the final text for a single slide — runs in parallel for all slides at once.

```
System:
  Rules:
  - STRICT BREVITY: short, punchy phrases — avoid full sentences
  - CHARACTER LIMIT: stay within the limit
  - PLAIN TEXT ONLY: no markdown, no bold, no headers
  - FORMATTING: use plain hyphens (-) for bullets, one point per line
  - NO REPETITION: do not repeat topics covered by other slides
  - TONE: match the specified tone/audience
  - Return ONLY valid JSON

  Output: {"slide_title":"Short title","suggested_content":"Line 1\nLine 2","confidence_note":"..."}

Human:
  Slide type: content
  Layout type: kpi
  Narrative role: evidence
  Topic: "Revenue Growth"
  Key points: ["42% YoY growth", "3 new regions"]
  Character limit: 250
  Tone: Executive
  Other slides (DO NOT repeat): Slide 1 (intro) | Slide 2 (problem)...
```

---

### Prompt 4 — Validation Agent (Stage 3)

Role: `"You are a presentation quality reviewer."`

What it does: reviews all draft slides and scores the deck 0–10. Score ≥ 8 skips correction.

```
System:
  Check for:
  1. REPETITION — same key point on multiple slides
  2. GAPS — important outline topics not covered
  3. FLOW — does the narrative arc make sense?
  4. OVERFLOW — content length exceeds char_limit
  5. WEAK — very generic or placeholder-like content

  overall_quality 0–10 (8+ = no correction needed)
  Output: {"overall_quality":8,"issues":[{"type":"repetition","slide_numbers":[2,4],
           "description":"...","suggestion":"..."}]}

Human:
  Slide drafts: [{"slide_number":2,"slide_title":"Growth","content_preview":"..."}...]
  Outline topics: Slide 1: intro | Slide 2: revenue | Slide 3: roadmap
```

---

### Prompt 5 — Self-Correction Agent (Stage 4, only if quality < 8)

Role: `"You are a presentation editor."`

What it does: fixes only the flagged slides — targeted rewrites, not a full redo. Runs up to 2 iterations.

```
System:
  Rules:
  - TARGETED fixes only — do not rewrite slides with no issues
  - Repetition: rewrite lower-priority slide to cover a different angle
  - Overflow: trim to fit char_limit, keep most important points
  - Weak: strengthen with more specific language
  - PLAIN TEXT ONLY, hyphens (-) for bullets
  - Return ONLY the slides that were changed

  Output: {"corrected_slides":[{"slide_number":3,"slide_title":"...","suggested_content":"..."}]}

Human:
  Issues: [{"type":"overflow","slide_numbers":[3],"description":"Content is 450 chars, limit is 350"}]
  Slide drafts: [{"slide_number":3,"slide_title":"Roadmap","suggested_content":"..."}]
```

---

### Prompt 6 — Slide Refinement (per-slide chat, on-demand)

Role: `"You are a presentation content assistant focused on a single slide."`

What it does: handles user refinement requests like "make it more concise" or "add a statistic" — multi-turn chat per slide.

```
System:
  Refine the slide content based on the user's instruction.
  Return only the refined content as plain text — no JSON, no markdown, no commentary.
  Use hyphens (-) for bullet points. One point per line.

  Slide 3 — "Roadmap": [current content shown here]
  IMPORTANT: Stay within 350 characters. Current content is 320 chars.

Human (multi-turn chat history included):
  "Make it more concise and add a timeline"
```

---

### Why These Prompts Work

- **Role clarity**: every prompt starts with "You are a [specific role]" — sets behavior immediately
- **Hard constraints**: char_limit, layout_type, tone injected as structured inputs — not suggestions
- **JSON-only output**: prevents hallucinated structure, makes parsing reliable
- **Fallback logic**: if Stage 2 fails, key_points used directly — no slide dropped
- **Concurrency**: Stage 2 runs all slides in parallel via `asyncio.gather()` — 10 slides = 1 LLM call time
- **Targeted correction**: Stage 4 only rewrites flagged slides, not the entire deck

---
