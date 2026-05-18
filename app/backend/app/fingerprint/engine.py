from __future__ import annotations

import hashlib
import struct
import subprocess

import numpy as np
from scipy.ndimage import maximum_filter
from scipy.signal import spectrogram as _scipy_spectrogram

SAMPLE_RATE = 22050
WINDOW_SIZE = 4096
HOP_LENGTH = 512
FAN_VALUE = 15
MAX_HASH_TIME_DELTA = 200
PEAK_NEIGHBORHOOD = 20
PEAK_PERCENTILE = 75  # only keep peaks above this percentile of the spectrogram


def fingerprint_file(path: str) -> list[tuple[int, int]]:
    """Fingerprint an audio file on disk. Returns list of (hash_int, time_offset)."""
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", path,
            "-ac", "1", "-ar", str(SAMPLE_RATE),
            "-f", "f32le", "-",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=True,
    )
    return _fingerprint_pcm(np.frombuffer(result.stdout, dtype=np.float32))


def fingerprint_bytes(audio_bytes: bytes) -> list[tuple[int, int]]:
    """Fingerprint raw audio bytes (any format FFmpeg can decode)."""
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", "pipe:0",
            "-ac", "1", "-ar", str(SAMPLE_RATE),
            "-f", "f32le", "pipe:1",
        ],
        input=audio_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=True,
    )
    return _fingerprint_pcm(np.frombuffer(result.stdout, dtype=np.float32))


def _fingerprint_pcm(samples: np.ndarray) -> list[tuple[int, int]]:
    if len(samples) < WINDOW_SIZE:
        return []

    _, _, Sxx = _scipy_spectrogram(
        samples,
        fs=SAMPLE_RATE,
        nperseg=WINDOW_SIZE,
        noverlap=WINDOW_SIZE - HOP_LENGTH,
        window="hann",
    )
    Sxx_db = 10.0 * np.log10(np.maximum(Sxx, 1e-10))

    struct_el = np.ones((PEAK_NEIGHBORHOOD, PEAK_NEIGHBORHOOD))
    local_max = maximum_filter(Sxx_db, footprint=struct_el) == Sxx_db
    floor = float(np.percentile(Sxx_db, PEAK_PERCENTILE))
    freq_idxs, time_idxs = np.where(local_max & (Sxx_db > floor))

    peaks = sorted(zip(freq_idxs.tolist(), time_idxs.tolist()), key=lambda p: p[1])

    result: list[tuple[int, int]] = []
    for i, (f1, t1) in enumerate(peaks):
        for j in range(1, FAN_VALUE + 1):
            if i + j >= len(peaks):
                break
            f2, t2 = peaks[i + j]
            dt = t2 - t1
            if dt <= 0 or dt > MAX_HASH_TIME_DELTA:
                continue
            data = struct.pack(">HHH", f1 & 0xFFFF, f2 & 0xFFFF, dt & 0xFFFF)
            h = struct.unpack(">I", hashlib.sha1(data).digest()[:4])[0]
            result.append((h, t1))

    return result
