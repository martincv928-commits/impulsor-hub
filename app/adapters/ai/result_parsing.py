"""Shared ExecutorResult extraction, used by every AIExecutorAdapter
(originally ClaudeCodeAdapter-only; factored out so Codex/Gemini reuse the
exact same tolerant-but-still-fully-validated parsing instead of each
adapter re-implementing it)."""
from __future__ import annotations

import json
import re
from typing import Optional

from pydantic import ValidationError

from app.database.models import ExecutorResult


def parse_executor_result(
    result_text: str, expected_task_id: str
) -> tuple[Optional[ExecutorResult], Optional[str]]:
    """Try progressively looser extraction strategies. Whichever candidate
    text is used, it is still fully validated against ExecutorResult before
    being trusted -- loosening *extraction* never loosens *verification*, so
    a genuinely malformed/missing result still correctly falls through to
    `(None, raw_text)` (observed for real against the live `claude` CLI: it
    sometimes prefixes the required JSON with a sentence of prose despite
    the envelope instruction not to)."""
    candidates = [result_text.strip()]

    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", result_text, re.DOTALL)
    if fence_match:
        candidates.append(fence_match.group(1))

    first_brace = result_text.find("{")
    last_brace = result_text.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        candidates.append(result_text[first_brace : last_brace + 1])

    for candidate in candidates:
        try:
            raw = json.loads(candidate)
            parsed = ExecutorResult.model_validate(raw)
        except (json.JSONDecodeError, ValidationError):
            continue
        return parsed, None
    return None, result_text
