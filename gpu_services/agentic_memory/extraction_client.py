from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from schemas import ExtractRequest, Extraction, MemoryFact

logger = logging.getLogger("agentic-memory.extractor")


class ExtractionClient:
    def __init__(self) -> None:
        self.url = os.environ.get("MEMORY_EXTRACTOR_URL", "http://127.0.0.1:9020/extract")
        self.timeout = float(os.environ.get("MEMORY_EXTRACTOR_TIMEOUT_SECONDS", "90"))

    async def _extract_segment(self, text: str, role: str, source_type: str) -> Extraction:
        request = ExtractRequest(text=text, role=role, source_type=source_type)
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(self.url, json=request.model_dump())
                response.raise_for_status()
            return Extraction.model_validate(response.json())
        except Exception:
            logger.exception("structured extraction unavailable; preserving raw memory")
            return Extraction(
                facts=[MemoryFact(text=text[:1200], type="other", confidence=0.5)]
            )

    @staticmethod
    def _unique(values: list[Any], limit: int) -> list[Any]:
        result: list[Any] = []
        seen: set[str] = set()
        for value in values:
            key = (value.strip().casefold() if isinstance(value, str)
                   else value.model_dump_json(exclude_none=True))
            if key and key not in seen:
                seen.add(key)
                result.append(value)
            if len(result) >= limit:
                break
        return result

    @classmethod
    def _merge(cls, parts: list[Extraction]) -> Extraction:
        return Extraction(
            facts=cls._unique([value for part in parts for value in part.facts], 24),
            entities=cls._unique([value for part in parts for value in part.entities], 36),
            relations=cls._unique([value for part in parts for value in part.relations], 36),
            timeline=cls._unique([value for part in parts for value in part.timeline], 20),
            locations=cls._unique([value for part in parts for value in part.locations], 20),
            catchphrases=cls._unique([value for part in parts for value in part.catchphrases], 20),
            dialect_terms=cls._unique(
                [value for part in parts for value in part.dialect_terms], 20
            ),
            emotions=cls._unique([value for part in parts for value in part.emotions], 20),
            guided_questions=cls._unique(
                [value for part in parts for value in part.guided_questions], 8
            ),
        )

    async def extract(self, text: str, role: str, source_type: str) -> Extraction:
        normalized = text.strip()
        if not normalized:
            return Extraction()
        # Stay below ExtractRequest's 16k validation ceiling and bound each GPU
        # inference. Sequential background batches avoid competing with live jobs.
        segments = [
            normalized[start:start + 14_000]
            for start in range(0, len(normalized), 14_000)
        ]
        return self._merge([
            await self._extract_segment(segment, role, source_type)
            for segment in segments
        ])
