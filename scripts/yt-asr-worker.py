#!/usr/bin/env python3
"""
YT-ASR worker for Podiverzum.

Pulls candidate HU episodes from the `external-transcript-ingest` edge function,
downloads audio via yt-dlp (YouTube first, then RSS audio_url fallback), runs
faster-whisper large-v3-turbo locally, and POSTs the transcript back.

Designed to run anywhere: laptop, Hetzner CX22, RunPod, GitHub Actions.

Setup (one-time, on the worker machine):
    pip install -U yt-dlp faster-whisper requests
    # ffmpeg required for yt-dlp:
    #   macOS:  brew install ffmpeg
    #   Debian: sudo apt-get install -y ffmpeg
    # First run downloads the model (~1.5 GB) into ~/.cache/huggingface.

Env vars:
    PODIVERZUM_URL    e.g. https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/external-transcript-ingest
    INGEST_TOKEN      shared secret matching EXTERNAL_TRANSCRIPT_TOKEN on the server
    WHISPER_DEVICE    "cpu" (default) or "cuda" — set to cuda on GPU machines
    WHISPER_COMPUTE   "int8" (cpu default) or "float16" (cuda default)
    BATCH             episodes per claim (default 25)
    LOOP              "1" to run forever (default), "0" for single batch

Usage:
    export PODIVERZUM_URL='https://<project>.supabase.co/functions/v1/external-transcript-ingest'
    export INGEST_TOKEN='<paste-from-lovable-secrets>'
    python3 yt-asr-worker.py
"""
from __future__ import annotations
import os
import sys
import json
import time
import shutil
import tempfile
import subprocess
from pathlib import Path

import requests

URL = os.environ.get("PODIVERZUM_URL", "").rstrip("/")
TOKEN = os.environ.get("INGEST_TOKEN", "")
BATCH = int(os.environ.get("BATCH", "25"))
LOOP = os.environ.get("LOOP", "1") == "1"
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE = os.environ.get("WHISPER_COMPUTE", "float16" if DEVICE == "cuda" else "int8")
MODEL_NAME = os.environ.get("WHISPER_MODEL", "large-v3-turbo")

if not URL or not TOKEN:
    sys.exit("ERROR: set PODIVERZUM_URL and INGEST_TOKEN env vars")

HEADERS = {"x-ingest-token": TOKEN, "Content-Type": "application/json"}

# Lazy-load whisper (heavy import)
_model = None
def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        print(f"[whisper] loading {MODEL_NAME} on {DEVICE} ({COMPUTE})...", flush=True)
        _model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)
    return _model


def claim_jobs(n: int) -> list[dict]:
    r = requests.get(f"{URL}?claim={n}", headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json().get("jobs", [])


def download_audio(job: dict, out_dir: Path) -> Path | None:
    """yt-dlp best audio. Try YouTube first, fallback to direct RSS audio_url."""
    yt = job.get("youtube_video_id")
    audio_url = job.get("audio_url")
    out_tpl = str(out_dir / "audio.%(ext)s")

    sources = []
    if yt:
        sources.append(f"https://www.youtube.com/watch?v={yt}")
    if audio_url:
        sources.append(audio_url)

    for src in sources:
        cmd = [
            "yt-dlp", "-x", "--audio-format", "mp3", "--audio-quality", "9",
            "--no-playlist", "--quiet", "--no-warnings",
            "-o", out_tpl, src,
        ]
        try:
            subprocess.run(cmd, check=True, timeout=600)
            files = list(out_dir.glob("audio.*"))
            if files:
                return files[0]
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            print(f"  [dl] failed {src}: {e}", flush=True)
            continue
    return None


def transcribe(path: Path) -> tuple[str, float]:
    model = get_model()
    segments, info = model.transcribe(
        str(path), language="hu", beam_size=5, vad_filter=True,
    )
    text = " ".join(s.text.strip() for s in segments).strip()
    return text, float(info.duration or 0.0)


def post_transcript(episode_id: str, text: str, duration: float, source: str) -> bool:
    body = {
        "episode_id": episode_id,
        "transcript": text,
        "model": f"faster-whisper-{MODEL_NAME}",
        "language": "hu",
        "duration_seconds": int(duration),
        "source": source,
    }
    r = requests.post(URL, headers=HEADERS, data=json.dumps(body), timeout=60)
    if not r.ok:
        print(f"  [post] {r.status_code} {r.text[:200]}", flush=True)
        return False
    return True


def process_one(job: dict) -> str:
    eid = job["episode_id"]
    title = (job.get("title") or "")[:80]
    print(f"[ep {eid}] {title}", flush=True)
    with tempfile.TemporaryDirectory() as td:
        out_dir = Path(td)
        t0 = time.time()
        audio = download_audio(job, out_dir)
        if not audio:
            print("  -> no audio, skip", flush=True)
            return "no_audio"
        print(f"  dl {time.time()-t0:.1f}s -> {audio.stat().st_size//1024} KB", flush=True)
        t1 = time.time()
        text, duration = transcribe(audio)
        print(f"  asr {time.time()-t1:.1f}s -> {len(text)} chars ({duration:.0f}s audio)", flush=True)
        if len(text) < 50:
            return "empty"
        src = "yt_asr" if job.get("youtube_video_id") else "rss_asr"
        ok = post_transcript(eid, text, duration, src)
        return "ok" if ok else "post_failed"


def main():
    if not shutil.which("yt-dlp"):
        sys.exit("ERROR: yt-dlp not in PATH (pip install yt-dlp)")
    if not shutil.which("ffmpeg"):
        sys.exit("ERROR: ffmpeg not in PATH (install via brew/apt)")

    total = 0
    while True:
        jobs = claim_jobs(BATCH)
        if not jobs:
            print("[idle] no jobs", flush=True)
            if not LOOP: break
            time.sleep(300); continue
        print(f"[batch] {len(jobs)} jobs claimed", flush=True)
        for j in jobs:
            try:
                r = process_one(j)
                total += 1
                print(f"  => {r}  (lifetime: {total})", flush=True)
            except Exception as e:
                print(f"  !! error: {e}", flush=True)
                time.sleep(2)
        if not LOOP: break

if __name__ == "__main__":
    main()
