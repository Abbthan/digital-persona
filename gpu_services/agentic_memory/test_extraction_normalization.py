from __future__ import annotations

import ast
import logging
import unittest
from pathlib import Path
from typing import Any

from schemas import Extraction, MemoryFact, Entity, Relation, TimelineEvent, DialectTerm, Emotion, GuidedQuestion

# Exercise the actual normalizer without loading Torch/model weights in a
# unit test. These two functions have no model/runtime dependencies.
source = ast.parse(Path(__file__).with_name("extractor_app.py").read_text())
functions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in {"_number", "_normalize_extraction"}]
scope = dict(globals(), logger=logging.getLogger("normalization-test"))
exec(compile(ast.Module(body=functions, type_ignores=[]), "extractor-normalization", "exec"), scope)
normalize = scope["_normalize_extraction"]


class NormalizationTests(unittest.TestCase):
    def test_bad_fact_does_not_drop_valid_entities_or_facts(self):
        value = Extraction.model_validate(normalize({
            "facts": [{"type": "relationship", "confidence": 0.85}, {"text": "Likes tea.", "type": "preference"}],
            "entities": [{"name": "Nina", "type": "person"}],
        }))
        self.assertEqual([fact.text for fact in value.facts], ["Likes tea."])
        self.assertEqual(value.entities[0].canonical_name, "Nina")

    def test_missing_required_relation_is_not_invented(self):
        value = Extraction.model_validate(normalize({"relations": [{"subject": "Nina"}]}))
        self.assertEqual(value.relations, [])

    def test_output_caps_match_schema(self):
        value = Extraction.model_validate(normalize({"facts": [{"text": f"Fact {i}", "type": "other"} for i in range(40)]}))
        self.assertEqual(len(value.facts), 24)


if __name__ == "__main__":
    unittest.main()
