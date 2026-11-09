"""Chunking, lexical retrieval, and source catalogs for study prep."""

from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass

from .sources import ExtractedSource

MAX_CHUNK_CHARS = 4500
CHUNK_OVERLAP_CHARS = 250

_STOPWORDS = {
    # Spanish
    "a",
    "al",
    "algo",
    "como",
    "con",
    "de",
    "del",
    "el",
    "ella",
    "en",
    "entre",
    "es",
    "esa",
    "ese",
    "esto",
    "fue",
    "ha",
    "hay",
    "la",
    "las",
    "lo",
    "los",
    "más",
    "no",
    "o",
    "para",
    "pero",
    "por",
    "que",
    "se",
    "sin",
    "sobre",
    "su",
    "sus",
    "también",
    "un",
    "una",
    "uno",
    "y",
    "ya",
    # English
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "in",
    "is",
    "it",
    "its",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "was",
    "were",
    "with",
}


@dataclass
class Chunk:
    id: str
    source_id: str
    source_name: str
    source_title: str
    kind: str
    unit_label: str
    unit_start: int
    unit_end: int
    text: str
    chapter_id: str | None = None


def build_chunks(sources: list[ExtractedSource]) -> list[Chunk]:
    chunks: list[Chunk] = []
    for source in sources:
        chapter_by_unit: dict[int, str] = {}
        for chapter in source.chapters:
            for number in range(chapter.unit_start, chapter.unit_end + 1):
                chapter_by_unit.setdefault(number, chapter.id)
        for unit in source.units:
            if not unit.text.strip():
                continue
            for text in _split_text(unit.text, MAX_CHUNK_CHARS, CHUNK_OVERLAP_CHARS):
                chunks.append(
                    Chunk(
                        id=f"c{len(chunks)}",
                        source_id=source.id,
                        source_name=source.filename,
                        source_title=source.title,
                        kind=source.kind,
                        unit_label=source.unit_label,
                        unit_start=unit.number,
                        unit_end=unit.number,
                        text=text,
                        chapter_id=chapter_by_unit.get(unit.number),
                    )
                )
    return chunks


def build_rough_chunks(text: str, *, max_chars: int = 3500) -> list[Chunk]:
    chunks: list[Chunk] = []
    for text_part in _split_text(text, max_chars, 200):
        chunks.append(
            Chunk(
                id=f"r{len(chunks)}",
                source_id="rough",
                source_name="Rough notes",
                source_title="Rough notes",
                kind="notes",
                unit_label="section",
                unit_start=1,
                unit_end=1,
                text=text_part,
                chapter_id=None,
            )
        )
    return chunks


def select_source_chunks(
    chunks: list[Chunk],
    query: str,
    *,
    source_id: str,
    chapter_id: str | None = None,
    unit_start: int | None = None,
    unit_end: int | None = None,
    limit: int = 8,
    char_budget: int = 18_000,
) -> list[Chunk]:
    candidates = [
        chunk
        for chunk in chunks
        if chunk.source_id == source_id
        and (chapter_id is None or chunk.chapter_id == chapter_id)
    ]
    if not candidates:
        return []
    in_range = [
        chunk
        for chunk in candidates
        if unit_start is not None
        and unit_end is not None
        and chunk.unit_start >= unit_start
        and chunk.unit_end <= unit_end
    ]
    if not in_range:
        in_range = candidates

    if len(in_range) <= limit:
        selected = list(in_range)
    else:
        scores = bm25_scores(in_range, query)
        scored = list(zip(scores, in_range))
        scored.sort(key=lambda pair: (-pair[0], pair[1].unit_start, pair[1].id))
        selected = [chunk for _score, chunk in scored[:limit]]

    selected.sort(key=lambda chunk: (chunk.unit_start, chunk.id))
    return _fit_budget(selected, char_budget)


def select_rough_chunks(
    chunks: list[Chunk],
    query: str,
    *,
    limit: int = 5,
    char_budget: int = 10_000,
) -> list[Chunk]:
    if not chunks:
        return []
    if len(chunks) <= limit:
        selected = list(chunks)
    else:
        scores = bm25_scores(chunks, query)
        ranked = sorted(
            zip(chunks, scores),
            key=lambda pair: (-pair[1], pair[0].id),
        )
        selected = [chunk for chunk, _score in ranked[:limit]]
    selected.sort(key=lambda chunk: chunk.id)
    return _fit_budget(selected, char_budget)


def format_chunks(chunks: list[Chunk]) -> str:
    parts: list[str] = []
    for chunk in chunks:
        if chunk.unit_start == chunk.unit_end:
            where = f"{chunk.unit_label} {chunk.unit_start}"
        else:
            where = f"{chunk.unit_label} {chunk.unit_start}-{chunk.unit_end}"
        parts.append(
            f"[{chunk.id}] {chunk.source_name} ({where})\n{chunk.text.strip()}"
        )
    return "\n\n---\n\n".join(parts)


def unit_phrase(unit_label: str, count: int) -> str:
    """Human-readable page/slide/section count for catalogs and notes."""
    if unit_label == "p.":
        return f"{count} page" + ("" if count == 1 else "s")
    if unit_label == "slide":
        return f"{count} slide" + ("" if count == 1 else "s")
    if unit_label == "section":
        return f"{count} section" + ("" if count == 1 else "s")
    return f"{count} {unit_label}"


def source_catalog(sources: list[ExtractedSource], *, max_chars: int = 12_000) -> str:
    lines: list[str] = []
    for source in sources:
        lines.append(
            f"SOURCE {source.id} | {source.filename} | {source.kind} | "
            f"{unit_phrase(source.unit_label, source.unit_count)} | "
            f"{len(source.chapters)} chapters"
        )
        for chapter in source.chapters:
            lines.append(
                f"  CHAPTER {chapter.id} | {chapter.title} | "
                f"{source.unit_label} {chapter.unit_start}-{chapter.unit_end}"
            )
            headings = [
                heading
                for heading in source.headings
                if chapter.unit_start <= heading.unit <= chapter.unit_end
            ]
            for heading in headings[:10]:
                indent = "    " + "  " * min(heading.level, 3)
                lines.append(
                    f"{indent}- {heading.title} ({source.unit_label} {heading.unit})"
                )
            if len(headings) > 10:
                lines.append(
                    f"    - … {len(headings) - 10} more headings in this chapter"
                )
        if len("\n".join(lines)) >= max_chars:
            lines.append("… source catalog truncated …")
            break
    catalog = "\n".join(lines)
    if len(catalog) > max_chars:
        catalog = catalog[:max_chars].rsplit("\n", 1)[0] + "\n… source catalog truncated …"
    return catalog


def bm25_scores(chunks: list[Chunk], query: str) -> list[float]:
    query_tokens = tokenize(query)
    if not query_tokens:
        return [0.0 for _chunk in chunks]
    documents = [Counter(tokenize(chunk.text)) for chunk in chunks]
    document_frequency: Counter[str] = Counter()
    for counts in documents:
        for token in set(counts):
            document_frequency[token] += 1
    total = len(documents)
    average_length = sum(sum(counts.values()) for counts in documents) / max(1, total)
    scores: list[float] = []
    k1 = 1.5
    b = 0.75
    for counts in documents:
        length = sum(counts.values())
        score = 0.0
        for token in query_tokens:
            frequency = counts.get(token, 0)
            if frequency == 0:
                continue
            df = document_frequency.get(token, 0)
            idf = math.log(1.0 + (total - df + 0.5) / (df + 0.5))
            denominator = frequency + k1 * (
                1.0 - b + b * length / max(1.0, average_length)
            )
            score += idf * frequency * (k1 + 1.0) / denominator
        scores.append(score)
    return scores


def tokenize(value: str) -> list[str]:
    folded = unicodedata.normalize("NFKD", value.lower())
    folded = "".join(char for char in folded if not unicodedata.combining(char))
    words = re.findall(r"[a-z0-9]{2,}", folded)
    return [word for word in words if word not in _STOPWORDS]


def _split_text(text: str, max_chars: int, overlap: int) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_size = 0
    for paragraph in paragraphs:
        pieces = (
            [paragraph]
            if len(paragraph) <= max_chars
            else [
                paragraph[index : index + max_chars]
                for index in range(0, len(paragraph), max_chars)
            ]
        )
        for piece in pieces:
            if current and current_size + len(piece) > max_chars:
                chunks.append("\n\n".join(current))
                tail = chunks[-1][-overlap:] if overlap > 0 else ""
                current = [tail, piece] if tail else [piece]
                current_size = sum(len(part) for part in current)
            else:
                current.append(piece)
                current_size += len(piece)
    if current:
        chunks.append("\n\n".join(current))
    return [chunk.strip() for chunk in chunks if chunk.strip()]


def _fit_budget(chunks: list[Chunk], budget: int) -> list[Chunk]:
    selected: list[Chunk] = []
    used = 0
    for chunk in chunks:
        if selected and used + len(chunk.text) > budget:
            continue
        selected.append(chunk)
        used += len(chunk.text)
        if used >= budget:
            break
    return selected
