from __future__ import annotations

import json
import os
import subprocess
import tempfile

import structlog

logger = structlog.get_logger(__name__)

_BITRATES = {
    "mp3_64k": ("64k", "libmp3lame"),
    "mp3_128k": ("128k", "libmp3lame"),
    "mp3_192k": ("192k", "libmp3lame"),
    "mp3_320k": ("320k", "libmp3lame"),
}

_HLS_BITRATES = {
    "hls_64k": "64k",
    "hls_128k": "128k",
    "hls_320k": "320k",
}

_HLS_SEGMENT_DURATION = 10  # seconds


def _run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    logger.debug("ffmpeg_cmd", cmd=" ".join(cmd))
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def transcode_to_mp3(input_path: str, output_path: str, bitrate: str = "128k") -> None:
    _run([
        "ffmpeg", "-y", "-i", input_path,
        "-vn",                    # strip video/artwork streams
        "-ar", "44100",           # sample rate
        "-ac", "2",               # stereo
        "-b:a", bitrate,
        "-codec:a", "libmp3lame",
        output_path,
    ])


def transcode_to_hls(input_path: str, output_dir: str, bitrate: str = "128k") -> str:
    """Transcode *input_path* to HLS segments in *output_dir*.

    Returns the path to the generated .m3u8 playlist file.
    """
    os.makedirs(output_dir, exist_ok=True)
    playlist_path = os.path.join(output_dir, "playlist.m3u8")
    segment_pattern = os.path.join(output_dir, "seg%03d.ts")

    _run([
        "ffmpeg", "-y", "-i", input_path,
        "-vn",
        "-ar", "44100",
        "-ac", "2",
        "-b:a", bitrate,
        "-codec:a", "aac",
        "-hls_time", str(_HLS_SEGMENT_DURATION),
        "-hls_list_size", "0",
        "-hls_segment_filename", segment_pattern,
        "-f", "hls",
        playlist_path,
    ])
    return playlist_path


def generate_waveform_peaks(input_path: str, num_peaks: int = 1000) -> list[float]:
    """Return a list of normalised amplitude peaks (0.0–1.0) using FFmpeg.

    Uses the ``astats`` filter to sample RMS levels at regular intervals.
    """
    try:
        result = _run([
            "ffmpeg", "-y", "-i", input_path,
            "-af", f"aresample=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
            "-f", "null", "-",
        ], check=False)

        raw = result.stderr + result.stdout
        peaks = []
        for line in raw.splitlines():
            if "lavfi.astats.Overall.RMS_level=" in line:
                try:
                    val = float(line.split("=")[-1].strip())
                    # Convert dBFS to 0-1 range (typical range -80 to 0 dBFS)
                    normalised = max(0.0, min(1.0, (val + 80) / 80))
                    peaks.append(round(normalised, 4))
                except ValueError:
                    continue

        # Downsample or pad to num_peaks
        if not peaks:
            return [0.0] * num_peaks
        if len(peaks) > num_peaks:
            step = len(peaks) / num_peaks
            peaks = [peaks[int(i * step)] for i in range(num_peaks)]
        elif len(peaks) < num_peaks:
            peaks += [0.0] * (num_peaks - len(peaks))

        return peaks

    except Exception as exc:
        logger.warning("waveform_generation_failed", path=input_path, error=str(exc))
        return [0.0] * num_peaks


def get_duration(input_path: str) -> float | None:
    """Return duration in seconds using ffprobe."""
    try:
        result = _run([
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            input_path,
        ])
        data = json.loads(result.stdout)
        return float(data.get("format", {}).get("duration", 0) or 0)
    except Exception as exc:
        logger.warning("ffprobe_duration_failed", path=input_path, error=str(exc))
        return None
