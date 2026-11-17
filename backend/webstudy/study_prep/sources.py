"""Extract structure-preserving text from PDF, PPTX, and Markdown sources."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

from .errors import SourceExtractionError

MAX_EXTRACTED_CHARS = 2_000_000
MIN_EXTRACTED_CHARS = 40


@dataclass
class Unit:
    number: int
    label: str
    text: str


@dataclass
class Heading:
    title: str
    unit: int
    level: int


@dataclass
class Chapter:
    id: str
    title: str
    unit_start: int
    unit_end: int


@dataclass
class ExtractedSource:
    id: str
    filename: str
    kind: str
    title: str
    unit_label: str
    units: list[Unit] = field(default_factory=list)
    headings: list[Heading] = field(default_factory=list)
    chapters: list[Chapter] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    stored_name: str = ""

    @property
    def char_count(self) -> int:
        return sum(len(unit.text) for unit in self.units)

    @property
    def unit_count(self) -> int:
        return len(self.units)

    def text_for_range(self, start: int, end: int) -> str:
        return "\n\n".join(
            unit.text
            for unit in self.units
            if start <= unit.number <= end and unit.text
        )

    def words_for_range(self, start: int, end: int) -> int:
        return sum(
            len(unit.text.split())
            for unit in self.units
            if start <= unit.number <= end
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "filename": self.filename,
            "kind": self.kind,
            "title": self.title,
            "unit_label": self.unit_label,
            "stored_name": self.stored_name,
            "warnings": list(self.warnings),
            "units": [
                {"number": unit.number, "label": unit.label, "text": unit.text}
                for unit in self.units
            ],
            "headings": [
                {"title": h.title, "unit": h.unit, "level": h.level}
                for h in self.headings
            ],
            "chapters": [
                {
                    "id": chapter.id,
                    "title": chapter.title,
                    "unit_start": chapter.unit_start,
                    "unit_end": chapter.unit_end,
                }
                for chapter in self.chapters
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ExtractedSource":
        return cls(
            id=str(data.get("id", "")),
            filename=str(data.get("filename", "")),
            kind=str(data.get("kind", "")),
            title=str(data.get("title", "")),
            unit_label=str(data.get("unit_label", "p.")),
            stored_name=str(data.get("stored_name", "")),
            warnings=[str(item) for item in data.get("warnings", [])],
            units=[
                Unit(
                    number=int(item.get("number", 0)),
                    label=str(item.get("label", "")),
                    text=str(item.get("text", "")),
                )
                for item in data.get("units", [])
            ],
            headings=[
                Heading(
                    title=str(item.get("title", "")),
                    unit=int(item.get("unit", 0)),
                    level=int(item.get("level", 0)),
                )
                for item in data.get("headings", [])
            ],
            chapters=[
                Chapter(
                    id=str(item.get("id", "")),
                    title=str(item.get("title", "")),
                    unit_start=int(item.get("unit_start", 0)),
                    unit_end=int(item.get("unit_end", 0)),
                )
                for item in data.get("chapters", [])
            ],
        )


def kind_for_filename(filename: str) -> str | None:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        return "pdf"
    if suffix == ".pptx":
        return "pptx"
    if suffix in {".md", ".markdown"}:
        return "md"
    return None


def extract_source(
    path: Path, *, source_id: str, filename: str, kind: str
) -> ExtractedSource:
    if kind == "pdf":
        return _extract_pdf(path, source_id=source_id, filename=filename)
    if kind == "pptx":
        return _extract_pptx(path, source_id=source_id, filename=filename)
    if kind == "md":
        return extract_markdown_text(
            _read_markdown(path), source_id=source_id, filename=filename
        )
    raise SourceExtractionError(
        f"Unsupported source type for {filename!r}.",
        hint="Upload a PDF, PPTX, or Markdown file.",
    )


def extract_markdown_text(
    text: str, *, source_id: str, filename: str, title: str | None = None
) -> ExtractedSource:
    text = _clean_text(text)
    if not text.strip():
        raise SourceExtractionError(
            f"{filename!r} contains no text.",
            hint="Use a Markdown file with actual text content.",
        )
    units, headings = _markdown_units(text)
    if not units:
        raise SourceExtractionError(f"{filename!r} contains no readable sections.")
    source_title = title or _markdown_title(headings, filename)
    chapters = _chapters_from_headings(
        headings,
        len(units),
        fallback_title=source_title,
        source_id=source_id,
        preferred_levels=(1, 2, 3),
    )
    return ExtractedSource(
        id=source_id,
        filename=filename,
        kind="md",
        title=source_title,
        unit_label="section",
        units=units,
        headings=headings,
        chapters=chapters,
        warnings=[],
    )


def rough_notes_source(text: str) -> ExtractedSource:
    source = extract_markdown_text(
        text,
        source_id="rough",
        filename="Rough notes",
        title="Rough notes",
    )
    source.kind = "notes"
    return source


def _read_markdown(path: Path) -> str:
    payload = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    return payload.decode("utf-8", errors="replace")


def _extract_pdf(path: Path, *, source_id: str, filename: str) -> ExtractedSource:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - dependency is declared
        raise SourceExtractionError(
            "PDF support is not installed.",
            hint="Install the backend dependencies with pip install -e './backend[dev]'.",
        ) from exc

    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as exc:  # pragma: no cover - depends on the file
                raise SourceExtractionError(
                    f"{filename!r} is password-protected.",
                    hint="Remove the PDF password and upload it again.",
                ) from exc
        raw_pages = [page.extract_text() or "" for page in reader.pages]
    except SourceExtractionError:
        raise
    except Exception as exc:
        raise SourceExtractionError(
            f"Could not read {filename!r} as a PDF.",
            hint="Check that the file is a valid, unencrypted PDF.",
        ) from exc

    units = [
        Unit(number=index + 1, label=f"p. {index + 1}", text=_clean_text(text))
        for index, text in enumerate(raw_pages)
    ]
    total_chars = sum(len(unit.text) for unit in units)
    if not units or total_chars < MIN_EXTRACTED_CHARS:
        raise SourceExtractionError(
            f"{filename!r} has no extractable text (it may be scanned).",
            hint="OCR is not supported yet. Upload a text-based PDF or the original slides.",
        )

    warnings: list[str] = []
    if total_chars > MAX_EXTRACTED_CHARS:
        units = _truncate_units(units, MAX_EXTRACTED_CHARS)
        warnings.append(
            f"{filename}: extracted text was truncated to {MAX_EXTRACTED_CHARS:,} characters."
        )

    title = _pdf_title(reader, filename)
    headings = _pdf_headings(reader)
    chapters = _chapters_from_headings(
        headings,
        len(units),
        fallback_title=title,
        source_id=source_id,
        preferred_levels=(0, 1, 2),
    )
    return ExtractedSource(
        id=source_id,
        filename=filename,
        kind="pdf",
        title=title,
        unit_label="p.",
        units=units,
        headings=headings,
        chapters=chapters,
        warnings=warnings,
    )


def _extract_pptx(path: Path, *, source_id: str, filename: str) -> ExtractedSource:
    try:
        from pptx import Presentation
    except ImportError as exc:  # pragma: no cover - dependency is declared
        raise SourceExtractionError(
            "PPTX support is not installed.",
            hint="Install the backend dependencies with pip install -e './backend[dev]'.",
        ) from exc

    try:
        presentation = Presentation(str(path))
    except Exception as exc:
        raise SourceExtractionError(
            f"Could not read {filename!r} as a PPTX presentation.",
            hint="Check that the file is a valid PowerPoint presentation.",
        ) from exc

    units: list[Unit] = []
    headings: list[Heading] = []
    for index, slide in enumerate(presentation.slides, start=1):
        parts: list[str] = []
        title = ""
        title_shape = slide.shapes.title
        if title_shape is not None and title_shape.has_text_frame:
            title = _clean_text(title_shape.text_frame.text)
            if title:
                parts.append(title)
                headings.append(Heading(title=title, unit=index, level=0))
        for shape in slide.shapes:
            if getattr(shape, "has_table", False):
                rows: list[str] = []
                for row in shape.table.rows:
                    cells = [_clean_text(cell.text) for cell in row.cells]
                    if any(cells):
                        rows.append(" | ".join(cells).strip())
                if rows:
                    parts.append("\n".join(rows))
                continue
            if not getattr(shape, "has_text_frame", False):
                continue
            text = _clean_text(shape.text_frame.text)
            if not text or text == title:
                continue
            parts.append(text)
        if getattr(slide, "has_notes_slide", False):
            notes = _clean_text(slide.notes_slide.notes_text_frame.text)
            if notes:
                parts.append(notes)
        units.append(
            Unit(
                number=index,
                label=f"slide {index}",
                text="\n\n".join(part for part in parts if part),
            )
        )

    total_chars = sum(len(unit.text) for unit in units)
    if not units or total_chars < MIN_EXTRACTED_CHARS:
        raise SourceExtractionError(
            f"{filename!r} has no extractable text.",
            hint="OCR is not supported yet. Upload a text-based PPTX or PDF.",
        )

    warnings: list[str] = []
    if total_chars > MAX_EXTRACTED_CHARS:
        units = _truncate_units(units, MAX_EXTRACTED_CHARS)
        warnings.append(
            f"{filename}: extracted text was truncated to {MAX_EXTRACTED_CHARS:,} characters."
        )

    title = _pptx_title(presentation, filename)
    chapter = Chapter(
        id=f"{source_id}_c0",
        title=title,
        unit_start=1,
        unit_end=len(units),
    )
    return ExtractedSource(
        id=source_id,
        filename=filename,
        kind="pptx",
        title=title,
        unit_label="slide",
        units=units,
        headings=headings,
        chapters=[chapter],
        warnings=warnings,
    )


def _pdf_title(reader, filename: str) -> str:
    try:
        metadata = reader.metadata or {}
        title = _clean_text(str(metadata.get("/Title", "") or ""))
        if title and title.lower() not in {"untitled", "unknown"}:
            return title[:200]
    except Exception:
        pass
    return Path(filename).stem.replace("_", " ").replace("-", " ").strip() or "PDF"


def _pptx_title(presentation, filename: str) -> str:
    try:
        title = _clean_text(str(presentation.core_properties.title or ""))
        if title and title.lower() not in {"powerpoint presentation", "presentation"}:
            return title[:200]
    except Exception:
        pass
    return (
        Path(filename).stem.replace("_", " ").replace("-", " ").strip()
        or "Presentation"
    )


def _pdf_headings(reader) -> list[Heading]:
    headings: list[Heading] = []

    def walk(items, level: int) -> None:
        for item in items:
            if isinstance(item, list):
                walk(item, level + 1)
                continue
            try:
                title = _clean_text(str(getattr(item, "title", "") or ""))
                if not title:
                    continue
                page = reader.get_destination_page_number(item) + 1
                if page > 0:
                    headings.append(Heading(title=title[:300], unit=page, level=level))
            except Exception:
                continue

    try:
        outline = reader.outline
        if outline:
            walk(outline, 0)
    except Exception:
        return []
    return headings


def _chapters_from_headings(
    headings: list[Heading],
    unit_count: int,
    *,
    fallback_title: str,
    source_id: str,
    preferred_levels: tuple[int, ...],
) -> list[Chapter]:
    for level in preferred_levels:
        selected = [heading for heading in headings if heading.level == level]
        selected = [
            heading for heading in selected if 1 <= heading.unit <= unit_count
        ]
        if len(selected) >= 2:
            return _build_chapters(selected, unit_count, source_id)
    return [
        Chapter(
            id=f"{source_id}_c0",
            title=fallback_title,
            unit_start=1,
            unit_end=unit_count,
        )
    ]


def _build_chapters(
    headings: list[Heading], unit_count: int, source_id: str
) -> list[Chapter]:
    ordered = sorted(headings, key=lambda heading: heading.unit)
    chapters: list[Chapter] = []
    for index, heading in enumerate(ordered):
        start = max(1, heading.unit if index > 0 else 1)
        end = (
            ordered[index + 1].unit - 1
            if index + 1 < len(ordered)
            else unit_count
        )
        end = min(unit_count, max(start, end))
        if end < start:
            continue
        title = heading.title.strip() or f"Chapter {index + 1}"
        chapters.append(
            Chapter(
                id=f"{source_id}_c{len(chapters)}",
                title=title[:200],
                unit_start=start,
                unit_end=end,
            )
        )
    if not chapters:
        return [
            Chapter(
                id=f"{source_id}_c0",
                title="Source",
                unit_start=1,
                unit_end=unit_count,
            )
        ]
    return chapters


_HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(.+?)\s*$")
_FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")


def _markdown_heading_matches(text: str) -> list[tuple[int, int, str]]:
    """Return ``(offset, level, title)`` for headings outside code fences."""
    matches: list[tuple[int, int, str]] = []
    offset = 0
    fence: str | None = None
    for line in text.splitlines(keepends=True):
        stripped = line.rstrip("\r\n")
        # splitlines() keeps the line ending, so the offset below is exact even
        # when the file mixes LF and CRLF.
        fence_match = _FENCE_RE.match(stripped)
        if fence_match:
            marker = fence_match.group(1)
            if fence is None:
                fence = marker[0]
            elif marker[0] == fence:
                fence = None
            offset += len(line)
            continue
        if fence is None:
            match = _HEADING_RE.match(stripped)
            if match:
                matches.append((offset, len(match.group(1)), match.group(2)))
        offset += len(line)
    return matches


def _markdown_units(text: str) -> tuple[list[Unit], list[Heading]]:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    matches = _markdown_heading_matches(text)
    if not matches:
        return _paragraph_units(text), []

    units: list[Unit] = []
    headings: list[Heading] = []
    prelude = text[: matches[0][0]].strip()
    if prelude:
        units.append(Unit(number=1, label="section 1", text=prelude))
    for index, (start, level, title) in enumerate(matches):
        end = matches[index + 1][0] if index + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if not body:
            continue
        number = len(units) + 1
        units.append(Unit(number=number, label=f"section {number}", text=body))
        headings.append(
            Heading(
                title=_clean_text(title)[:300],
                unit=number,
                level=level,
            )
        )
    if not units:
        return _paragraph_units(text), []
    return _normalize_unit_labels(units), headings


def _paragraph_units(text: str) -> list[Unit]:
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    units: list[Unit] = []
    buffer: list[str] = []
    size = 0
    for paragraph in paragraphs:
        if buffer and size + len(paragraph) > 4000:
            number = len(units) + 1
            units.append(
                Unit(number=number, label=f"section {number}", text="\n\n".join(buffer))
            )
            buffer = []
            size = 0
        buffer.append(paragraph)
        size += len(paragraph)
    if buffer:
        number = len(units) + 1
        units.append(
            Unit(number=number, label=f"section {number}", text="\n\n".join(buffer))
        )
    return units


def _normalize_unit_labels(units: list[Unit]) -> list[Unit]:
    for index, unit in enumerate(units, start=1):
        unit.number = index
        unit.label = f"section {index}"
    return units


def _markdown_title(headings: list[Heading], filename: str) -> str:
    for heading in headings:
        if heading.level == 1:
            return heading.title[:200]
    if headings:
        return headings[0].title[:200]
    return Path(filename).stem.replace("_", " ").replace("-", " ").strip() or "Notes"


def _truncate_units(units: list[Unit], limit: int) -> list[Unit]:
    result: list[Unit] = []
    used = 0
    for unit in units:
        if used >= limit:
            break
        remaining = limit - used
        text = unit.text[:remaining]
        result.append(Unit(number=unit.number, label=unit.label, text=text))
        used += len(text)
    return result


def _clean_text(value: str) -> str:
    value = unicodedata.normalize("NFC", value or "")
    value = value.replace("\x00", " ")
    value = re.sub(r"[ \t]+\n", "\n", value)
    value = re.sub(r"\n{4,}", "\n\n\n", value)
    return value.strip()
