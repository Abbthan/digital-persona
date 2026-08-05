import unittest

from extraction_client import ExtractionClient
from schemas import Entity, Extraction, MemoryFact


class ExtractionMergeTests(unittest.TestCase):
    def test_deduplicates_values(self) -> None:
        first = Extraction(
            facts=[MemoryFact(text="Likes tea")],
            entities=[Entity(name="Ethan", canonical_name="Ethan", type="person")],
            locations=["Shanghai"],
        )
        second = Extraction(
            facts=[MemoryFact(text="Likes tea"), MemoryFact(text="Writes daily")],
            entities=[Entity(name="Ethan", canonical_name="Ethan", type="person")],
            locations=["shanghai", "Suzhou"],
        )
        merged = ExtractionClient._merge([first, second])
        self.assertEqual([fact.text for fact in merged.facts], ["Likes tea", "Writes daily"])
        self.assertEqual(len(merged.entities), 1)
        self.assertEqual(merged.locations, ["Shanghai", "Suzhou"])


if __name__ == "__main__":
    unittest.main()
