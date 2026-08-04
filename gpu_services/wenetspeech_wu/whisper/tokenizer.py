"""Minimal language table imported by WeNet's common utilities.

The deployed model is Conformer-U2pp-Wu and never invokes Whisper tokenization.
WeNet nevertheless imports ``LANGUAGES`` at module load time. Keeping the
compatibility surface here avoids installing the unrelated OpenAI Whisper
runtime into this isolated service.
"""

LANGUAGES = {
    "en": "english",
    "zh": "chinese",
}
