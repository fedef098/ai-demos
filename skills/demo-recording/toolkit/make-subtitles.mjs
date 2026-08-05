/* Build .srt + .vtt subtitles for a module from build/<id>/timing.json.
   Timestamps account for the LEAD silence and the login loadTime offset (the
   same adelay build-modules.sh applies to the audio), so subs line up with the
   narration in the final mp4. Emits build/<id>/<id>.srt and <id>.vtt.

   IMPORTANT (learned): one cue per narration step produces 4+ line blocks that
   cover the screen. So each step's text is RE-SEGMENTED into short phrase cues
   (<= DEMO_SUB_MAXCHARS chars, one line each) whose timings are distributed
   across the step window in proportion to phrase length — subtitles then "pass
   by" phrase-by-phrase in sync with the voice instead of dumping a paragraph.
   Set DEMO_SUB_MAXCHARS=0 to keep the old one-cue-per-step behaviour. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const id = process.argv[2];
if (!id) { console.error("usage: make-subtitles.mjs <id>"); process.exit(1); }
const dir = path.join(HERE, "build", id);
const timing = JSON.parse(fs.readFileSync(path.join(dir, "timing.json"), "utf8"));
const offset = fs.existsSync(path.join(dir, "offset.json"))
  ? JSON.parse(fs.readFileSync(path.join(dir, "offset.json"), "utf8")).loadTime || 0
  : 0;

// Max characters per subtitle line. 0 disables resegmentation (one cue/step).
const MAXCHARS = process.env.DEMO_SUB_MAXCHARS == null ? 46 : Number(process.env.DEMO_SUB_MAXCHARS);

const fmt = (t, sep) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const f = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s}${sep}${f}`;
};

// Greedily split text into <=MAXCHARS chunks at word boundaries, preferring to
// break right after sentence/clause punctuation once a chunk is a decent size.
function phrases(text) {
  if (!MAXCHARS || MAXCHARS <= 0) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length > MAXCHARS && cur) {
      out.push(cur);
      cur = w;
    } else {
      cur = cand;
      if (/[,.;:!?]$/.test(w) && cur.length >= Math.min(24, MAXCHARS / 2)) {
        out.push(cur);
        cur = "";
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Build per-step [start,end] windows first (same clock the recorder uses),
// then resegment each step's text into short phrase cues spread across it.
let cursor = offset + (timing.lead || 0.6);
const cues = [];
for (const step of timing.steps) {
  const speak = step.speak || Math.max(0, (step.slot || 3) - 0.8);
  const start = cursor;
  const end = cursor + Math.min(speak, (step.slot || speak) - 0.05);
  if (step.text) {
    const ph = phrases(step.text.trim());
    const totalLen = ph.reduce((n, p) => n + p.length, 0) || 1;
    let t = start;
    const span = Math.max(0.001, end - start);
    for (const p of ph) {
      const d = (span * p.length) / totalLen;
      cues.push({ start: t, end: t + d, text: p });
      t += d;
    }
  }
  cursor += step.slot || 3;
}

const srt = cues.map((c, i) =>
  `${i + 1}\n${fmt(c.start, ",")} --> ${fmt(c.end, ",")}\n${c.text}\n`).join("\n");
const vtt = "WEBVTT\n\n" + cues.map((c) =>
  `${fmt(c.start, ".")} --> ${fmt(c.end, ".")}\n${c.text}\n`).join("\n");

fs.writeFileSync(path.join(dir, `${id}.srt`), srt);
fs.writeFileSync(path.join(dir, `${id}.vtt`), vtt);
console.log(`[${id}] subtitles -> build/${id}/${id}.srt + .vtt (${cues.length} cues)`);
