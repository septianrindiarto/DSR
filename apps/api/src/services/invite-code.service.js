// ─── Invite code service ──────────────────────────────────────────────────
// Phase 4A: org admins share an invite code with their team. New users enter
// the code on registration to join the existing org instead of typing the
// company name (which is fragile to typos and case differences).
//
// Format: 8 characters, uppercase letters + digits, with a dash in the middle
// for readability. Avoids visually ambiguous chars (no O/0, I/1, L).
// Example:  "A3K7-9P2X"

import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { eq } from 'drizzle-orm';

// Excludes O, 0, I, 1, L to avoid OCR / handwriting confusion.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode() {
    let s = '';
    for (let i = 0; i < 8; i++) {
        s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return s.slice(0, 4) + '-' + s.slice(4); // → "A3K7-9P2X"
}

/**
 * Generate a code that's guaranteed unique in the organizations table.
 * Retries on collisions — extremely unlikely given the keyspace
 * (31^8 ≈ 8.5×10^11), but safer than crashing on a UNIQUE violation.
 *
 * @returns {Promise<string>}
 */
export async function generateUniqueInviteCode(maxAttempts = 10) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const code = makeCode();
        const [existing] = await db.select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.inviteCode, code))
            .limit(1);
        if (!existing) return code;
    }
    throw new Error('Failed to generate a unique invite code after ' + maxAttempts + ' attempts.');
}

/**
 * Normalize a company name for soft duplicate detection.
 * "PT. Mitra Integrasi  Informatika " → "pt. mitra integrasi informatika"
 * (lowercased + collapsed whitespace + trimmed). Punctuation kept so
 * "PT. ABC" and "PT ABC" are still considered distinct.
 */
export function normalizeCompanyName(name) {
    if (!name) return '';
    return String(name).toLowerCase().replace(/\s+/g, ' ').trim();
}
