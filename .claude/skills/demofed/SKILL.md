---
name: demofed
description: >
  Graba demos de producto guionadas con Playwright: una historia de usuario
  contada en video, con locución neural local, subtítulos quemados y en .vtt,
  capítulos y una página HTML navegable. El video queda local — no se sube a
  ningún lado. Lleva un catálogo de qué está demoable y qué no. Trae cinco
  arquetipos listos para copiar (onboarding, CRUD, búsqueda, panel admin,
  checkout). Arranca SIEMPRE reconociendo la sección en el código y entrevistando
  sobre alcance, audiencia y datos, y muestra el guion para aprobación antes de
  grabar. Usala cuando pidan una demo de un flujo de la app, cuando haya que
  actualizar una demo existente, o cuando pregunten qué cubre una demo y qué no.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(node *), Bash(npx *), Bash(npm *), Bash(ffmpeg *), Bash(ffprobe *), Bash(./bin/demo *), Bash(engine/runner/*)
argument-hint: [qué demo hay que grabar o actualizar]
---

# demofed — grabar demos de producto

El motor vive en `engine/` y se corre con `bin/demo`. **Antes de escribir o grabar
nada, leé `engine/GUIDE.md`**: es el flujo completo —reconocer la sección,
entrevistar sobre alcance/audiencia/datos, mostrar el guion para aprobación, y
recién después grabar—. El detalle por tema está en `engine/references/` y los
arquetipos para copiar en `engine/archetypes/`.

Reglas que no se saltan:

- **La primera respuesta a "grabá una demo" es la entrevista**, no un guion. Un
  pedido detallado no la reemplaza.
- **El guion se aprueba antes de grabar.** Vive en `demos/<producto>/<slug>.demo.yml`
  y no tiene selectores: ésos van en `demos/<producto>/selectors.yml`.
- **Se graba contra una URL desplegada** (`DEMO_BASE_URL`), nunca un dev server.
- **El video queda local** en `demos/<producto>/<slug>/` (mp4, poster, página).
  No se sube a ningún lado y no va a git; quien lo quiera lo mira en la página o
  lo baja.

Comandos:

```bash
npm run doctor                                                              # chequea la máquina
DEMOS_DIR=demos/<producto> DEMO_BASE_URL=<url> bin/demo <slug> --check      # valida sin grabar (~20 s)
DEMOS_DIR=demos/<producto> DEMO_BASE_URL=<url> bin/demo <slug>              # graba
DEMOS_DIR=demos/<producto> bin/demo --catalog                              # qué está demoable y qué no
DEMOS_DIR=demos/<producto> bin/demo --page                                 # regenerar la página local
```
