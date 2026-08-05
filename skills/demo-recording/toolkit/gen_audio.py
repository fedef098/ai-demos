#!/usr/bin/env python3
"""Generate narration with Kokoro for a narration.json, plus a single
concatenated narration.wav padded so each step occupies a fixed slot. Emits
timing.json with the allocated seconds per step for the Playwright recorder.

Kokoro is the house voice (non-negotiable). Voice/lang come from the narration
spec (default ef_dora / e = Spanish).

Usage: gen_audio.py [path/to/narration.json]   (default: ./narration.json)
Outputs narration.wav + timing.json next to the input file."""
import json, os, sys
import numpy as np
import soundfile as sf
from kokoro import KPipeline

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 24000
LEAD = 0.6
GAP = 0.8
MIN_SLOT = 3.0

def main():
    narration_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "narration.json")
    outdir = os.path.dirname(os.path.abspath(narration_path))
    spec = json.load(open(narration_path))
    pipeline = KPipeline(lang_code=spec.get("lang", "e"))
    voice = spec.get("voice", "ef_dora")

    full = [np.zeros(int(LEAD * SR), dtype=np.float32)]
    timing = {"lead": LEAD, "steps": []}

    for step in spec["steps"]:
        chunks = []
        for _, _, audio in pipeline(step["text"], voice=voice):
            chunks.append(np.asarray(audio, dtype=np.float32))
        seg = np.concatenate(chunks) if chunks else np.zeros(int(SR), dtype=np.float32)
        dur = len(seg) / SR
        slot = max(dur + GAP, MIN_SLOT)
        pad = int((slot - dur) * SR)
        full.append(seg)
        full.append(np.zeros(pad, dtype=np.float32))
        # `text` is carried into timing so make-subtitles.mjs can build .srt/.vtt.
        timing["steps"].append({"id": step["id"], "text": step["text"],
                                "speak": round(dur, 2), "slot": round(slot, 2)})
        print(f"  {step['id']}: speak={dur:.2f}s slot={slot:.2f}s")

    out = np.concatenate(full)
    sf.write(os.path.join(outdir, "narration.wav"), out, SR)
    timing["total"] = round(len(out) / SR, 2)
    json.dump(timing, open(os.path.join(outdir, "timing.json"), "w"), indent=2)
    print(f"narration total={timing['total']}s -> {outdir}/narration.wav")

if __name__ == "__main__":
    main()
