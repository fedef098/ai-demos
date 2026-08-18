#!/usr/bin/env python3
"""Sintetiza un lote de frases con Kokoro y deja un WAV por frase.

Se invoca desde voice.mjs con el lote entero por stdin:

    {"voice": "ef_dora", "lang": "e", "items": [{"text": "...", "out": "/abs/a.wav"}]}

y devuelve por stdout una línea JSON por item: {"out": "...", "ok": true}.

── Por qué un solo proceso para todo el lote ────────────────────────────────
Importar kokoro y cargar los pesos tarda ~8 s. Una demo tiene 15-25 cues: un
proceso por cue serían 3 minutos de import contra ~15 s de síntesis real. El
lote se sintetiza en una sola carga del modelo.

── Por qué Kokoro y no un TTS cloud ────────────────────────────────────────
Corre local, no cuesta por caracter y no manda el guion del producto a un
tercero. La voz alcanza para una demo que ve un cliente, que es exactamente lo
que espeak-ng NO logra.
"""

import json
import sys

SAMPLE_RATE = 24000


def main() -> int:
    spec = json.load(sys.stdin)
    items = spec.get("items", [])
    if not items:
        return 0

    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    pipeline = KPipeline(lang_code=spec.get("lang", "e"))
    voice = spec.get("voice", "ef_dora")

    for item in items:
        chunks = []
        # Kokoro parte internamente en oraciones y emite un tensor por trozo.
        for _, _, audio in pipeline(item["text"], voice=voice):
            chunks.append(np.asarray(audio, dtype=np.float32))

        if not chunks:
            print(json.dumps({"out": item["out"], "ok": False, "error": "sin audio"}), flush=True)
            continue

        sf.write(item["out"], np.concatenate(chunks), SAMPLE_RATE)
        print(json.dumps({"out": item["out"], "ok": True}), flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
