// Seed for mensajes-cabina (Demo Media / La Brisa, QA only).
//
// Leaves the studio inbox with four fresh, unopened listener messages at La Brisa
// 101.1 Houston, so the host has something to triage on camera. Idempotent: first
// removes what earlier runs left — the seeded rows (installId "demo-video-*") and
// the request the listener sends on camera (matched by its exact text). Nothing
// else in the inbox is touched. `--cleanup` only removes, for after recording.

import { STATIONS, ensureAdminSession, isCleanup, remote } from "./_qa.mjs";

export const ON_CAMERA = "¿Me ponen “Ella Baila Sola” para mi hermana en Katy?";

const MESSAGES = [
  // [minutes ago, kind, name, body]
  [3, "REQUEST", "Lupe Treviño", "¿Me ponen “La Bachata” de Manuel Turizo? Saludos desde Pasadena."],
  [7, "DEDICATION", "Marco Salinas", "Para mi esposa Carmen, que hoy cumple 30. ¡Te amo, flaca!"],
  [12, "MESSAGE", "Rosa Elizondo", "Atorada en la 610, pero con ustedes el tráfico se pasa rápido."],
  [18, "REQUEST", "Julián Ortega", "Algo de Grupo Frontera para arrancar el viernes, porfa."],
];

const [res] = remote(`
  await q('begin');
  const del = await q(
    'delete from "StudioMessage" where "stationId" = any($1) and ("installId" like $2 or body = $3) returning id',
    [P.stations, 'demo-video-%', P.onCamera]);
  if (!P.cleanup) {
    for (const [i, [ago, kind, name, body]] of P.messages.entries()) {
      await q(
        'insert into "StudioMessage" (id, "stationId", "installId", kind, name, body, status, "createdAt") values ($1, $2, $3, $4::"MessageKind", $5, $6, $7::"MessageState", now() - make_interval(mins => $8))',
        ['demo_msg_' + i + '_' + Date.now().toString(36), P.houston, 'demo-video-' + i, kind, name, body, 'NEW', ago]);
    }
  }
  await q('commit');
  out({ deleted: del.length });
`, { stations: Object.values(STATIONS), houston: STATIONS.houston, onCamera: ON_CAMERA, messages: MESSAGES, cleanup: isCleanup });

if (!isCleanup) await ensureAdminSession();
console.log(`mensajes-cabina: removed ${res.deleted} earlier demo message(s)${isCleanup ? "" : `, seeded ${MESSAGES.length} unopened ones at La Brisa 101.1`}.`);
