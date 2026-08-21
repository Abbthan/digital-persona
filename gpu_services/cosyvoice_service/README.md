# ECHO CosyVoice service

This localhost-only service keeps CosyVoice model loading and reference-voice
feature extraction outside LiveTalking. It caches a stable speaker key, selects
a tested English/Chinese inference path, converts each complete model tensor to
16 kHz PCM exactly once, and streams sample-aligned blocks to LiveTalking.

`livetalking_client.py` replaces only upstream `tts/cosyvoice.py`; MuseTalk and
the rest of LiveTalking remain independently updateable.

Use a dedicated environment and install `requirements.txt` there. Do not copy
or share LiveTalking's site-packages: CosyVoice2 pins torch/torchaudio 2.3.1,
and mixing only one of those with LiveTalking's newer build causes binary ABI
failures. The launcher binds to localhost and exposes GPU 0 by default.

English output intentionally uses cross-lingual inference even with an English
reference transcript. The historical same-language zero-shot path generated
near-silent English for the migrated persona, while cross-lingual synthesis is
healthy for both English and Chinese. Speaker embeddings are cached by persona
voice key and rebuilt automatically after a service restart.

## Clause pacing and de-click fades

`/inference_auto` splits `tts_text` into clauses at punctuation (see
`logic.split_text_with_pauses`) and synthesizes each one separately, inserting
real silence PCM between them: ~0.15-0.25s after a comma/、，, ~0.4-0.6s after
sentence-final punctuation, ~0.7-0.9s after an ellipsis or line break. Each
clause gets a 15ms raised-cosine fade at both edges (`logic.cosine_fade_int16`)
so the splice into silence never clicks. This replaces sending the whole reply
to the model in one call, which produced flat, continuous speech with none of
the pacing real speech has.

**Deployment dependency, not yet applied:** LiveTalking's own
`avatars/base_avatar.py` decides idle-vs-talking render state from raw audio
amplitude (`is_all_silence`) with a short `SPEAKING_HANGOVER_BATCHES` bridge
(currently 1 batch, ≈160ms at batch_size=4 -- see
`scripts/gpu-server/patches/0014-live-speech-continuity.patch` and
`0017-webrtc-av-sync.patch`). That bridge is shorter than every pause tier
above except the low end of the comma tier, so deploying this service change
alone would make the avatar flip to idle rendering mid-reply at most sentence
and paragraph boundaries -- reintroducing the idle/talking flicker issue
0014/0017 fixed, now triggered by these new intentional pauses instead of
network jitter.

The correct fix lives in `base_avatar.py`, not here: key the hangover off
whether the utterance's audio stream has reached its final `status: "end"`
frame (see `livetalking_client.py`'s `_stream_pcm`, which only sends `"end"`
after the very last clause) rather than off a fixed batch count. That keeps
genuine end-of-turn responsiveness unchanged while treating any silence
inside a still-open utterance as a pause, regardless of length. Do not deploy
this service's pacing change to production before that companion fix lands.
