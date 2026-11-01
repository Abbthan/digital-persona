import numpy as np

from gpu_services.cosyvoice_service.pcm import fade_stream, prebuffer_pcm, tempo_pcm


def test_fades_keep_every_sample_and_only_affect_phrase_edges() -> None:
    pcm = np.full(5000, 12000, dtype=np.int16)
    output = np.concatenate(list(fade_stream([pcm[:1300], pcm[1300:4100], pcm[4100:]], 240)))
    assert len(output) == len(pcm)
    assert output[0] == output[-1] == 0
    assert np.array_equal(output[240:-240], pcm[240:-240])


def test_tiny_and_empty_phrase_fades_do_not_lose_samples() -> None:
    assert list(fade_stream([], 240)) == []
    output = np.concatenate(list(fade_stream([np.ones(100, dtype=np.int16)], 240)))
    assert len(output) == 100


def test_native_tempo_is_byte_exact_and_does_not_launch_a_filter() -> None:
    blocks = [b"\x01\x02", b"\x03\x04"]
    assert list(tempo_pcm(blocks, 1.0, 16000)) == blocks


def test_streaming_tempo_preserves_pitch_and_drains_audio_tail() -> None:
    rate = 16000
    seconds = 3
    pcm = np.rint(np.sin(2 * np.pi * 440 * np.arange(seconds * rate) / rate) * 16000).astype("<i2")
    raw = pcm.tobytes()
    output = b"".join(tempo_pcm((raw[i:i + 6400] for i in range(0, len(raw), 6400)), 1.074, rate))
    samples = np.frombuffer(output, dtype="<i2")
    assert abs(len(samples) / rate - seconds / 1.074) < 0.06
    peak_hz = np.fft.rfftfreq(len(samples), 1 / rate)[np.abs(np.fft.rfft(samples.astype(float))).argmax()]
    assert abs(peak_hz - 440) < 2
    assert np.max(np.abs(samples[-1600:])) > 10000


def test_preroll_preserves_order_and_complete_short_stream() -> None:
    blocks = [bytes([i]) * 6400 for i in range(40)]
    assert list(prebuffer_pcm(blocks, 0.02)) == blocks
    assert list(prebuffer_pcm([], 0.02)) == []
    assert list(prebuffer_pcm([b"short"], 0.02)) == [b"short"]


def test_preroll_propagates_source_failure_instead_of_hanging() -> None:
    def broken():
        yield b"start"
        raise ValueError("synthetic failure")
    try:
        list(prebuffer_pcm(broken(), 0.02))
    except ValueError as error:
        assert str(error) == "synthetic failure"
    else:
        raise AssertionError("source error was swallowed")


def test_preroll_finishes_model_source_on_early_close() -> None:
    completed = []
    def blocks():
        for _ in range(40):
            yield b"audio"
        completed.append(True)
    stream = prebuffer_pcm(blocks(), 0.02)
    next(stream)
    stream.close()
    assert completed == [True]
