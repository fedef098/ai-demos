# Latrack demos

Demos of the Latrack radio console, recorded with the engine in
`plugins/demofed/`.

## Environment

- **Always QA**: `https://qa-latrack.adavance.com` (Railway project *Latrack*,
  environment `staging`). The seed refuses any other host and only ever runs
  `railway ssh -e staging`. **Never production** — note that the local Latrack
  checkout is linked to `production` by default, which is why the seed passes
  `-p <project> -e staging -s web` explicitly instead of relying on the link.
- The QA database is only reachable from inside Railway, so the seed writes by
  running a small `pg` script inside the `web` service
  (`/app/node_modules/.pnpm/pg@8.23.1/node_modules/pg`, `DATABASE_URL` of the
  service). You need the Railway CLI logged in with access to the project.
- Nothing is emailed: the invitation is a plain database row.

## Account model

Every run starts from a brand-new world, built by `seeds/onboarding-radio.mjs`:

| What | Value |
|---|---|
| Company | "Radio Sol", slug `radio-sol-demo`, country US, `TRIALING`, 30-day trial. Deleted and recreated on every run, with everything the previous run created: its cascade (brands, stations, shows, slots, home, apps, listener devices and sessions, studio messages, push campaigns) and the rows that point at it without a foreign key (uploaded `Asset` rows, per-station rollups). |
| Owner | Ramiro Gutiérrez, `federicofiorottowork+demo-ramiro+test@gmail.com` — a `+test` alias of our own, used by this demo only. His user is deleted on every run so the invitation is accepted as a new account. |
| Invitation | `COMPANY_ADMIN`, fresh random token each run, 7 days. Only the token's sha256 is stored. |
| Password | `DEMO_OWNER_PW`, typed on camera into a password field (masked). |
| Listener | Lupita, on a phone: the web build of the real listener app (see below), opened with the `publicKey` of the app Ramiro creates on camera. A fresh browser context every run, so a new install id. |

The story creates **everything on camera**: the brand, both stations, the show
and its slot, the home, the store listing, the scheduled push and the
listener's request. Nothing is emailed: the invitation is a database row, and
the email in scene 1 is Latrack's real template (`inviteEmail()`), rendered by
`seeds/render-invite-email.ts` into `assets/invite-email.html` with the link left
as `${INVITE_URL}` — the engine serves it as a fixture and fills in that run's
link, so no token is ever written to the repo. The push is only *scheduled*
(tomorrow 06:00), to an audience with no devices.

## How the seed talks to the script

`bin/demo` gives the seed a `DEMO_VARS` file (600, in the run's temp dir) and
the script reads `${VAR}` from it, live:

| Variable | Value | Written |
|---|---|---|
| `INVITE_URL` | `https://qa…/invite/<token>` (the email's button) | by the seed |
| `APP_PATH` | `/apps/new` | by the seed |
| `PUSH_AT` | tomorrow `T06:00` (America/Chicago) | by the seed |
| `HOME_EDITOR_PATH` | `/brands/<id>/home` | by the watcher, when the brand appears |
| `APP_KEY` | the new app's `publicKey` | by the watcher, when the app appears |

The watcher is a background process the seed leaves polling the database; it
creates nothing and exits when it has both values, when the company is deleted
or after 25 minutes. `bin/demo` runs the seed before `--check` walks the flow and
again before recording, because walking the flow writes.

## The listener app

Scene 11 runs the real listener app (`apps/mobile` in the Latrack repo), web
build pointed at QA, served locally:

```bash
nohup npx --yes serve@14.2.4 -s /tmp/claude-1003/latrack-app-web -l 8787 \
  > /tmp/claude-1003/latrack-app-web.log 2>&1 &
```

It picks the app from `?app=<publicKey>`. Its selectors are the app's own
`testID`s (React Native web renders them as `data-testid`). The listener is a
cast member with `device: iphone`: the engine gives her her own phone context
(390×844, dsf 2, touch, iPhone UA) and pastes that recording into a phone frame.

## Running

```bash
# from the repo root; .env is 600 and gitignored, the engine never reads it
set -a; . demos/latrack/.env; set +a
DEMOS_DIR=demos/latrack bin/demo onboarding-radio --check
flock /tmp/claude-1003/wig-heavy.lock nice -n 15 env DEMOS_DIR=demos/latrack bin/demo onboarding-radio
```

## Assets

`assets/radio-sol-logo.png` (1024 px, the fictional Radio Sol logo) and
`assets/radio-sol-icon-1024.png` (1024×1024, no alpha, the store icon). Radio
Sol is fictional; so are the phone numbers (555) and the `radiosol.example`
addresses typed on camera.

## Module demos (Demo Media / La Brisa)

`marca`, `senales-streams`, `programacion`, `home-app` and `apps-tiendas` run on
the existing **Demo Media** company (brand La Brisa) as `admin@demo.latrack.app`.
Their seeds (`seeds/<slug>.mjs`, helpers in `seeds/lib/qa.mjs`) log in through
the real login form with the password from `~/.config/latrack/logins.json`
(`staging.demo.password`, read into memory, never printed) and cache the session
in `.auth/modulos-admin.json` (600, gitignored) for 50 minutes; the scripts use
it with `auth: { via: storageState }`.

Everything a video creates is named "Demo …" and only that is touched:

| Demo | Creates / changes | Seed resets |
|---|---|---|
| marca | brand "Demo Brisa Norte" (on camera) | deletes it, its logo Asset and audit lines |
| senales-streams | station "Demo La Brisa 1310 Dallas" (on camera); Houston is read only | deletes it |
| programacion | show "Demo Sábado Ranchero" (slots in Houston's weekend gap) and an empty "Demo La Brisa 1310 Los Ángeles" (seeded) | deletes both; Houston's own grid never changes |
| home-app | edits La Brisa's real home (a "Demo · …" block, publish, restore) | snapshots La Brisa's home in `seeds/.state/` and restores it |
| apps-tiendas | app "Demo Brisa Norte", seeded half done; ad rules changed only there | deletes and recreates it |

Every seed also takes `--cleanup` (remove only, or restore La Brisa's home).
Run it right after recording, inside the same lock, so the Demo items never sit
in QA while someone else records:

```bash
flock /tmp/claude-1003/wig-heavy.lock nice -n 15 bash -c \
  'DEMOS_DIR=demos/latrack bin/demo marca; node demos/latrack/seeds/marca.mjs --cleanup'
```

## The single Latrack app, promo and sales (batch nov 2026)

`app-latrack` and `tu-radio-en-latrack` replace `app-oyente` and `apps-tiendas` in
efetrack (`efetrack-map.json`): there is no per-radio app any more, the radio lives
inside Latrack with its brand. `promociona-tu-radio` and `ventas-sponsors` are new.
They use the seeds in `seeds/` (helpers in `seeds/_qa.mjs`, admin session in
`seeds/.state/admin-session.json`); every seed also GETs the pages the video opens,
so the first `go` isn't a cold load.

| Demo | Creates / changes | Seed resets / `--cleanup` |
|---|---|---|
| app-latrack | nothing; the phone opens `/r/la-brisa` on 127.0.0.1:8787 and a "fresh install" on localhost:8787 (another origin, so empty storage). The cast `geolocation:` makes "Cerca de ti" work | takes the duplicate QA "Radio Sol" (company `radio-sol-qa`) out of search while recording; `--cleanup` puts it back |
| tu-radio-en-latrack | flips La Brisa's search switch off and on, turns Shorts off on camera | seed and `--cleanup` leave La Brisa listed with every listener feature on |
| promociona-tu-radio | campaign "Instagram — Diciembre" (on camera) | deletes it and its stats. Also sets three weeks of web taps and app opens for "Feria de Primavera" and "Al aire — Mañanas" (demo data that stays; no store taps or installs, the app isn't in the stores yet) |
| ventas-sponsors | nothing; the sponsored push is typed but never sent | only checks the package, proposal, push and report exist |

The La Brisa logo (`assets/la-brisa-logo.{svg,png}`) uses the brand's console
colours, #0F172A and #F59E0B, and is the logo uploaded to La Brisa in QA.

## Batch 2 (nov 2026)

| Demo | Creates / changes | Seed resets / `--cleanup` |
|---|---|---|
| alertas-stream | Ana turns Houston's alerts on (recipients @demo.latrack.app, which `sendEmail` skips as undeliverable). Two FICTITIOUS open incidents (Phoenix, Miami; alerts on, no recipients) and a closed one for Houston's history, ids `demo_inc_*` | alerts off on the three stations, demo incidents deleted |
| retencion-salidas | nothing on camera; a FICTITIOUS rotation of regional songs (made-up artists, ids `demoplay_*`) under the demo sessions, 26 to 2 days ago | deletes the demo plays |
| me-lo-perdi | nothing (read only) | — |
| cabina-voz-foto | "Vero Salinas" (fictitious) sends a voice note (`assets/cabina-nota-voz.wav` through `fakeMicrophone:`) and a photo (`assets/cabina-foto-carro.jpg`) | deletes Vero's messages; Marisol's stay |
| concursos-consentimiento | "Daniela Ríos" enters the giveaway from the app; four fictitious participants `demo_ce_*` | deletes them and Daniela's entry, keeps `demo_ce_1` |
| pagina-web-radio | hides "Concursos activos" and moves "Me lo perdí" up in Tu página web, and saves | restores La Brisa's `webPage` from `seeds/.state/webpage-la-brisa.json` |

QA behind Cloudflare is slow from this VPS (1–2 s per console page, occasional 20 s
timeouts). The console demos above (all but pagina-web-radio, which shows public URLs)
were recorded against the Railway origin, `DEMO_BASE_URL=https://web-staging-52227612.up.railway.app`:
the seeds accept that host and the engine copies the session cookie to it. The listener
app is the web export with the fast-open changes (3f1752a, 9b71011), served on
127.0.0.1:8787. Don't record while a QA deploy is rolling out: the charts' client
chunks failed to load mid-deploy and the retention video came out with empty charts.

## Batch 3 (27 nov 2026): two distribution models, domains, onboarding

`tus-apps` replaces `tu-radio-en-latrack` (efetrack `apps-tiendas`), `puesta-en-marcha`
replaces `onboarding-radio` (efetrack `puesta-en-marcha`), `pagina-producto` was rewritten for
the two models and `pagina-web-radio` gained the «Tu dominio» scene.

| Demo | Creates / changes | Seed resets / `--cleanup` |
|---|---|---|
| tus-apps | nothing (read only): La Brisa's own app (`cmwz6uubq000201r0mnuy2ipo`, demo data that stays, with its two queued 1.0.0 builds), `/admin/builds` as superadmin, and the phone on the own app | checks the own app and its queued builds exist |
| puesta-en-marcha | a demo request, the company «Radio Sol de Tucson» (FICTITIOUS) from it, the owner's account from the invitation, the brand's logo and colours, the station and its stream; a watcher re-keys the invitation (INVITE_URL) and, once the station exists, seeds three shows and a published home | deletes the company (cascade), its assets / rollups / link stats / audit lines, the owner's user and the demo requests of the contact email |
| pagina-producto | nothing; the form is filled but not sent | — |

- The contact of `puesta-en-marcha` is `federicofiorottowork+latrack-onboarding@gmail.com`, a
  real alias of the owner: the receipt of the demo request, the sales notice and the invitation
  are real emails. `/producto` rate-limits demo requests to 5 per hour per IP: a `--check` plus
  a recording is 2.
- The superadmin session (`seeds/.state/superadmin-session.json`, 600) is minted from
  `staging.superadmin` in `~/.config/latrack/logins.json` (`ensureSuperadminSession`).
- The own app's phone is the same web export of the listener app with `?app=<publicKey>`, served
  on 127.0.0.1:8788 (a fresh origin): on web that key makes it behave as an own app. A web
  export does not bake `LATRACK_APP_KEY` (Expo's web build carries no `expoConfig.extra`), so
  building one with it changes nothing.
- The automatic subdomain (`<slug>.qa-latrack.adavance.com`) and the custom domain
  `labrisa-demo.adavance.com` answer over HTTPS since 27/11 18:00; `pagina-web-radio` opens the
  latter and `puesta-en-marcha` closes on the new radio's subdomain.
- Engine: a phone scene now loads its destination before the desktop goes black (it used to
  load behind the curtain: 3–4 s of black), and the phone label sits below the chapter pill.

## Batch 4 (27 nov 2026): no car metric, web player

Since latrack 71f610d (`CAR_PLAY_SHIPPED = false`) the console Estadísticas, the media kit and
`/producto` no longer show listening in the car. `estadisticas`, `retencion-salidas` and
`pagina-producto` were re-recorded without it (`pagina-producto` lost its «web» scene: the card
still reads «y pronto en el auto»). `reproductor-web` is new (efetrack `reproductor-web`).

| Demo | Creates / changes | Seed resets / `--cleanup` |
|---|---|---|
| reproductor-web | nothing. The show on air is the real one; the songs are a FICTITIOUS rotation answered to `/api/listen/<stationId>` by fixtures (`fixtures/listen-*.json`, filled through DEMO_VARS by the seed), so the stream worker's Play rows are never touched. The radio's site is `fixtures/sitio-la-brisa.html`, served by the engine's route at `http://127.0.0.1:8790/` with the console's exact iframe code | — |

- Record `reproductor-web` against `DEMO_BASE_URL=https://qa-latrack.adavance.com`, not the Railway
  origin: the console's embed code prints the origin it is opened on.
- Engine: a cross-origin iframe no longer gets the overlay (its black cover was never lifted and the
  embed came out as a black bar), and the chapter pill is put back after navigating to another
  origin (it lived in the previous origin's sessionStorage).

## Batch 5 (27 nov 2026): superadmin, emails

| Demo | Creates / changes | Seed resets / `--cleanup` |
|---|---|---|
| superadmin | a demo request row for the FICTITIOUS «Radio Sol de Laredo» (no email); on camera the company is created from it, which sends the REAL first-admin invitation to `federicofiorottowork+latrack-onboarding@gmail.com` (never accepted). «Entrar» opens Demo Media; the build queue is read only | deletes the company (cascade: brand, home draft, invitation), its audit lines / assets and the demo request |
| emails | nothing is emailed. The emails are Latrack's real templates rendered by `seeds/render-emails.ts` into `fixtures/correo/*.html` (fictitious data, fake blurred links) and served at `https://correo.latrack-demo.invalid/<id>`. Houston's alerts are turned on with Ana and Diego (@demo.latrack.app, undeliverable) for the console moment; the team form is typed, never sent | Houston's alerts back off with no recipients, as found |

- Re-render the inbox when the templates change:
  `PUBLIC_BASE_URL=https://qa-latrack.adavance.com ../latrack/apps/web/node_modules/.bin/tsx demos/latrack/seeds/render-emails.ts`.
- Both blur the songs QA's stream reports (a real third-party station): the console home's
  «Sonando» line and the station's «Lo que sonó».
