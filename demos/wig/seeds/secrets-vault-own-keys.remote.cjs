// Runs INSIDE backend-staging (QA), from /app/api. Prints one line: SEED_RESULT <json>.
// Idempotent: same two +test accounts every run, the owner's secrets rebuilt from scratch.
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { TokenService } = require('./dist/common/jwt/token.service.js');
const { encryptAtRest } = require('./dist/common/security/secret-at-rest.util.js');
const { TwoFactorCodeService } = require('./dist/modules/two-factor/two-factor-code.service.js');
const { PlanSecretsService } = require('./dist/modules/plan-secrets/plan-secrets.service.js');
const { SharedPlanService } = require('./dist/services/sharedPlanService.service.js');
const p = new PrismaClient();

const OWNER = { email: 'federicofiorottowork+vaultowner+test@gmail.com', firstName: 'Maria', lastName: 'Sanchez' };
const CONTACT = { email: 'federicofiorottowork+vaultcontact+test@gmail.com', firstName: 'Sam', lastName: 'Sanchez' };

async function account(who) {
  const found = await p.user.findUnique({ where: { email: who.email } });
  if (found) return p.user.update({ where: { id: found.id }, data: { firstName: who.firstName, lastName: who.lastName, isTestAccount: true, emailConfirmed: true, termsAcceptedAt: found.termsAcceptedAt ?? new Date() } });
  return p.user.create({ data: { id: randomUUID(), email: who.email, firstName: who.firstName, lastName: who.lastName, isTestAccount: true, emailConfirmed: true, termsAcceptedAt: new Date() } });
}

(async () => {
  const owner = await account(OWNER);
  const contact = await account(CONTACT);

  await p.trustedContact.deleteMany({ where: { ownerUserId: owner.id } });
  await p.trustedContact.create({
    data: {
      ownerUserId: owner.id, contactEmail: contact.email, contactName: 'Sam Sanchez',
      securityKey: randomUUID().slice(0, 12), invitedUserId: contact.id,
      completedSetup: true, accessVerifiedAt: new Date(), canSeeSecrets: true, accessOnDeath: false,
    },
  });

  await p.planSecret.deleteMany({ where: { ownerUserId: owner.id } });
  const vault = new PlanSecretsService(p, new SharedPlanService(p), { send: async () => undefined });
  // Netflix: written before the change, on the app-wide key (v1), as the old code did.
  await p.planSecret.create({ data: { ownerUserId: owner.id, kind: 'login', title: encryptAtRest('Netflix'), username: encryptAtRest('maria.sanchez@example.com'), secret: encryptAtRest('Movie-Night-1984') } });
  const wifi = await vault.create(owner.id, { title: 'Home Wi-Fi', username: 'SanchezHome', secret: 'Gulf-Breeze-2024', shared: true, shareTiming: 'now' });
  const router = await vault.create(owner.id, { title: 'Old router', username: 'admin', secret: 'placeholder' });
  // The proof: the Wi-Fi's sealed value copied onto the router's row.
  const sealed = await p.planSecret.findUniqueOrThrow({ where: { id: wifi.id }, select: { secret: true } });
  await p.planSecret.update({ where: { id: router.id }, data: { secret: sealed.secret } });
  // Order the list: Netflix and the Wi-Fi first, the router last.
  await p.planSecret.update({ where: { id: router.id }, data: { createdAt: new Date(Date.now() + 1000) } });

  // The "recently verified" mark lives in Redis; wait for it, or it lands in this process's memory.
  const { sharedRedisReady } = require('./dist/common/redis/shared-redis.js');
  if (!(await sharedRedisReady())) throw new Error('Redis not reachable: the 2FA mark would not reach the API');
  const tokens = {};
  const codes = new TwoFactorCodeService(p, {});
  for (const [role, u] of [['owner', owner], ['contact', contact]]) {
    const fresh = await p.user.findUniqueOrThrow({ where: { id: u.id } });
    const token = await new TokenService().sign({ userId: fresh.id, email: fresh.email, tokenVersion: fresh.tokenVersion }, '2h');
    await codes.markVerified(token, fresh.id);
    tokens[role] = token;
  }
  // Sam opens Maria's plan, so she needs one: created through the API, like the app does.
  if (!(await p.planMember.count({ where: { userId: owner.id } }))) {
    const r = await fetch(`http://127.0.0.1:${process.env.PORT || 8080}/prisma/plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${process.env.AUTH_COOKIE_NAME || 'wig_token'}=${tokens.owner}`, ...(process.env.TURNSTILE_BYPASS_KEY ? { 'x-test-key': process.env.TURNSTILE_BYPASS_KEY } : {}) },
      body: '{}',
    });
    if (!r.ok) throw new Error(`plan create ${r.status}`);
  }
  console.log('SEED_RESULT ' + JSON.stringify({ ownerId: owner.id, cookieName: process.env.AUTH_COOKIE_NAME || 'wig_token', tokens }));
  await p.$disconnect();
  process.exit(0);
})().catch((e) => { console.log('SEED_ERROR ' + e.message); process.exit(1); });
