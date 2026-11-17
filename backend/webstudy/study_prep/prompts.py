"""Versioned prompts for note planning and section drafting."""

from __future__ import annotations

import json
import re

from .models import RunOptions

LANGUAGE_NAMES = {"es": "Spanish", "en": "English"}

OUTLINE_SCHEMA = {
    "title": "string",
    "summary": "string",
    "language": "es | en",
    "exam_scope": ["string"],
    "key_terms": [{"term": "string", "definition": "string"}],
    "chapters": [
        {
            "chapter_id": "chapter id copied from the source catalog",
            "sections": [
                {
                    "title": "string",
                    "focus": "string",
                    "exam_scope": True,
                    "difficulty": 3,
                    "start_unit": 1,
                    "end_unit": 4,
                    "search_queries": ["string"],
                }
            ],
        }
    ],
}


def detect_language(text: str) -> str:
    lowered = text.lower()
    spanish = len(
        re.findall(
            r"\b(el|la|los|las|de|del|que|y|en|para|con|una|un|por|como|es|se|su|sus|más|también|pero|este|esta|estos|estas)\b",
            lowered,
        )
    )
    english = len(
        re.findall(
            r"\b(the|and|of|to|in|is|are|for|with|that|this|from|as|on|by|be|or|an|it|its|was|were)\b",
            lowered,
        )
    )
    spanish += lowered.count("ñ") + lowered.count("¿") + lowered.count("¡")
    if spanish == 0 and english == 0:
        return "es"
    return "es" if spanish >= english else "en"


def outline_prompt(
    *,
    rough_notes: str,
    catalog: str,
    options: RunOptions,
    language: str,
    focus_terms: tuple[str, ...] | list[str] = (),
) -> tuple[str, str]:
    language_name = LANGUAGE_NAMES.get(language, language)
    system = (
        "You are an expert study-notes assistant. You turn rough class notes "
        "and source material into an exam-oriented study document. Use only "
        "the supplied material. Never invent facts, chapter titles, unit "
        "numbers, page numbers, or sources. Return only valid JSON."
    )
    prompt = f"""Plan a study document and its chapter/topic structure.

OUTPUT LANGUAGE: {language_name} ({language})
DEPTH: {options.depth}
TARGET MINUTES: {options.target_minutes or "not specified"}
EXAM SCOPE FOCUS FROM ROUGH NOTES: {
    ", ".join(term.upper() for term in focus_terms)
    if focus_terms
    else "not explicitly restricted"
}

ROUGH CLASS NOTES
-----------------
{rough_notes}

SOURCE CATALOG
--------------
{catalog}

Return one JSON object with exactly this shape:
{json.dumps(OUTLINE_SCHEMA, ensure_ascii=False, indent=2)}

Rules:
- The rough notes define what the exam covers, and their scope instructions
  take precedence over the source catalog. If they restrict the exam to a
  topic (for example "only ATAM", "solamente ATAM", "únicamente el método
  ATAM"), include only the chapters and sections that actually cover that
  topic. Omit unrelated chapters and sections entirely.
- Never include a chapter merely because it is present in the catalog, because
  it is early in the source, or because most of the source would otherwise be
  unused. A chapter must directly support a topic that the rough notes put in
  scope.
- When the focus appears in one subsection, use its parent chapter and create
  a narrow section whose start_unit/end_unit cover only that subsection and
  its immediate explanation.
- Do not include other chapters with exam_scope=false as background. If it is
  outside the requested scope, it does not belong in this document.
- Use only chapter_id values that appear in the source catalog.
- Treat each source chapter as a separate study subject later. Do not merge
  chapters from different sources into one chapter.
- Create 1 to 5 coherent sections per chapter and at most 16 sections total.
  Each section should be a topic a student can study in one sitting.
- start_unit and end_unit must be integers inside that chapter's range. They
  must identify the source pages/slides/sections needed for that section. If
  the chapter has nested headings, use them to choose ranges.
- Mark exam_scope false only when the rough notes say an included topic is
  optional or explicitly excluded. Scope restrictions must remove material,
  not relabel it.
- difficulty is 1 (easy) to 5 (hard).
- search_queries should contain 2-5 short phrases that will retrieve the most
  relevant source passages for that section.
- Write title, summary, exam_scope, key_terms, section titles and focus text in
  {language_name}. Keep key_terms to at most 12 genuinely important terms.
- If no uploaded source exists, use the single rough-notes chapter and write
  sections from the rough notes.
- Do not add sections for chapters that the rough notes do not cover.
- Do not include markdown fences or commentary outside the JSON object."""
    return system, prompt


def section_prompt(
    *,
    chapter_title: str,
    section_title: str,
    focus: str,
    exam_scope: bool,
    language: str,
    source_excerpts: str,
    rough_excerpts: str,
    difficulty: int,
) -> tuple[str, str]:
    language_name = LANGUAGE_NAMES.get(language, language)
    system = (
        "You are an expert study-notes writer. You synthesize rough class "
        "notes with source excerpts. Use only the provided material, never "
        "invent facts or citations, and return only valid JSON."
    )
    scope = "in exam scope" if exam_scope else "background / outside exam scope"
    prompt = f"""Write one section of polished study notes.

OUTPUT LANGUAGE: {language_name} ({language})
CHAPTER: {chapter_title}
SECTION: {section_title}
FOCUS: {focus or "cover the section title thoroughly"}
SCOPE: {scope}
DIFFICULTY: {difficulty}/5

SOURCE PASSAGES
---------------
{source_excerpts or "(no source passage was selected)"}

ROUGH NOTES EXCERPTS
--------------------
{rough_excerpts or "(no rough-note excerpt was selected)"}

Rules:
- Synthesize the source passages and rough notes into clear, exam-oriented
  notes. Do not simply copy long passages.
- Use valid GitHub-flavored Markdown. Prefer short paragraphs, bullet lists,
  bold key terms, and tables for comparisons or classifications.
- Include definitions, distinctions, examples, and likely exam points when the
  material supports them. If the sources disagree, state the disagreement.
- Do not add a top-level heading; the application adds the section heading.
- Keep the section focused and substantial (roughly 250-700 words) unless the
  material is genuinely short.
- Return chunk_ids only for passages you actually used. Use only the bracketed
  IDs shown above. If you used no source passage, return an empty list.
- Do not invent page numbers, slide numbers, citations, or facts that are not
  present in the excerpts.

Return one JSON object with this shape:
{{"markdown": "markdown content", "chunk_ids": ["c0", "c1"]}}"""
    return system, prompt
