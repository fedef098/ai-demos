/* TEMPLATE — copy to modules.mjs and adapt per project.

   A module = { id, title, steps[{id,text}], run(d, finish) }. The narration
   audio is synthesized per step; the recorder plays step K's audio during the
   wall-clock window [sumSlots(0..K-1), sumSlots(0..K)]. `finish(stepId)` waits
   until that window ends. So:

   ▸ THE finish() CONTRACT: each step's actions must take LESS time than that
     step's narration. If they do, finish() pads the remainder and audio+video
     stay in perfect sync. If a step's actions OVERRUN its narration, the video
     falls behind the audio for the rest of the module (visible desync). Keep
     per-step actions short, or make the narration longer.

   Three patterns below encode lessons that are easy to get wrong. See
   LEARNINGS.md for the full write-up. */

export const META = { voice: "ef_dora", lang: "e" }; // English: voice af_heart, lang a

const ADMIN = "admin@example.com"; // real login (password comes from .env DEMO_PASS)

// ── Helper: scroll down a bit, then settle. ──────────────────────────────────
async function scrollDown(d, px = 500) {
  await d.page.mouse.wheel(0, px);
  await d.sleep(800);
}

// ── Helper for LIVE AI assistants / anything with an async response ──────────
// PIPELINING: send a question and return the promise that resolves when the
// real answer arrives. Send it at the END of the PREVIOUS step so the answer is
// already on screen when the step that describes it plays. Why: chat inputs are
// usually disabled while a response streams, so you can't pre-send more than one
// ahead — and LLM responses (5–20s) are slower than a single narration line.
// Also make each assistant step's narration LONG (~15s) so it covers the wait.
async function sendQuestion(d, text) {
  const ta = d.page.locator('textarea[aria-label="Message to assistant"]');
  await d.clickLoc(ta);
  await d.page.keyboard.type(text, { delay: 12 });
  const res = d.page
    .waitForResponse((r) => r.url().includes("/api/assistant"), { timeout: 90000 })
    .catch(() => {});
  await d.clickLoc(d.page.locator('button[aria-label="Send message"]'));
  return res;
}

export const MODULES = [
  {
    // ONE continuous module → ONE login. Don't split a walkthrough into several
    // modules and concat them: each recording logs in again, so the final video
    // logs in N times. A single module logs in once and nav()s everywhere.
    id: "walkthrough",
    title: "Product walkthrough",
    steps: [
      {
        id: "intro",
        // If the data on screen is seeded/mock, SAY SO up front and point at the
        // real-data toggle — otherwise viewers think the numbers are real.
        text: "This is the product. Heads up: the data on screen is sample data, loaded so we can show how everything works — there's a switch in Settings to flip to real, live data.",
      },
      {
        id: "overview",
        text: "We start on the overview: the handful of numbers that matter most, right at the top where you can take them in at a glance.",
      },
      {
        // SCROLL = ITS OWN STEP. Never scroll inside a step whose narration is
        // still describing the top ("at the top you can see…") — the scroll will
        // race ahead of the words. Give the scroll its own step whose narration
        // literally says "scrolling down…", so motion matches speech.
        id: "overview_more",
        text: "Scrolling down, we get the trend over time and where people are coming from.",
      },
      {
        id: "detail_open",
        text: "Let's open a detail view. Right at the top, the headline result and the single biggest drop-off.",
      },
      {
        id: "detail_chart",
        text: "Scrolling down now, the full breakdown, step by step.",
      },
      // ── Assistant Q&A (pipelined; note the long narration per step) ──
      {
        id: "bot_intro",
        text: "There's an assistant on every screen for the folks who aren't analysts. You open it from the corner and ask, in plain language, whatever you want to know — it's built to be genuinely easy.",
      },
      {
        id: "bot_explain",
        text: "First it teaches: ask what a metric means and it answers like a patient colleague, no jargon, nicely formatted, so anyone can follow along without a background in analytics.",
      },
      {
        id: "bot_data",
        text: "And it doesn't just explain — it reads the live data. Ask how things are going and it pulls the real numbers behind the screen and hands you a short, plain summary of what stands out.",
      },
    ],

    async run(d, finish) {
      // ─ one login for the whole video ─
      await d.login(ADMIN);
      await d.nav("/overview");
      await d.hover("h1");
      await d.sleep(600);
      await finish("intro");

      await d.hover('[class*="grid"]'); // KPI cards at the top
      await d.sleep(600);
      await finish("overview");

      await scrollDown(d, 480); // motion happens while narration says "scrolling down"
      await d.hover("svg, canvas");
      await finish("overview_more");

      // Detail: open, and describe the TOP without scrolling yet.
      await d.clickLoc(d.page.locator('a:has-text("Full conversion")').first());
      await d.sleep(1500);
      await d.hover("h1");
      await d.sleep(500);
      await d.hover('[class*="grid"]');
      await finish("detail_open");

      await scrollDown(d, 400); // now scroll, matched to "scrolling down now"
      await d.hover("svg, canvas");
      await finish("detail_chart");

      // ─ Assistant: open once, pipeline the questions ─
      await d.nav("/overview");
      await d.sleep(700);
      await d.clickLoc(d.page.locator('button[aria-label="Open analytics assistant"]').first());
      await d.sleep(1100);
      await d.hover('textarea[aria-label="Message to assistant"]');
      let pending = await sendQuestion(d, "In simple terms, what does bounce rate mean?");
      await finish("bot_intro");

      await pending;                // answer to Q1 is on screen during bot_explain
      await d.sleep(1200);
      pending = await sendQuestion(d, "How is the site doing right now? Give me the headline numbers.");
      await finish("bot_explain");

      await pending;                // answer to Q2 is on screen during bot_data
      await d.sleep(1600);
      await finish("bot_data");
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CRUD apps (admin panels): the same run() can create + modify real records.
// Non-negotiable there: create AND edit, fill ALL fields (selects/dates/uploads),
// and exercise an RBAC-restricted role. Reusable helpers:
//
// async function create(d, { typeSel, value, fills = {}, selects = {}, uploads = {} }) {
//   await d.clickLoc(d.page.locator('button:has-text("Add")').first()); await d.sleep(800);
//   if (typeSel) await d.typeInto(d.page.locator(typeSel), value);       // one field on camera
//   for (const [s, v] of Object.entries(fills))   await d.page.fill(s, v).catch(() => {}); // rest bulk-filled
//   for (const [t, o] of Object.entries(selects)) await d.pickSelect(t, o);
//   for (const [s, f] of Object.entries(uploads)) { await d.page.setInputFiles(s, f).catch(() => {}); await d.sleep(900); }
//   await d.clickLoc(d.page.locator('button:has-text("Create")').first()); await d.sleep(1000);
// }
// ─────────────────────────────────────────────────────────────────────────────

export const byId = (id) => MODULES.find((m) => m.id === id);
