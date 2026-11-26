// Runs INSIDE backend-staging (QA), from /app/api. Resets the vault demo account
// (federicofiorottowork+vaultdemo+test) to its starting state and prints one
// line: SEED_RESULT <json> with short-lived sessions for the three people.
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { TokenService } = require('./dist/common/jwt/token.service.js');
const { TwoFactorCodeService } = require('./dist/modules/two-factor/two-factor-code.service.js');
const { PlanSecretsService } = require('./dist/modules/plan-secrets/plan-secrets.service.js');
const { SharedPlanService } = require('./dist/services/sharedPlanService.service.js');
const { sharedRedisReady } = require('./dist/common/redis/shared-redis.js');
const p = new PrismaClient();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

(async () => {
  if (!(await sharedRedisReady())) throw new Error('Redis not reachable: the 2FA mark would not reach the API');
  const user = (email) => p.user.findUniqueOrThrow({ where: { email } });
  const maria = await user('federicofiorottowork+vaultdemo+test@gmail.com');
  const lucas = await user('federicofiorottowork+vaultdemocontact+test@gmail.com');
  const ana = await user('federicofiorottowork+vaultdemonoaccess+test@gmail.com');

  await p.trustedContact.updateMany({ where: { ownerUserId: maria.id, invitedUserId: lucas.id }, data: { canSeeSecrets: true, accessOnDeath: false } });
  await p.trustedContact.updateMany({ where: { ownerUserId: maria.id, invitedUserId: ana.id }, data: { canSeeSecrets: false, accessOnDeath: false } });

  await p.planSecret.deleteMany({ where: { ownerUserId: maria.id } });
  const vault = new PlanSecretsService(p, new SharedPlanService(p), { send: async () => undefined });
  const chase = await vault.create(maria.id, { kind: 'bank', title: 'Chase checking', username: 'maria.lopez', secret: 'Tampa-Sunset-1957', url: 'https://www.chase.com', notes: 'Account ending 4821. The mortgage autopay comes out of here.', shared: true, shareTiming: 'now' });
  const wifi = await vault.create(maria.id, { kind: 'device', title: 'Home Wi-Fi', username: 'LopezHome', secret: 'Gulf-Breeze-2024', notes: 'The router is in the hall closet.', shared: true, shareTiming: 'after_death' });
  await vault.create(maria.id, { kind: 'login', title: 'Personal Gmail', username: 'maria.lopez.demo@gmail.com', secret: 'Orange-Grove-88', url: 'https://mail.google.com' });
  await vault.revealForContact(maria.id, chase.id, { userId: lucas.id, email: lucas.email }, 'https://qa-app.bluebutterfly.com');

  const tag = (s) => `<span class="secret-mention" data-secret-id="${s.id}">${esc(s.title)}</span>`;
  const plan = await p.plan.findFirstOrThrow({ where: { userId: maria.id }, orderBy: { createdAt: 'asc' } });
  const note = {
    id: randomUUID(), title: 'Banking and bills', username: 'Maria Lopez', createdAt: new Date().toISOString(), required: true,
    richText: `<p>Everything for the bills is with ${tag(chase)}&nbsp;and the Wi-Fi is ${tag(wifi)}&nbsp;for whoever stays at the house.</p>`,
    plainText: `Everything for the bills is with ${chase.title} and the Wi-Fi is ${wifi.title} for whoever stays at the house.`,
    secretIds: [chase.id, wifi.id],
  };
  const step = await p.planStep.findFirst({ where: { planId: plan.id, stepKey: 'important_notes' } });
  if (step) await p.planStep.update({ where: { id: step.id }, data: { data: { importantNotes: [note] } } });
  else await p.planStep.create({ data: { planId: plan.id, stepKey: 'important_notes', data: { importantNotes: [note] } } });

  const codes = new TwoFactorCodeService(p, {});
  const tokens = {};
  for (const [role, u] of [['maria', maria], ['lucas', lucas], ['ana', ana]]) {
    const token = await new TokenService().sign({ userId: u.id, email: u.email, tokenVersion: u.tokenVersion }, '2h');
    await codes.markVerified(token, u.id);
    tokens[role] = token;
  }
  console.log('SEED_RESULT ' + JSON.stringify({ ownerId: maria.id, cookieName: process.env.AUTH_COOKIE_NAME || 'wig_token', tokens }));
  await p.$disconnect();
  process.exit(0);
})().catch((e) => { console.log('SEED_ERROR ' + e.message); process.exit(1); });
