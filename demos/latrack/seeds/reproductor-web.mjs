// Seed for reproductor-web (Demo Media / La Brisa, QA only). Read-only video: nothing is
// written to QA.
//
// The player's now-playing line comes from /api/listen/<stationId>, which reads the Play
// rows the stream worker records. La Brisa's QA streams are an English rock / 80s station
// (real artists), so the script answers that one request with a fixture: the show on air is
// the REAL one (fetched here, right before recording) and the songs are a FICTITIOUS
// regional rotation (made-up artists, the same as retencion-salidas). The JSON is handed to
// the fixture through DEMO_VARS (LISTEN_HOUSTON / LISTEN_PHOENIX / LISTEN_MIAMI); nothing
// is inserted, so the worker's own history is never touched.
//
// The radio's site in the last scene is a fixture page too (fixtures/sitio-la-brisa.html,
// served at http://127.0.0.1:8790/ by the engine's route) with the console's iframe code.

import { BRAND_ID, STATIONS, base, ensureAdminSession, setVar, warm } from "./_qa.mjs";

const SONGS = {
  houston: [["Te Fuiste en Abril", "Los Primos del Norte"], ["Cielo de Durango", "Grupo Sierra Alta"], ["Mi Güera", "Banda Mar Azul"], ["Como Antes", "Lupe Arreola"], ["Vamos al Baile", "Los Tigres del Valle"], ["Dos Copas", "Grupo Fuego Lento"]],
  phoenix: [["Desierto", "Norteños de Phoenix"], ["Arriba el Norte", "Los Plebes de Sonora"], ["Tu Recuerdo", "Banda La Costeña"], ["Noche de Luna", "Trío Los Alazanes"], ["Así Te Quiero", "Carmen Ibarra"], ["Entre Copas", "Los Rieleros"]],
  miami: [["Bailando Contigo", "La Sonora de Miami"], ["Siempre Tú", "Grupo Horizonte"], ["Volver a Empezar", "Ana Lucía Paredes"], ["La Cumbia del Sur", "Sonido Laguna"], ["Te Voy a Olvidar", "Grupo Encanto"], ["Al Final del Camino", "Conjunto Río Bravo"]],
};

const now = Date.now();
for (const [city, id] of Object.entries(STATIONS)) {
  const real = await fetch(`${base.origin}/api/listen/${id}`).then((r) => r.json());
  const [cur, ...rest] = SONGS[city];
  const body = {
    show: real.show ?? null,
    current: { title: cur[0], artist: cur[1] },
    recent: rest.map(([title, artist], i) => ({ title, artist, at: new Date(now - (i + 1) * 4 * 60_000).toISOString() })),
  };
  setVar(`LISTEN_${city.toUpperCase()}`, JSON.stringify(body));
  console.log(`reproductor-web: ${city} on air: ${real.show?.name ?? "(no show)"}`);
}

await ensureAdminSession();
await warm([`/brands/${BRAND_ID}`]);
await fetch("https://labrisa-demo.adavance.com/listen").then((r) => r.arrayBuffer()).catch(() => {});
await fetch(`${base.origin}/embed/${BRAND_ID}`).then((r) => r.arrayBuffer()).catch(() => {});
console.log("reproductor-web: fixtures ready (nothing written to QA).");
