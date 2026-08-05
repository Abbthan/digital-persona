from __future__ import annotations

import hashlib
import os
from typing import Any

from neo4j import GraphDatabase

from schemas import Extraction


def _key(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()


class GraphStore:
    """Neo4j projection of persona memories, relationships and timelines."""

    def __init__(self) -> None:
        self.driver = GraphDatabase.driver(
            os.environ.get("NEO4J_URI", "bolt://127.0.0.1:7687"),
            auth=(os.environ.get("NEO4J_USER", "neo4j"), os.environ["NEO4J_PASSWORD"]),
        )

    def verify(self) -> None:
        self.driver.verify_connectivity()
        constraints = (
            "CREATE CONSTRAINT echo_entity IF NOT EXISTS FOR (n:Entity) REQUIRE (n.persona_id,n.key) IS UNIQUE",
            "CREATE CONSTRAINT echo_memory IF NOT EXISTS FOR (n:Memory) REQUIRE (n.persona_id,n.key) IS UNIQUE",
            "CREATE CONSTRAINT echo_relation IF NOT EXISTS FOR (n:Relation) REQUIRE (n.persona_id,n.key) IS UNIQUE",
        )
        with self.driver.session() as session:
            for query in constraints:
                session.run(query).consume()

    @staticmethod
    def _write(tx: Any, persona_id: str, source_id: str, source_type: str,
               role: str, created_at: str, raw_text: str, extraction: Extraction) -> None:
        memory_key = _key(persona_id, source_id)
        tx.run("""
            MERGE (p:Persona {id:$persona_id})
            MERGE (m:Memory {persona_id:$persona_id,key:$memory_key})
            SET m.source_id=$source_id,m.source_type=$source_type,m.role=$role,
                m.created_at=$created_at,m.text=$raw_text
            MERGE (p)-[:HAS_MEMORY]->(m)
        """, persona_id=persona_id, memory_key=memory_key, source_id=source_id,
               source_type=source_type, role=role, created_at=created_at,
               raw_text=raw_text[:12_000]).consume()

        aliases: dict[str, str] = {}
        for entity in extraction.entities:
            canonical = entity.canonical_name.strip() or entity.name.strip()
            entity_key = canonical.casefold()
            aliases[entity.name.casefold()] = entity_key
            aliases[canonical.casefold()] = entity_key
            tx.run("""
                MATCH (m:Memory {persona_id:$persona_id,key:$memory_key})
                MERGE (e:Entity {persona_id:$persona_id,key:$entity_key})
                SET e.name=$name,e.type=$type,e.aliases=$aliases
                MERGE (m)-[:MENTIONS]->(e)
            """, persona_id=persona_id, memory_key=memory_key, entity_key=entity_key,
                   name=canonical, type=entity.type, aliases=entity.aliases).consume()

        for relation in extraction.relations:
            subject_key = aliases.get(relation.subject.casefold(), relation.subject.casefold())
            object_key = aliases.get(relation.object.casefold(), relation.object.casefold())
            relation_key = _key(
                persona_id, source_id, subject_key, relation.predicate, object_key
            )
            tx.run("""
                MATCH (m:Memory {persona_id:$persona_id,key:$memory_key})
                MERGE (s:Entity {persona_id:$persona_id,key:$subject_key})
                  ON CREATE SET s.name=$subject
                MERGE (o:Entity {persona_id:$persona_id,key:$object_key})
                  ON CREATE SET o.name=$object
                MERGE (r:Relation {persona_id:$persona_id,key:$relation_key})
                SET r.source_id=$source_id,r.predicate=$predicate,r.confidence=$confidence,
                    r.time=$time,r.location=$location
                MERGE (s)-[:RELATION_SUBJECT]->(r)
                MERGE (r)-[:RELATION_OBJECT]->(o)
                MERGE (m)-[:SUPPORTS]->(r)
            """, persona_id=persona_id, memory_key=memory_key,
                   subject_key=subject_key, subject=relation.subject,
                   object_key=object_key, object=relation.object,
                   relation_key=relation_key, source_id=source_id,
                   predicate=relation.predicate, confidence=relation.confidence,
                   time=relation.time or "", location=relation.location or "").consume()

        for index, event in enumerate(extraction.timeline):
            event_key = _key(persona_id, source_id, "event", str(index), event.event)
            tx.run("""
                MATCH (m:Memory {persona_id:$persona_id,key:$memory_key})
                MERGE (e:Event {persona_id:$persona_id,key:$event_key})
                SET e.source_id=$source_id,e.description=$description,
                    e.time_expression=$time_expression,e.start=$start,e.end=$end,
                    e.certainty=$certainty
                MERGE (m)-[:DESCRIBES]->(e)
            """, persona_id=persona_id, memory_key=memory_key, event_key=event_key,
                   source_id=source_id, description=event.event,
                   time_expression=event.time_expression or "", start=event.start or "",
                   end=event.end or "", certainty=event.certainty).consume()

        for index, emotion in enumerate(extraction.emotions):
            emotion_key = _key(persona_id, source_id, "emotion", str(index), emotion.label)
            tx.run("""
                MATCH (m:Memory {persona_id:$persona_id,key:$memory_key})
                MERGE (e:Emotion {persona_id:$persona_id,key:$emotion_key})
                SET e.source_id=$source_id,e.label=$label,e.target=$target,
                    e.valence=$valence,e.intensity=$intensity
                MERGE (m)-[:EXPRESSES]->(e)
            """, persona_id=persona_id, memory_key=memory_key,
                   emotion_key=emotion_key, source_id=source_id, label=emotion.label,
                   target=emotion.target or "", valence=emotion.valence,
                   intensity=emotion.intensity).consume()

        for location in extraction.locations:
            tx.run("""
                MATCH (m:Memory {persona_id:$persona_id,key:$memory_key})
                MERGE (p:Place {persona_id:$persona_id,key:$place_key}) SET p.name=$name
                MERGE (m)-[:OCCURRED_AT]->(p)
            """, persona_id=persona_id, memory_key=memory_key,
                   place_key=location.casefold(), name=location).consume()

        style = [*(('catchphrase', value, '') for value in extraction.catchphrases),
                 *(('dialect_term', term.term, term.meaning or '')
                   for term in extraction.dialect_terms)]
        for index, (kind, value, meaning) in enumerate(style):
            signal_key = _key(persona_id, source_id, kind, str(index), value)
            tx.run("""
                MATCH (m:Memory {persona_id:$persona_id,key:$memory_key})
                MERGE (s:StyleSignal {persona_id:$persona_id,key:$signal_key})
                SET s.source_id=$source_id,s.kind=$kind,s.value=$value,s.meaning=$meaning
                MERGE (m)-[:SHOWS_STYLE]->(s)
            """, persona_id=persona_id, memory_key=memory_key,
                   signal_key=signal_key, source_id=source_id, kind=kind,
                   value=value, meaning=meaning).consume()

        for index, question in enumerate(extraction.guided_questions):
            question_key = _key(persona_id, source_id, "question", str(index), question.question)
            tx.run("""
                MATCH (m:Memory {persona_id:$persona_id,key:$memory_key})
                MERGE (q:GuidedQuestion {persona_id:$persona_id,key:$question_key})
                SET q.source_id=$source_id,q.question=$question,q.reason=$reason,
                    q.priority=$priority,q.created_at=$created_at
                MERGE (m)-[:SUGGESTS]->(q)
            """, persona_id=persona_id, memory_key=memory_key,
                   question_key=question_key, source_id=source_id,
                   question=question.question, reason=question.reason,
                   priority=question.priority, created_at=created_at).consume()

    def replace_source(self, persona_id: str, source_id: str, source_type: str,
                       role: str, created_at: str, raw_text: str,
                       extraction: Extraction) -> None:
        self.delete_source(persona_id, source_id)
        with self.driver.session() as session:
            session.execute_write(
                self._write, persona_id, source_id, source_type, role,
                created_at, raw_text, extraction,
            )

    def delete_source(self, persona_id: str, source_id: str) -> None:
        with self.driver.session() as session:
            session.run("MATCH (n {persona_id:$persona_id,source_id:$source_id}) DETACH DELETE n",
                        persona_id=persona_id, source_id=source_id).consume()
            session.run("MATCH (m:Memory {persona_id:$persona_id,source_id:$source_id}) DETACH DELETE m",
                        persona_id=persona_id, source_id=source_id).consume()
            session.run("MATCH (e:Entity {persona_id:$persona_id}) WHERE NOT (e)--() DELETE e",
                        persona_id=persona_id).consume()
            session.run("MATCH (p:Place {persona_id:$persona_id}) WHERE NOT (p)--() DELETE p",
                        persona_id=persona_id).consume()

    def delete_persona(self, persona_id: str) -> None:
        with self.driver.session() as session:
            session.run("MATCH (n {persona_id:$persona_id}) DETACH DELETE n",
                        persona_id=persona_id).consume()
            session.run("MATCH (p:Persona {id:$persona_id}) DETACH DELETE p",
                        persona_id=persona_id).consume()

    def context(self, persona_id: str, query: str, limit: int) -> dict[str, list[dict[str, Any]]]:
        with self.driver.session() as session:
            relations = session.run("""
                MATCH (s:Entity {persona_id:$persona_id})-[:RELATION_SUBJECT]->
                      (r:Relation {persona_id:$persona_id})-[:RELATION_OBJECT]->
                      (o:Entity {persona_id:$persona_id})
                WHERE toLower($search_text) CONTAINS toLower(s.name)
                   OR toLower($search_text) CONTAINS toLower(o.name)
                   OR toLower(s.name) CONTAINS toLower($search_text)
                   OR toLower(o.name) CONTAINS toLower($search_text)
                RETURN s.name AS subject,r.predicate AS predicate,o.name AS object,
                       r.time AS time,r.location AS location,r.confidence AS confidence
                ORDER BY r.confidence DESC LIMIT $limit
            """, persona_id=persona_id, search_text=query, limit=limit).data()
            timeline = session.run("""
                MATCH (e:Event {persona_id:$persona_id})
                RETURN e.description AS event,e.time_expression AS time_expression,
                       e.start AS start,e.end AS end,e.certainty AS certainty
                ORDER BY e.start DESC,e.certainty DESC LIMIT $limit
            """, persona_id=persona_id, limit=limit).data()
            questions = session.run("""
                MATCH (q:GuidedQuestion {persona_id:$persona_id})
                RETURN q.question AS question,q.reason AS reason,q.priority AS priority
                ORDER BY q.priority ASC,q.created_at DESC LIMIT 3
            """, persona_id=persona_id).data()
        return {"relations": relations, "timeline": timeline, "guided_questions": questions}

    def count(self) -> int:
        with self.driver.session() as session:
            row = session.run("MATCH (m:Memory) RETURN count(m) AS count").single()
            return int(row["count"] if row else 0)
