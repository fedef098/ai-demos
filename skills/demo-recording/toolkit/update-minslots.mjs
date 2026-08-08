// Reads build/<id>/sync-report.json and writes minslots.json so every step's
// slot >= its measured action time + buffer. Idempotent: only raises values.
import fs from "fs";
const id = process.argv[2] || "memorials";
const BUFFER_S = 0.7;
const report = JSON.parse(fs.readFileSync(`build/${id}/sync-report.json`, "utf8"));
const cur = fs.existsSync("minslots.json") ? JSON.parse(fs.readFileSync("minslots.json", "utf8")) : {};
let changed = 0;
for (const s of report) {
  const need = Math.ceil((s.actionMs / 1000 + BUFFER_S) * 10) / 10;
  if (!cur[s.id] || need > cur[s.id]) { cur[s.id] = need; changed++; }
}
fs.writeFileSync("minslots.json", JSON.stringify(cur, null, 2));
const overruns = report.filter((s) => s.overrunMs > 120);
console.log(`overruns this run: ${overruns.length} [${overruns.map(s=>s.id+'+'+s.overrunMs).join(', ')}]`);
console.log(`minslots updated: ${changed} step(s) raised`);
