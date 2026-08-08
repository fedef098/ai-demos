// Writes build/<id>/narration.json for a module id (from modules.mjs).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MODULES, META } from "./modules.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const id = process.argv[2];
const mod = MODULES.find((m) => m.id === id);
if (!mod) { console.error("unknown module", id); process.exit(1); }
const dir = path.join(HERE, "build", id);
fs.mkdirSync(dir, { recursive: true });
// Merge per-step minSlot overrides (seconds) from minslots.json if present. The
// sync loop writes these from measured action times so each step's slot is >=
// its on-screen action time and the recorder never desyncs.
const minslotsPath = path.join(HERE, "minslots.json");
const minslots = fs.existsSync(minslotsPath)
  ? JSON.parse(fs.readFileSync(minslotsPath, "utf8"))
  : {};
const steps = mod.steps.map((s) =>
  minslots[s.id] ? { ...s, minSlot: minslots[s.id] } : s,
);
fs.writeFileSync(path.join(dir, "narration.json"), JSON.stringify({ voice: META.voice, lang: META.lang, steps }, null, 2));
console.log(path.join(dir, "narration.json"));
