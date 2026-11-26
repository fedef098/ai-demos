// Seed for secrets-vault-own-keys, against QA. Runs the remote half inside
// backend-staging (it needs the API's own code to seal the secrets) and writes
// the two sessions as storageState files. Never prints a token.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = process.env.WIG_RAILWAY_PROJECT;
if (!project) throw new Error('Set WIG_RAILWAY_PROJECT (the Railway project id of WIG).');
const b64 = readFileSync(join(here, 'secrets-vault-own-keys.remote.cjs')).toString('base64');
const out = execFileSync('railway', ['ssh', '-p', project, '-e', 'staging', '-s', 'backend-staging',
  `cd /app/api && echo ${b64} | base64 -d > ./.seed.cjs && node ./.seed.cjs; rm -f ./.seed.cjs`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 20 });
const line = out.split('\n').find((l) => l.startsWith('SEED_RESULT ') || l.startsWith('SEED_ERROR '));
if (!line || line.startsWith('SEED_ERROR')) throw new Error(`Seed failed: ${line ?? 'no result line'}`);
const { ownerId, cookieName, tokens } = JSON.parse(line.slice('SEED_RESULT '.length));

const app = new URL(process.env.DEMO_BASE_URL ?? 'https://qa-app.bluebutterfly.com');
const expires = Math.floor(Date.now() / 1000) + 7200;
const stateDir = join(here, '.state');
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
for (const [role, token] of Object.entries(tokens)) {
  const cookies = [
    { name: cookieName, value: token, domain: '.bluebutterfly.com', path: '/', expires, httpOnly: true, secure: true, sameSite: 'Lax' },
    { name: 'cookieconsent_status', value: 'deny', domain: app.hostname, path: '/', expires, httpOnly: false, secure: true, sameSite: 'Lax' },
    { name: 'wig_automation', value: '1', domain: app.hostname, path: '/', expires, httpOnly: false, secure: true, sameSite: 'Lax' },
  ];
  const file = join(stateDir, `${role}.json`);
  writeFileSync(file, JSON.stringify({ cookies, origins: [] }));
  chmodSync(file, 0o600);
}
writeFileSync(join(stateDir, 'env'), `DEMO_OWNER_ID=${ownerId}\n`);
console.log(`seeded: owner ${ownerId.slice(0, 8)}…, sessions written to seeds/.state/`);
