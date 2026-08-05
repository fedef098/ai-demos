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
fs.writeFileSync(path.join(dir, "narration.json"), JSON.stringify({ voice: META.voice, lang: META.lang, steps: mod.steps }, null, 2));
console.log(path.join(dir, "narration.json"));
