# BlueButterfly (WIG) demos

Recorded against QA: https://qa-app.bluebutterfly.com (never a dev server).

| Demo | What it shows | efetrack |
|---|---|---|
| `secrets-vault` | The whole secrets vault: from the plan to Settings → Secrets, adding a secret, showing a value and the view history, `@` mentions in Important Notes and the Secrets tab, a trusted contact opening what was shared, a contact without access | BlueButterfly → Secrets vault, "Demo narrada — Secrets vault" |
| `secrets-vault-own-keys` | Per-owner encryption keys: a copied value does not open, old secrets migrate on their own | not uploaded (superseded) |

## Running

```bash
export WIG_RAILWAY_PROJECT=<WIG Railway project id> DEMO_BASE_URL=https://qa-app.bluebutterfly.com
(cd demos/wig && node seeds/secrets-vault.mjs)    # right before recording: the 2FA mark lasts 10 min
DEMOS_DIR=demos/wig bin/demo secrets-vault
```

The seeds run their remote half inside `backend-staging` with `railway ssh` (they need the API's
own code to seal secrets) and write one `storageState` per person to `seeds/.state/` (mode 600,
gitignored). They never print a session.

Accounts (all `+test` aliases of the team mailbox, so they stay out of the metrics):
`federicofiorottowork+vaultdemo+test` (Maria, owner, premium), `+vaultdemocontact+test` (Lucas,
may see secrets), `+vaultdemonoaccess+test` (Ana, may not). Passwords live in
`~/.claude/wig-credentials.env`, never here.

Voice: English scripts set `narration: { voice: af_heart, lang: a }`; the engine's default voice
is Spanish.
