from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Entity(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    canonical_name: str = Field(min_length=1, max_length=200)
    type: str = Field(default="other", max_length=80)
    aliases: list[str] = Field(default_factory=list, max_length=12)


class Relation(BaseModel):
    subject: str = Field(min_length=1, max_length=200)
    predicate: str = Field(min_length=1, max_length=120)
    object: str = Field(min_length=1, max_length=300)
    confidence: float = Field(default=0.7, ge=0, le=1)
    time: str | None = Field(default=None, max_length=160)
    location: str | None = Field(default=None, max_length=200)


class MemoryFact(BaseModel):
    text: str = Field(min_length=1, max_length=1200)
    type: Literal[
        "identity", "preference", "relationship", "event", "belief",
        "habit", "skill", "style", "other",
    ] = "other"
    confidence: float = Field(default=0.7, ge=0, le=1)


class TimelineEvent(BaseModel):
    event: str = Field(min_length=1, max_length=600)
    time_expression: str | None = Field(default=None, max_length=160)
    start: str | None = Field(default=None, max_length=80)
    end: str | None = Field(default=None, max_length=80)
    certainty: float = Field(default=0.6, ge=0, le=1)


class DialectTerm(BaseModel):
    term: str = Field(min_length=1, max_length=120)
    meaning: str | None = Field(default=None, max_length=400)
    language: str | None = Field(default=None, max_length=80)
    examples: list[str] = Field(default_factory=list, max_length=5)


class Emotion(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    target: str | None = Field(default=None, max_length=300)
    valence: float = Field(default=0, ge=-1, le=1)
    intensity: float = Field(default=0.5, ge=0, le=1)


class GuidedQuestion(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    reason: str = Field(default="", max_length=500)
    priority: int = Field(default=2, ge=1, le=3)


class Extraction(BaseModel):
    facts: list[MemoryFact] = Field(default_factory=list, max_length=24)
    entities: list[Entity] = Field(default_factory=list, max_length=36)
    relations: list[Relation] = Field(default_factory=list, max_length=36)
    timeline: list[TimelineEvent] = Field(default_factory=list, max_length=20)
    locations: list[str] = Field(default_factory=list, max_length=20)
    catchphrases: list[str] = Field(default_factory=list, max_length=20)
    dialect_terms: list[DialectTerm] = Field(default_factory=list, max_length=20)
    emotions: list[Emotion] = Field(default_factory=list, max_length=20)
    guided_questions: list[GuidedQuestion] = Field(default_factory=list, max_length=8)

    @field_validator("locations", "catchphrases")
    @classmethod
    def clean_strings(cls, values: list[str]) -> list[str]:
        return [value.strip()[:300] for value in values if value and value.strip()]


class ConversationIngestRequest(BaseModel):
    persona_id: str = Field(min_length=1, max_length=160)
    message_id: str = Field(min_length=1, max_length=160)
    role: str = Field(min_length=1, max_length=40)
    content: str = Field(max_length=20_000)
    created_at: str | None = Field(default=None, max_length=80)


class SourceDocumentIngestRequest(BaseModel):
    persona_id: str = Field(min_length=1, max_length=160)
    asset_id: str = Field(min_length=1, max_length=160)
    file_name: str = Field(min_length=1, max_length=500)
    source_url: str = Field(min_length=1, max_length=2_000)


class RetrieveRequest(BaseModel):
    persona_id: str = Field(min_length=1, max_length=160)
    query: str = Field(min_length=1, max_length=2_000)
    top_k: int = Field(default=6, ge=1, le=20)


class ComposePromptRequest(RetrieveRequest):
    persona_name: str = Field(min_length=1, max_length=200)


class ExtractRequest(BaseModel):
    text: str = Field(min_length=1, max_length=16_000)
    role: str = Field(default="unknown", max_length=40)
    source_type: str = Field(default="conversation", max_length=80)
    source_language: str | None = Field(default=None, max_length=40)
