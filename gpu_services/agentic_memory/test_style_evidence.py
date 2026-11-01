import os
import tempfile
import unittest

from style_evidence import StyleEvidenceStore, build_profile, clean_extraction, eligible_source
from media_jobs import MediaJobs
from schemas import Extraction, MemoryFact


class StyleEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = StyleEvidenceStore(os.path.join(self.tmp.name, "style.sqlite3"))

    def tearDown(self):
        self.tmp.cleanup()

    def test_generated_and_visitor_style_is_never_evidence(self):
        extraction = Extraction(facts=[MemoryFact(text="usually says man", type="style"), MemoryFact(text="likes jazz", type="preference")], catchphrases=["man"])
        self.assertEqual(clean_extraction(extraction, "persona"), Extraction())
        visitor = clean_extraction(extraction, "user")
        self.assertEqual(visitor.catchphrases, [])
        self.assertEqual([x.type for x in visitor.facts], ["preference"])
        self.assertFalse(eligible_source("persona", "target", False, "My phrase"))

    def test_only_verified_unscripted_sources_enter_profile(self):
        self.store.replace("p", "a", "Lowkey, that is wild. I mean, let's try it.", "target")
        self.store.replace("p", "b", "Man, generic generated phrasing.", "unknown")
        self.store.replace("p", "c", "I authorize ECHO to clone my voice.", "target")
        self.store.replace("p", "d", "This is a required reading.", "target", True)
        self.assertEqual(self.store.profile("p")["source_count"], 1)
        prompt = self.store.prompt("p", "What should we try?")
        self.assertIn("Lowkey", prompt)
        self.assertNotIn("generic generated", prompt)
        self.assertNotIn("authorize ECHO", prompt)
        self.assertEqual(self.store.statuses("p")["c"]["state"], "scripted")
        self.assertEqual(self.store.statuses("p")["a"]["state"], "ready")

    def test_persona_isolation_revocation_and_source_deletion(self):
        for p in ("p1", "p2"):
            self.store.replace(p, "shared-id", p + " original wording.", "target")
        self.assertNotIn("p2 original", self.store.prompt("p1", "hello"))
        self.store.attest("p1", "shared-id", "unknown")
        self.assertEqual(self.store.profile("p1")["source_count"], 0)
        self.assertEqual(self.store.profile("p2")["source_count"], 1)
        self.store.delete("p1")
        self.assertEqual(self.store.profile("p2")["source_count"], 1)

    def test_bilingual_evidence_is_separate_and_heldout_is_not_prompted(self):
        text = " ".join(f"Original sentence number {i}." for i in range(15))
        self.store.replace("p", "english", text, "target")
        self.store.replace("p", "chinese", "其实我觉得蛮有意思的。要不我们先试试看？", "target")
        profile = self.store.profile("p")
        self.assertGreater(profile["languages"]["en"]["sentence_count"], 0)
        self.assertGreater(profile["languages"]["zh"]["sentence_count"], 0)
        held = profile["languages"]["en"]["held_out"]
        self.assertTrue(held)
        prompt = self.store.prompt("p", "number", 8)
        for row in held:
            self.assertNotIn(row["text"], prompt)

    def test_media_queue_is_durable_idempotent_and_scoped(self):
        path = os.path.join(self.tmp.name, "jobs.sqlite3")
        jobs = MediaJobs(path, None)
        body = {"persona_id": "p", "asset_id": "a", "target_authorship": "target"}
        self.assertEqual(jobs.enqueue(body)["status"], "queued")
        self.assertEqual(jobs.enqueue(body)["status"], "queued")
        self.assertEqual(MediaJobs(path, None)._next(), body)
        jobs._update(body, "running", 20)
        jobs.attest("p", "a", "unknown")
        self.assertEqual(jobs.attribution("p", "a"), "unknown")
        jobs.cancel("other", "a")
        self.assertEqual(jobs.status("p", "a")["state"], "running")
        jobs.cancel("p", "a")
        self.assertEqual(jobs.status("p", "a")["state"], "not_indexed")


if __name__ == "__main__":
    unittest.main()
