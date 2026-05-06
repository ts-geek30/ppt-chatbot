"""
ppt_parser.py — Parse a PPTX template and extract a rich, structured
description of every slide's placeholders so the LLM and creator can
work with precise placeholder-level information.
"""
from pptx import Presentation
from pptx.util import Emu
import json
import re

# ---------------------------------------------------------------------------
# Placeholder classification (shared constants)
# ---------------------------------------------------------------------------
TITLE_TYPES  = {1, 13}          # TITLE, CENTER_TITLE
BODY_TYPES   = {2, 7, 15}       # BODY, OBJECT, VERTICAL_BODY
SKIP_TYPES   = {3, 4, 10, 11, 12, 14}  # DATE, FOOTER, SLIDE_NUMBER, etc.


def ph_type(shape):
    return shape.placeholder_format.type if shape.is_placeholder else None


def ph_idx(shape):
    return shape.placeholder_format.idx if shape.is_placeholder else None


def is_title(shape) -> bool:
    pt = ph_type(shape)
    if pt in TITLE_TYPES:
        return True
    if shape.is_placeholder and ph_idx(shape) == 0:
        return True
    return False


def is_fillable_body(shape) -> bool:
    """True if this shape is a writable content placeholder."""
    if not shape.has_text_frame or not shape.is_placeholder:
        return False
    if is_title(shape):
        return False
    pt  = ph_type(shape)
    idx = ph_idx(shape)
    if pt in SKIP_TYPES:
        return False
    # idx 1 = primary body; idx 2+ = secondary content areas (multi-column etc.)
    if idx is not None and idx >= 1:
        return True
    if pt in BODY_TYPES:
        return True
    return False


def _emu_to_chars(width_emu: int, height_emu: int, font_pt: float = 18.0) -> int:
    """
    Rough estimate of how many characters fit in a text box.
    Assumes ~1.6 chars per point of font width, ~1.4 lines per point of height.
    """
    width_pt  = width_emu  / 12700.0
    height_pt = height_emu / 12700.0
    chars_per_line = max(20, int(width_pt / (font_pt * 0.55)))
    lines           = max(1,  int(height_pt / (font_pt * 1.4)))
    return chars_per_line * lines


def parse_ppt(file_path: str) -> list[dict]:
    """
    Parse a PPTX and return slide descriptors.
    Works for both placeholder-based and plain text box templates.
    """
    prs = Presentation(file_path)
    slides = []

    # Known title-like text patterns
    _title_hints_lower = {
        "presentation title", "section title", "title", "thank you",
        "agenda", "data & insights",
    }
    _skip_re = re.compile(r'^(\d{1,2}|[↑↓→←★•\|])$')

    for i, slide in enumerate(prs.slides):
        layout_name = slide.slide_layout.name if slide.slide_layout else "Unknown"
        placeholders = []
        title_hint   = ""

        # Collect all text shapes sorted by vertical position
        text_shapes = []
        for shape in slide.shapes:
            if not shape.has_text_frame:
                continue
            text = shape.text_frame.text.strip()
            if not text:
                continue
            if _skip_re.match(text):
                continue
            try:
                top = shape.top
            except Exception:
                top = 0
            text_shapes.append((top, shape, text))

        text_shapes.sort(key=lambda x: x[0])

        for top, shape, text in text_shapes:
            hint = text[:100]
            # Estimate capacity
            try:
                cap = _emu_to_chars(shape.width, shape.height)
            except Exception:
                cap = 300

            is_t = text.lower() in _title_hints_lower
            is_b = not is_t

            if is_t and not title_hint:
                title_hint = hint

            placeholders.append({
                "idx":       None,
                "type_code": None,
                "hint":      hint,
                "capacity":  cap,
                "is_title":  is_t,
                "is_body":   is_b,
            })

        # If no title found by hint, use the topmost text shape
        if not title_hint and text_shapes:
            title_hint = text_shapes[0][2][:100]

        has_body = len(text_shapes) > 1

        slides.append({
            "slide_number": i + 1,
            "layout":       layout_name,
            "title_hint":   title_hint,
            "has_body":     has_body,
            "placeholders": placeholders,
        })

    return slides


def slides_to_prompt_str(slides: list[dict]) -> str:
    """
    Convert parsed slides to a compact, LLM-readable string.
    Since this template uses plain text boxes (no placeholders),
    we describe each slide by its layout name and the text found in its shapes.
    """
    lines = []
    for s in slides:
        # All shapes are non-placeholder text boxes — report them as content hints
        body_shapes = [p for p in s["placeholders"] if p["hint"]]
        # Use the actual capacity of the largest body shape, fall back to 350
        if body_shapes:
            max_cap = max(p["capacity"] for p in body_shapes)
            body_info = f"fillable (capacity ~{max_cap} chars)"
        else:
            body_info = "no-content-area"
        title = s["title_hint"] or "(no title)"
        lines.append(
            f"Slide {s['slide_number']} | Layout: {s['layout']} | Title: {title} | Body: {body_info}"
        )
        for p in body_shapes[:3]:  # show first 3 text hints with their capacities
            lines.append(f"  Text hint: {p['hint']} (capacity ~{p['capacity']} chars)")
    return "\n".join(lines)


def slides_to_json(slides: list[dict]) -> str:
    """Return the full parsed slide data as JSON (stored in session for creator use)."""
    return json.dumps(slides)
