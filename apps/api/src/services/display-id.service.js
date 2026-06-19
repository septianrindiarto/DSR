// ─── Display ID service ───────────────────────────────────────────────────
// Phase 4C-1 (refined): human-readable org identifier in the format
// <INITIALS>_<YYYYMMDD>. On collision we DO NOT block — we walk through
// per-word letter variations until an available combination is found.
//
// Examples
//   "PT. DSR Rent Car"                       → DRC_20260614
//   "PT. Mitra Integrasi Informatika"        → MII_20260614
//   "Berkah" (single word, padded)           → BRK_20260614
//
// Collision walk (per user's example, "PT. Xenom Yotta Zenith"):
//   Xenom candidates  = [X, M, N]   (first, last, interior consonants)
//   Yotta candidates  = [Y, A, T]
//   Zenith candidates = [Z, H, N, T]
//
//   Default     → XYZ_yyyymmdd
//   If taken    → MYZ_yyyymmdd   (vary word 1)
//   If taken    → MAZ_yyyymmdd   (vary word 2 keeping new word 1)
//   If taken    → MAH_yyyymmdd   (vary word 3 keeping new word 1+2)
//   If taken    → continues through the Cartesian product, leftmost-fastest
//   until exhausted (extremely rare).
//
// The duplicate-NAME gate (Gate 1 in register-extended) still blocks same-name
// registrations — same name = same entity, use invite code. THIS module only
// resolves different-name same-initials collisions.

import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const LEGAL_PREFIXES = new Set([
    'pt', 'pt.', 'cv', 'cv.', 'ud', 'ud.', 'tk', 'tk.', 'tb', 'tb.', 'toko',
    'koperasi', 'yayasan', 'perseroan', 'perusahaan', 'firma', 'fa',
]);

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/**
 * Tokenize a company name into significant lowercase words.
 * Strips legal-entity prefixes (PT., CV., …) and punctuation.
 */
function significantWords(name) {
    if (!name) return [];
    const tokens = String(name)
        .toLowerCase()
        .replace(/[^a-z0-9\s.]/g, ' ')
        .split(/\s+/)
        .map(t => t.trim())
        .filter(Boolean);
    const filtered = tokens.filter(t => !LEGAL_PREFIXES.has(t));
    return filtered.length > 0 ? filtered : tokens;
}

/**
 * Build the ordered candidate-letter list for ONE word.
 *
 * Order (per the user-specified pattern):
 *   1. First letter
 *   2. Last letter (if different from first)
 *   3. Interior consonants in left-to-right order, skipping vowels + duplicates
 *
 * Always returns at least one letter (the first character or 'X').
 */
export function buildWordCandidates(word) {
    if (!word) return ['X'];
    const w = word.toLowerCase();
    const result = [w[0]];
    if (w.length > 1) {
        const last = w[w.length - 1];
        if (last !== w[0]) result.push(last);
    }
    for (let i = 1; i < w.length - 1; i++) {
        const c = w[i];
        if (!VOWELS.has(c) && !result.includes(c)) result.push(c);
    }
    return result.map(c => c.toUpperCase());
}

/** Lazy generator of initials variations, leftmost-position fastest. */
function* iterateInitials(candidateLists) {
    const n = candidateLists.length;
    if (n === 0) { yield 'X'; return; }
    const sizes = candidateLists.map(list => list.length);
    const total = sizes.reduce((a, b) => a * b, 1);
    const indices = new Array(n).fill(0);

    for (let step = 0; step < total; step++) {
        yield indices.map((idx, i) => candidateLists[i][idx]).join('');
        // Increment leftmost-fastest (your example's order):
        //   (0,0,0) → (1,0,0) → ... → (max,0,0) → (0,1,0) → (1,1,0) → ...
        for (let pos = 0; pos < n; pos++) {
            indices[pos]++;
            if (indices[pos] < sizes[pos]) break;
            indices[pos] = 0;
        }
    }
}

/** Pad single-letter initials with consonants from the source word until 3 chars. */
function padInitials(initials, sourceWord, minLength = 3) {
    if (initials.length >= minLength) return initials;
    const w = (sourceWord || '').toLowerCase();
    let out = initials;
    for (let i = 1; i < w.length && out.length < minLength; i++) {
        const c = w[i].toUpperCase();
        if (!VOWELS.has(w[i]) && !out.includes(c)) out += c;
    }
    while (out.length < minLength) out += 'X';
    return out;
}

export function formatYmd(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
}

/** Baseline (no collision check) — used by callers that just want the canonical form. */
export function makeDisplayId(name, date) {
    const words = significantWords(name).slice(0, 5);
    if (words.length === 0) return `X_${formatYmd(date)}`;
    const baseline = words.map(w => buildWordCandidates(w)[0]).join('');
    const padded = words.length === 1 ? padInitials(baseline, words[0]) : baseline;
    return `${padded}_${formatYmd(date)}`;
}

/** Returns the first available variant by walking candidate combinations. */
export async function findAvailableDisplayId(name, date) {
    const words = significantWords(name).slice(0, 5);
    const ymd = formatYmd(date);
    if (words.length === 0) {
        const fallback = `X_${ymd}`;
        if (await isDisplayIdAvailable(fallback)) return { displayId: fallback, attempts: 1 };
        throw new Error(`No display_id variants available for name "${name}".`);
    }
    const candidateLists = words.map(buildWordCandidates);
    let attempts = 0;
    for (const initials of iterateInitials(candidateLists)) {
        attempts++;
        const padded = words.length === 1 ? padInitials(initials, words[0]) : initials;
        const displayId = `${padded}_${ymd}`;
        if (await isDisplayIdAvailable(displayId)) return { displayId, attempts };
    }
    throw new Error(`No display_id variants available for "${name}" after ${attempts} attempts.`);
}

export async function isDisplayIdAvailable(displayId) {
    if (!displayId) return false;
    const [existing] = await db.select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.displayId, displayId))
        .limit(1);
    return !existing;
}
