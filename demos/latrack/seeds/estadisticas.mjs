// Seed for estadisticas (Demo Media / La Brisa, QA only). Read-only video: the
// listening data is Demo Media's own demo data, so the seed only makes sure the
// admin's console session exists. Nothing is created or changed.

import { ensureAdminSession } from "./_qa.mjs";

await ensureAdminSession();
console.log("estadisticas: nothing to seed (read-only); admin session ready.");
