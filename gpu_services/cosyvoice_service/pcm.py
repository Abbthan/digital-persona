"""Sample-preserving streaming helpers, independent of model loading."""
from __future__ import annotations

import subprocess
import threading
import os
import shutil
import sys
import queue
import time
from pathlib import Path
from collections.abc import Iterable, Iterator

import numpy as np

from .logic import cosine_fade_int16


def prebuffer_pcm(blocks: Iterable[bytes], seconds: float = 0.75) -> Iterator[bytes]:
    """Give synthesis a bounded head start before avatar GPU work begins.

    The clock starts at the first audio block, not request time. Production
    continues on a worker while delivery holds a small FIFO; after startup
    every byte streams normally. At most 16 transport blocks are queued.
    This is not a per-packet delay or whole-utterance buffer.
    """
    if seconds <= 0:
        yield from blocks
        return
    fifo: queue.Queue = queue.Queue(maxsize=16)
    stopped = threading.Event()
    done = object()

    def put(value) -> None:
        while not stopped.is_set():
            try:
                fifo.put(value, timeout=0.1)
                return
            except queue.Full:
                pass

    def produce() -> None:
        try:
            for block in blocks:
                if not stopped.is_set():
                    put(block)
                # On cancellation drain the current inference so the model's
                # per-request caches/LLM thread finish before releasing its lock.
        except BaseException as error:
            put(error)
        finally:
            put(done)

    producer = threading.Thread(target=produce, name="cosyvoice-preroll", daemon=True)
    producer.start()
    try:
        first = fifo.get()
        if first is done:
            return
        if isinstance(first, BaseException):
            raise first
        deadline = time.perf_counter() + min(seconds, 2.0)
        pending = [first]
        finished = False
        while time.perf_counter() < deadline:
            try:
                item = fifo.get(timeout=max(0.001, deadline - time.perf_counter()))
            except queue.Empty:
                break
            if item is done:
                finished = True
                break
            if isinstance(item, BaseException):
                raise item
            pending.append(item)
            if len(pending) >= 16:
                break
        yield from pending
        if not finished:
            while True:
                item = fifo.get()
                if item is done:
                    break
                if isinstance(item, BaseException):
                    raise item
                yield item
    finally:
        stopped.set()
        producer.join()


def fade_stream(chunks: Iterable[np.ndarray], fade_samples: int) -> Iterator[np.ndarray]:
    """Fade only phrase edges, never the boundaries between model packets."""
    pending = np.empty(0, dtype=np.int16)
    first = True
    for chunk in chunks:
        if not chunk.size:
            continue
        pending = np.concatenate((pending, chunk))
        if len(pending) <= 2 * fade_samples:
            continue
        emitted, pending = pending[:-fade_samples], pending[-fade_samples:]
        if first:
            emitted = cosine_fade_int16(emitted, fade_samples, 0)
            first = False
        yield emitted
    if pending.size:
        yield cosine_fade_int16(pending, fade_samples if first else 0, fade_samples)


def tempo_pcm(blocks: Iterable[bytes], speed: float, sample_rate: int) -> Iterator[bytes]:
    """Pitch-preserving continuous tempo; bounded pipes, no WAV buffering.

    CosyVoice2's native speed argument supports non-streaming inference only.
    One FFmpeg atempo filter per reply preserves learned tempo while letting
    the acoustic model emit audio incrementally. It is not restarted per
    packet, and EOF drains the filter's tail before returning.
    """
    if abs(speed - 1.0) < 1e-6:
        yield from blocks
        return
    process = subprocess.Popen(
        [os.environ.get("COSYVOICE_FFMPEG") or shutil.which("ffmpeg") or str(Path(sys.executable).parent / "ffmpeg"),
         "-hide_banner", "-loglevel", "error", "-probesize", "32", "-analyzeduration", "0",
         "-f", "s16le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0",
         "-af", f"atempo={speed:.6f}", "-f", "s16le", "-ar", str(sample_rate), "-ac", "1", "pipe:1"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    errors: list[BaseException] = []
    stopped = threading.Event()

    def produce() -> None:
        try:
            for block in blocks:
                if stopped.is_set():
                    break
                process.stdin.write(block)
                process.stdin.flush()
        except BaseException as error:
            if not stopped.is_set():
                errors.append(error)
        finally:
            process.stdin.close()

    producer = threading.Thread(target=produce, name="cosyvoice-tempo", daemon=True)
    producer.start()
    try:
        while block := process.stdout.read(6400):
            yield block
        producer.join()
        if errors:
            raise RuntimeError("speech source failed during tempo conversion") from errors[0]
        if process.wait(timeout=10) != 0:
            raise RuntimeError("speech tempo conversion failed")
    finally:
        stopped.set()
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        producer.join(timeout=5)
