# Almacenamiento de los binarios

## Dónde queda el video

Cada grabación deja todo junto en `demos/<producto>/<slug>/`:

```
demos/<producto>/<slug>/
  demo.mp4            el video
  poster.jpg          un frame para la miniatura
  demo.vtt            subtítulos
  demo.chapters.vtt   capítulos
  narration.md        el texto de la locución con sus tiempos
  run.json            metadatos (duración, capítulos, commit, bytes, sha256)
  index.html          la página navegable de esta demo
```

**El video no se sube a ningún lado.** Queda en tu disco, al lado del `run.json`,
para mirarlo en la página o bajarlo. `demo.sh --page` arma `demos/index.html` (la
galería) y la `index.html` de cada demo, que referencian el `demo.mp4` local.

## Por qué el video no se versiona

Git **no deltifica H.264**: dos grabaciones de la misma pantalla no comparten
nada a nivel de objeto, así que cada regrabación suma un blob entero y
**permanente**. `git rm` no lo saca — sigue en los packs y se clona igual;
sacarlo de verdad exige reescribir la historia y que todo el equipo re-clone. Un
repo que se recontamina cada vez que alguien regraba no tiene arreglo incremental
— por eso la regla es cero binarios, sin umbral. El `.gitignore` deja afuera
`*.mp4`, `*.webm`, `*.wav`, `*.jpg` y `*.png` bajo `demos/`.

A git van el guion, `selectors.yml`, los seeds, los `.vtt`, `narration.md`,
`run.json`, `catalog.json` y el `index.html`. El `demo.mp4` y el `poster.jpg`
quedan sólo en local: quien quiera el video lo genera corriendo la demo, o se lo
pasás por el canal que uses.

## `run.json`

Un `run.json` por demo, con `video.file` (`"demo.mp4"`), `video.poster`
(`"poster.jpg"`), `durationMs`, `commit`, `bytes` y `sha256`. El `sha256` sirve
para verificar que dos personas tienen la misma grabación aunque el mp4 no esté
en git.
