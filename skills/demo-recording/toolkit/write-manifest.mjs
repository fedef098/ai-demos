/* Build/refresh demos/index.json from the rows publish.sh just uploaded.
   Merges with an existing manifest (passed on stdin as JSON, or empty) so the
   index accumulates across runs. Each entry: name, url, feature, commit, date,
   bytes. Reads rows as CSV lines "name,url,bytes" on argv[1] (a file path). */
import fs from "fs";

const rowsFile = process.argv[2];
const commit = process.env.DEMO_COMMIT || "";
const date = process.env.DEMO_DATE || ""; // caller passes an ISO date (scripts have no clock)

let prev = [];
try { prev = JSON.parse(fs.readFileSync(0, "utf8")).demos || []; } catch {}

const rows = fs.readFileSync(rowsFile, "utf8").trim().split("\n").filter(Boolean);
const byName = new Map(prev.map((d) => [d.name, d]));
for (const line of rows) {
  const [name, url, bytes] = line.split(",");
  if (!name || !url || url === "UPLOAD_FAILED") continue;
  byName.set(name, {
    name,
    feature: name.replace(/\.mp4$/, ""),
    url,
    commit,
    date,
    bytes: Number(bytes) || undefined,
  });
}
const manifest = { generatedAt: date, count: byName.size, demos: [...byName.values()] };
process.stdout.write(JSON.stringify(manifest, null, 2));
