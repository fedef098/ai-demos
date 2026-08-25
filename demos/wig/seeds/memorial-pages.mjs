/**
 * Seed for the `memorial-pages` demo.
 *
 * Puts the world into the state the script asserts, and nothing else:
 *
 *   · Marion's plan already holds her life story, her Memorial page photo and
 *     her Memorial page song — the demo shows those crossing over to the page,
 *     so they must exist BEFORE the recording starts. Nothing is configured on
 *     camera.
 *   · She has no memorial page yet, so the create flow is available and the
 *     public address `marion-ellis` is free to be minted on first publish.
 *   · A signed-in session is written to `.auth/owner.json` for the recorder.
 *
 * Everything goes through the product's own HTTP API with Marion's session —
 * no direct database writes — so a run of this seed exercises the same code
 * paths a person clicking through the app would.
 *
 * Idempotent: run it twice and the second run only deletes the page the first
 * recording created. Existing plan content is left exactly as it is.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMOS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_FILE = resolve(DEMOS_DIR, '.auth/owner.json');
const PORTRAIT = resolve(DEMOS_DIR, 'assets/marion-ellis.jpg');

const API = required('WIG_DEMO_API_URL').replace(/\/$/, '');
const EMAIL = required('WIG_DEMO_EMAIL');
const PASSWORD = required('WIG_DEMO_PASSWORD');

const MEMORIAL_PAGE_PLACEMENT = 'memorial_page';
const MEMORIAL_PAGE_CATEGORY = 'Memorial page';

const LIFE_STORY = [
    'I was born in Savannah in 1955, the third of five, in a house that was never once quiet.',
    '',
    'I taught fourth grade at Charles Ellis for thirty-one years. Somewhere out there are two thousand adults who can still name every state capital because I made them sing it, and I have never once apologised for that.',
    '',
    'I married Ray in 1978 under the oak on Jones Street and we stayed on that street for the rest of it. The garden was mine. The tomatoes were mine. The chair on the porch was, officially, his.',
    '',
    'If you are reading this, sit down. Have something. Tell somebody the version of the story where I come off well.',
].join('\n');

const SONG = { title: 'Beyond the Sea', artist: 'Bobby Darin' };

main().catch((error) => {
    console.error(`\n✖ seed: ${error.message}`);
    process.exit(1);
});

async function main() {
    const cookies = await signIn();
    const planId = await ownPlanId(cookies);
    console.log(`  · plan ${planId}`);

    await ensureLifeStory(cookies, planId);
    await ensureMemorialPagePhoto(cookies, planId);
    await ensureMemorialPageSong(cookies, planId);
    await removeExistingMemorialPages(cookies);

    mkdirSync(dirname(AUTH_FILE), { recursive: true });
    writeFileSync(AUTH_FILE, JSON.stringify({ cookies }, null, 2));
    console.log(`  · session written to demos/.auth/owner.json`);
}

async function ownPlanId(cookies) {
    const plans = await api(cookies, '/api/prisma/plans');
    if (!plans?.length) throw new Error(`${EMAIL} has no plan`);
    return plans[0].id;
}

// ── the world ───────────────────────────────────────────────────────────────

/**
 * The life story the page will pull in. It lives in a published obituary, which
 * is also where the page reads the subject's name and birthday from — that is
 * what makes the public address deterministic instead of depending on how the
 * account's name happens to be spelled.
 */
async function ensureLifeStory(cookies, planId) {
    const existing = await api(cookies, `/api/prisma/obituaries?planId=${planId}`);
    const published = existing.find((row) => row.isPublished);
    if (published) {
        console.log('  · life story already published in the plan');
        return;
    }

    await api(cookies, '/api/prisma/obituaries', {
        method: 'POST',
        json: {
            planId,
            fullName: 'Marion Ellis',
            birthday: '1955-04-12',
            birthPlace: 'Savannah, Georgia',
            spouseName: 'Ray Ellis',
            content: LIFE_STORY,
            draftContent: LIFE_STORY,
            status: 'published',
            isPublished: true,
            generatedWithAI: false,
        },
    });
    console.log('  · life story published in the plan');
}

/**
 * One photo, filed under the Memorial page group. The group is the whole point
 * of the scene: photos in any other group never reach the page.
 */
async function ensureMemorialPagePhoto(cookies, planId) {
    const files = await api(cookies, `/api/prisma/plans/${planId}/files`);
    const already = files.some(
        (file) =>
            file.object_type === 'photo' &&
            file.placement === MEMORIAL_PAGE_PLACEMENT,
    );
    if (already) {
        console.log('  · Memorial page photo already in the plan');
        return;
    }

    const form = new FormData();
    form.append(
        'file',
        new File([readFileSync(PORTRAIT)], 'marion-ellis.jpg', {
            type: 'image/jpeg',
        }),
    );
    form.append('bucket', 'photos');
    form.append('prefix', `${planId}/${MEMORIAL_PAGE_PLACEMENT}`);

    const uploaded = await api(cookies, '/api/storage/upload', {
        method: 'POST',
        body: form,
    });

    await api(cookies, `/api/prisma/plans/${planId}/files`, {
        method: 'POST',
        json: {
            plan_id: planId,
            file_name: 'marion-ellis.jpg',
            file_type: 'image/jpeg',
            file_url: uploaded.url,
            type: 'image',
            object_type: 'photo',
            placement: MEMORIAL_PAGE_PLACEMENT,
            name: 'Marion, on the porch',
            description: 'Jones Street, the summer before she started planning.',
            sort_index: 0,
        },
    });
    console.log('  · Memorial page photo uploaded and filed');
}

/**
 * The song, in the music step's Memorial page category. Artwork and the preview
 * come from Deezer, the same source the picker in the app uses — so the page
 * plays a real recording rather than a silent row. If Deezer is unreachable the
 * song is still seeded, just without artwork.
 */
async function ensureMemorialPageSong(cookies, planId) {
    const steps = await api(cookies, `/api/prisma/plans/${planId}/steps`);
    const musicStep = steps.find((step) => step.step_key === 'music');
    const data = musicStep?.data && typeof musicStep.data === 'object' ? musicStep.data : {};
    const music = Array.isArray(data.music) ? data.music : [];

    if (music.some((song) => song?.schedule === MEMORIAL_PAGE_CATEGORY)) {
        console.log('  · Memorial page song already in the plan');
        return;
    }

    const track = await deezerTrack(`${SONG.title} ${SONG.artist}`);
    music.push({
        id: `demo-${MEMORIAL_PAGE_PLACEMENT}-song`,
        name: SONG.title,
        artistName: SONG.artist,
        albumName: track?.album?.title,
        artwork: track?.album?.cover_medium,
        previewUrl: track?.preview,
        isrc: track?.isrc,
        schedule: MEMORIAL_PAGE_CATEGORY,
        sortIndex: music.length,
    });

    await api(cookies, `/api/prisma/plans/${planId}/steps`, {
        method: 'POST',
        json: {
            plan_id: planId,
            step_key: 'music',
            status: 'completed',
            // The whole `data` object, merged: a partial write would silently
            // drop every other key the music step holds.
            data: { ...data, music },
        },
    });
    console.log(`  · Memorial page song seeded${track ? '' : ' (no artwork — Deezer unreachable)'}`);
}

/**
 * The demo creates the page on camera, so it must not exist when recording
 * starts — and deleting it is also what frees the `marion-ellis` address, which
 * is minted from her name on the first publish and would otherwise collide with
 * the page the previous run published.
 */
async function removeExistingMemorialPages(cookies) {
    const page = await api(cookies, '/api/memorial?page=1&limit=50');
    const memorials = page.memorials ?? page.items ?? [];
    if (memorials.length === 0) {
        console.log('  · no memorial page to clear');
        return;
    }
    for (const memorial of memorials) {
        await api(cookies, `/api/memorial/${memorial.id}`, { method: 'DELETE' });
    }
    console.log(`  · cleared ${memorials.length} memorial page(s) from a previous run`);
}

// ── plumbing ────────────────────────────────────────────────────────────────

/**
 * The paths below are written as the frontend writes them, `/api/...`, and the
 * `/api` is stripped here — exactly what `apiFetch` does. The NestJS backend
 * mounts its controllers without the prefix, so keeping the frontend's spelling
 * is what makes these calls greppable against the services they mirror.
 */
function backendUrl(path) {
    return `${API}${path.replace(/^\/api/, '')}`;
}

async function signIn() {
    const res = await fetch(backendUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!res.ok) {
        throw new Error(`login failed (${res.status}) — check WIG_DEMO_EMAIL / WIG_DEMO_PASSWORD`);
    }
    const cookies = res.headers.getSetCookie().map(playwrightCookie);
    if (cookies.length === 0) throw new Error('login returned no cookie');
    console.log(`  · signed in as ${EMAIL}`);
    return cookies;
}

/**
 * A Set-Cookie header as Playwright's addCookies() wants it. The domain matters
 * more than it looks: the API and the app are different subdomains, so a cookie
 * pinned to the API host would never be sent by the page being recorded.
 */
function playwrightCookie(header) {
    const [pair, ...attributes] = header.split(';').map((part) => part.trim());
    const separator = pair.indexOf('=');
    const cookie = {
        name: pair.slice(0, separator),
        value: pair.slice(separator + 1),
        domain: new URL(API).hostname,
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
    };
    for (const attribute of attributes) {
        const [key, value = ''] = attribute.split('=').map((part) => part.trim());
        const name = key.toLowerCase();
        if (name === 'domain') cookie.domain = value;
        else if (name === 'path') cookie.path = value;
        else if (name === 'httponly') cookie.httpOnly = true;
        else if (name === 'secure') cookie.secure = true;
        else if (name === 'samesite') cookie.sameSite = capitalise(value);
        else if (name === 'expires') cookie.expires = Math.floor(Date.parse(value) / 1000);
    }
    return cookie;
}

async function api(cookies, path, { method = 'GET', json, body } = {}) {
    const res = await fetch(backendUrl(path), {
        method,
        headers: {
            cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
            ...(json ? { 'Content-Type': 'application/json' } : {}),
        },
        body: json ? JSON.stringify(json) : body,
    });
    if (!res.ok && res.status !== 204) {
        throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
    }
    if (res.status === 204) return null;
    return res.headers.get('content-type')?.includes('json') ? res.json() : null;
}

async function deezerTrack(query) {
    try {
        const res = await fetch(
            `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`,
        );
        if (!res.ok) return null;
        const body = await res.json();
        return body.data?.[0] ?? null;
    } catch {
        return null;
    }
}

function capitalise(value) {
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function required(name) {
    const value = process.env[name];
    if (!value) throw new Error(`missing env ${name}`);
    return value;
}
