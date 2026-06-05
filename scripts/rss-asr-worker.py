#!/usr/bin/env python3
"""
RSS-audio ASR worker for Podiverzum (PoC).

POLICY (hard stops):
  * NO yt-dlp, NO YouTube, NO Spotify content. RSS audio_url only.
  * Single batch (max 20 episodes), no loop, no cron.
  * public_display always false; rights_status server-side = rss_public_index_only.

Flow per job:
  1. Stream-download audio_url to a temp file (max 500 MB, 600s timeout).
  2. ffmpeg → mono 16 kHz WAV.
  3. faster-whisper large-v3-turbo (HU, VAD filter), keep segments.
  4. POST transcript + segments + latency_ms + audio_bytes (source=rss_audio_asr).
  5. On error: POST status='failed' + error_reason (still audited).

Setup (one time):
    python -m venv .venv && source .venv/bin/activate
    python -m pip install -U requests faster-whisper
    # ffmpeg: brew install ffmpeg  |  apt-get install -y ffmpeg

Env vars:
    PODIVERZUM_URL    https://<ref>.supabase.co/functions/v1/external-transcript-ingest
    INGEST_TOKEN      shared secret = EXTERNAL_TRANSCRIPT_TOKEN
    WORKER_ID         e.g. "$(hostname)-poc"
    WHISPER_DEVICE    cpu (default) | cuda
    WHISPER_COMPUTE   int8 (cpu) | float16 (cuda)
    BATCH             default 20 (hard-capped to 20)
"""
from __future__ import annotations
import os, sys, json, time, shutil, tempfile, subprocess, traceback
from pathlib import Path

import requests

URL = os.environ.get("PODIVERZUM_URL", "").rstrip("/")
TOKEN = os.environ.get("INGEST_TOKEN", "")
WORKER_ID = os.environ.get("WORKER_ID", "rss-asr-poc")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE = os.environ.get("WHISPER_COMPUTE", "float16" if DEVICE == "cuda" else "int8")
MODEL_NAME = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
BATCH = min(int(os.environ.get("BATCH", "20")), 20)  # hard cap

UA = "PodiverzumTranscriptWorker/0.1 (research; contact: hello@podiverzum.hu)"
MAX_AUDIO_BYTES = 500 * 1024 * 1024  # 500 MB
DL_TIMEOUT = 600

if not URL or not TOKEN:
    sys.exit("ERROR: set PODIVERZUM_URL and INGEST_TOKEN env vars")

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
    "User-Agent": UA,
}

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


def download_audio(audio_url: str, out_path: Path) -> int:
    """Stream-download. Returns bytes written. Raises on size/HTTP errors."""
    with requests.get(audio_url, stream=True, timeout=DL_TIMEOUT,
                      headers={"User-Agent": UA}) as r:
        r.raise_for_status()
        total = 0
        with open(out_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 256):
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_AUDIO_BYTES:
                    raise RuntimeError(f"audio too large (> {MAX_AUDIO_BYTES} bytes)")
                f.write(chunk)
        return total


def to_wav_16k_mono(src: Path, dst: Path) -> None:
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(src),
        "-ac", "1", "-ar", "16000", "-vn",
        str(dst),
    ]
    subprocess.run(cmd, check=True, timeout=900)


def transcribe(path: Path) -> tuple[str, list[dict], float]:
    model = get_model()
    segments_iter, info = model.transcribe(
        str(path), language="hu", beam_size=5, vad_filter=True,
    )
    segs = []
    parts = []
    for s in segments_iter:
        t = (s.text or "").strip()
        if not t:
            continue
        parts.append(t)
        segs.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": t})
    return " ".join(parts).strip(), segs, float(info.duration or 0.0)


def post(payload: dict) -> bool:
    try:
        r = requests.post(URL, headers=HEADERS, data=json.dumps(payload), timeout=120)
        if not r.ok:
            print(f"  [post] {r.status_code} {r.text[:300]}", flush=True)
            return False
        return True
    except Exception as e:
        print(f"  [post] exception: {e}", flush=True)
        return False


def process_one(job: dict) -> dict:
    eid = job["episode_id"]
    audio_url = job.get("audio_url") or ""
    title = (job.get("title") or "")[:80]
    print(f"[ep {eid}] {title}", flush=True)
    if not audio_url.startswith("http"):
        post({"episode_id": eid, "source": "rss_audio_asr", "status": "skipped",
              "error_reason": "no audio_url", "worker_id": WORKER_ID})
        return {"status": "skipped", "reason": "no_audio_url"}

    t0 = time.time()
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / "audio.bin"
        wav = Path(td) / "audio.wav"
        try:
            audio_bytes = download_audio(audio_url, src)
            print(f"  dl {time.time()-t0:.1f}s -> {audio_bytes//1024} KB", flush=True)
        except Exception as e:
            post({"episode_id": eid, "source": "rss_audio_asr", "status": "failed",
                  "error_reason": f"download: {e}"[:500], "worker_id": WORKER_ID})
            return {"status": "failed", "reason": f"download: {e}"}

        try:
            to_wav_16k_mono(src, wav)
        except Exception as e:
            post({"episode_id": eid, "source": "rss_audio_asr", "status": "failed",
                  "error_reason": f"ffmpeg: {e}"[:500], "audio_bytes": audio_bytes,
                  "worker_id": WORKER_ID})
            return {"status": "failed", "reason": f"ffmpeg: {e}"}

        t1 = time.time()
        try:
            text, segs, duration = transcribe(wav)
        except Exception as e:
            post({"episode_id": eid, "source": "rss_audio_asr", "status": "failed",
                  "error_reason": f"asr: {e}"[:500], "audio_bytes": audio_bytes,
                  "worker_id": WORKER_ID})
            return {"status": "failed", "reason": f"asr: {e}"}
        asr_s = time.time() - t1
        latency_ms = int((time.time() - t0) * 1000)
        print(f"  asr {asr_s:.1f}s -> {len(text)} chars ({duration:.0f}s audio, "
              f"RTF {asr_s/max(duration,1):.2f}x)", flush=True)

        if len(text) < 50:
            post({"episode_id": eid, "source": "rss_audio_asr", "status": "failed",
                  "error_reason": "empty transcript", "audio_bytes": audio_bytes,
                  "duration_seconds": int(duration), "latency_ms": latency_ms,
                  "worker_id": WORKER_ID})
            return {"status": "failed", "reason": "empty"}

        ok = post({
            "episode_id": eid,
            "transcript": text,
            "segments": segs,
            "model": f"faster-whisper-{MODEL_NAME}",
            "language": "hu",
            "duration_seconds": int(duration),
            "audio_bytes": audio_bytes,
            "latency_ms": latency_ms,
            "source": "rss_audio_asr",
            "status": "ok",
            "worker_id": WORKER_ID,
        })
        return {
            "status": "ok" if ok else "post_failed",
            "chars": len(text),
            "duration_s": int(duration),
            "audio_bytes": audio_bytes,
            "asr_s": round(asr_s, 1),
            "rtf": round(asr_s / max(duration, 1), 3),
        }


def main():
    if not shutil.which("ffmpeg"):
        sys.exit("ERROR: ffmpeg not in PATH")
    jobs = claim_jobs(BATCH)
    print(f"[batch] claimed {len(jobs)} job(s) (cap {BATCH})", flush=True)
    if not jobs:
        return

    results = []
    for j in jobs:
        try:
            r = process_one(j)
        except Exception as e:
            traceback.print_exc()
            r = {"status": "failed", "reason": f"unhandled: {e}"}
        results.append({"episode_id": j["episode_id"], **r})

    print("\n=== PoC sample table ===", flush=True)
    print(f"{'episode_id':36}  status     chars   dur(s)  RTF", flush=True)
    for r in results:
        print(f"{r['episode_id']:36}  {r['status']:10} "
              f"{r.get('chars',''):>6}  {r.get('duration_s',''):>6}  "
              f"{r.get('rtf','')}", flush=True)

    ok = sum(1 for r in results if r["status"] == "ok")
    print(f"\nsummary: {ok}/{len(results)} ok", flush=True)


if __name__ == "__main__":
    main()
