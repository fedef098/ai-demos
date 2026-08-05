/* Central, project-agnostic demo config. Everything that was hard-coded to
   LuxuryApp in the reference lives here and is overridable via env, so the same
   toolkit drives any project's demos. Copy `.env.example` → `.env` per project.

   Determinism: viewport, deviceScaleFactor, fps and crf are FIXED here so every
   re-record of a feature is byte-comparable. Don't randomize them per run. */

const num = (v, d) => (v == null || v === "" ? d : Number(v));

export const cfg = {
  // Target — the LIVE, deployed app (never a dev server; see SKILL.md RAM note).
  baseUrl: process.env.DEMO_URL || "http://localhost:3000",
  pass: process.env.DEMO_PASS || "",

  // Login flow selectors — override per project.
  login: {
    path: process.env.DEMO_LOGIN_PATH || "/login",
    userSel: process.env.DEMO_USER_SEL || "#username",
    passSel: process.env.DEMO_PASS_SEL || "#password",
    submitText: process.env.DEMO_SUBMIT_TEXT || "INICIAR SESIÓN",
    postLoginUrl: process.env.DEMO_POST_LOGIN_URL || "**/dashboard",
  },

  // Narration — Kokoro is the house voice (non-negotiable). ef_dora / e = Spanish.
  voice: process.env.DEMO_VOICE || "ef_dora",
  lang: process.env.DEMO_LANG || "e",

  // Recording — fixed for determinism + repeatable file sizes.
  video: {
    width: num(process.env.DEMO_W, 1600),
    height: num(process.env.DEMO_H, 900),
    deviceScaleFactor: num(process.env.DEMO_DSF, 1),
    fps: num(process.env.DEMO_FPS, 30),
    crf: num(process.env.DEMO_CRF, 22),
  },

  // Subtitles — emit .srt/.vtt from the narration timing; optionally burn-in.
  subtitles: {
    emit: process.env.DEMO_SUBS !== "0", // on by default
    burnIn: process.env.DEMO_BURN_SUBS === "1",
  },
};

export default cfg;
