// Seed for retencion-salidas (Demo Media / La Brisa, QA only).
//
// The retention curve and the per-show table come from the demo listening sessions. The
// song list needs now-playing history (Play rows) under those sessions, and La Brisa's QA
// streams are an English rock station. The seed adds a FICTITIOUS rotation (made-up artists) of regional
// Mexican songs to the three stations, every 4 minutes from 06:00 to 23:00 (station time),
// from 26 days ago to 2 days ago (so "Lo que sonó" still shows the real latest plays).
// Their ids start with demoplay_; `--cleanup` deletes them.

import { BRAND_ID, ensureAdminSession, isCleanup, remote, warm } from "./_qa.mjs";

// Fictitious artists and songs (no real artist is shown "losing" listeners). The first
// three are "slow" ones: the play after them is dropped, so they run twice as long and more
// listeners leave during them; that gives the list a real top instead of a flat 6 %.
const SLOW = 3;
const SONGS = [
  ["Los Primos del Norte", "Te Fuiste en Abril"], ["Banda Los Laureles", "Corrido del Ranchito"], ["Mariana Solís", "Ya No Te Extraño"],
  ["Grupo Sierra Alta", "Cielo de Durango"], ["Los Hermanos Treviño", "La Troca Roja"], ["Banda Mar Azul", "Mi Güera"],
  ["Conjunto Río Bravo", "Al Final del Camino"], ["Lupe Arreola", "Como Antes"], ["Los Tigres del Valle", "Vamos al Baile"],
  ["Norteño Show", "Cumbia de la Brisa"], ["Grupo Fuego Lento", "Dos Copas"], ["Carmen Ibarra", "Así Te Quiero"],
  ["Los Plebes de Sonora", "Arriba el Norte"], ["Banda La Costeña", "Tu Recuerdo"], ["Trío Los Alazanes", "Noche de Luna"],
  ["Sonido Laguna", "La Cumbia del Sur"], ["Los Rieleros", "Entre Copas"], ["Grupo Encanto", "Te Voy a Olvidar"],
  ["Banda El Mezquite", "El Sinaloense de Houston"], ["Ana Lucía Paredes", "Volver a Empezar"], ["Los Compas del Bajío", "Mañanitas para Mamá"],
  ["Norteños de Phoenix", "Desierto"], ["La Sonora de Miami", "Bailando Contigo"], ["Grupo Horizonte", "Siempre Tú"],
];

const [res] = remote(`
  await q("delete from \\"Play\\" where id like 'demoplay_%'");
  let n = 0;
  if (!P.cleanup) {
    const st = await q('select id, timezone from "Station" where "brandId" = $1', [P.b]);
    for (const s of st) {
      await q(\`
        insert into "Play" (id, "stationId", title, artist, "isMusic", "startedAt")
        select 'demoplay_' || md5(random()::text || t::text), $1, ($3::text[])[k], ($4::text[])[k], true, t
        from (
          select t, 1 + (abs(hashtext(t::text || $1)) % array_length($3::text[], 1)) as k
          from generate_series(date_trunc('day', now() - interval '26 days'), date_trunc('day', now() - interval '2 days'), interval '4 minutes') t
          where extract(hour from t at time zone 'UTC' at time zone $2) between 6 and 22
        ) x\`, [s.id, s.timezone, P.songs.map((x) => x[1]), P.songs.map((x) => x[0])]);
      // Drop the play after each "slow" song, so it runs 8 minutes instead of 4.
      await q(\`
        delete from "Play" p using (
          select id, lag(title) over (order by "startedAt") prev from "Play" where "stationId" = $1 and id like 'demoplay_%'
        ) x where p.id = x.id and x.prev = any($2::text[])\`, [s.id, P.songs.slice(0, P.slow).map((x) => x[1])]);
    }
    n = (await q("select count(*)::int n from \\"Play\\" where id like 'demoplay_%'"))[0].n;
  }
  out({ n });
`, { b: BRAND_ID, songs: SONGS, slow: SLOW, cleanup: isCleanup });
if (!isCleanup) { await ensureAdminSession(); await warm(["/analytics"]); }
console.log(`retencion-salidas: ${isCleanup ? "demo song rotation removed" : `${res.n} demo plays in place`}.`);
