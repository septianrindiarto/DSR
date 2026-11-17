// ─── Application-level encryption (AES-256-GCM) ─────────────────────────────
// Protects personal / confidential data even if the database dump or the
// uploads folder leaks. Neon already encrypts its disks (AES-256 at rest) and
// TLS protects data in transit; this layer adds encryption that only the API
// (holding the key) can undo.
//
// Keys (apps/api/.env):
//   DATA_ENCRYPTION_KEY      base64 of 32 random bytes  (current key)
//   DATA_ENCRYPTION_KEY_ID   short id of the current key (default "k1")
//   DATA_ENCRYPTION_OLD_KEYS optional "k0:base64,…" — older keys kept for
//                            decryption after a rotation
// Generate a key:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Keep it OUT of git and out of the backups bucket (password manager).
//
// Formats
//   field  →  "enc:v1:<kid>:<iv b64>:<tag b64>:<ciphertext b64>"
//   file   →  "DSRENC1" | kidLen(1) | kid | iv(12) | ciphertext | tag(16)
// Plain (legacy) values/files are passed through on read, so encryption can be
// switched on without a big-bang migration (src/scripts/encrypt-existing.js
// converts the old ones).
// ─────────────────────────────────────────────────────────────────────────────
import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'crypto';
import fs from 'fs';
import { Transform } from 'stream';

const FIELD_PREFIX = 'enc:v1:';
export const FILE_MAGIC = Buffer.from('DSRENC1');

function parseKey(b64, name) {
    const k = Buffer.from(String(b64 || ''), 'base64');
    if (k.length !== 32) throw new Error(`${name} must be base64 of exactly 32 bytes (AES-256).`);
    return k;
}

let cache = null;
function keys() {
    if (cache) return cache;
    const ring = new Map();
    let currentId = null;
    if (process.env.DATA_ENCRYPTION_KEY) {
        currentId = process.env.DATA_ENCRYPTION_KEY_ID || 'k1';
        ring.set(currentId, parseKey(process.env.DATA_ENCRYPTION_KEY, 'DATA_ENCRYPTION_KEY'));
    }
    for (const part of String(process.env.DATA_ENCRYPTION_OLD_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
        const [id, b64] = part.split(':');
        if (id && b64 && !ring.has(id)) ring.set(id, parseKey(b64, `DATA_ENCRYPTION_OLD_KEYS(${id})`));
    }
    cache = { ring, currentId };
    return cache;
}
export const _resetKeysForTests = () => { cache = null; };

export const encryptionEnabled = () => !!keys().currentId;

/** Fail fast in production without a key; warn in dev. Call at startup. */
export function assertEncryptionConfigured() {
    if (encryptionEnabled()) return true;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('DATA_ENCRYPTION_KEY is required in production (AES-256 for personal data). See services/crypto.service.js.');
    }
    console.warn('[crypto] DATA_ENCRYPTION_KEY not set — new private files and sensitive fields are stored UNENCRYPTED (dev only).');
    return false;
}

// ─── Fields ───────────────────────────────────────────────────────────────
export const isEncrypted = (v) => typeof v === 'string' && v.startsWith(FIELD_PREFIX);

export function encryptField(value) {
    if (value === null || value === undefined || value === '') return value;
    if (isEncrypted(value)) return value;
    const { ring, currentId } = keys();
    if (!currentId) return value; // dev without key
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', ring.get(currentId), iv);
    const ct = Buffer.concat([c.update(String(value), 'utf8'), c.final()]);
    return `${FIELD_PREFIX}${currentId}:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function decryptField(value) {
    if (!isEncrypted(value)) return value;
    const [kid, ivB, tagB, ctB] = value.slice(FIELD_PREFIX.length).split(':');
    const key = keys().ring.get(kid);
    if (!key) return '[terenkripsi]'; // key missing — never leak ciphertext semantics
    try {
        const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
        d.setAuthTag(Buffer.from(tagB, 'base64'));
        return Buffer.concat([d.update(Buffer.from(ctB, 'base64')), d.final()]).toString('utf8');
    } catch {
        return '[terenkripsi]';
    }
}

/** Deterministic keyed hash for exact-match lookups on encrypted fields. */
export function blindIndex(value) {
    const { ring, currentId } = keys();
    if (!currentId || !value) return null;
    return createHmac('sha256', ring.get(currentId)).update(`bi:${String(value).trim().toLowerCase()}`).digest('base64url');
}

/** Map helper: decrypt the listed fields of a row (or array of rows). */
export function decryptFields(rowOrRows, fields) {
    const one = (r) => {
        if (!r) return r;
        const out = { ...r };
        for (const f of fields) if (f in out) out[f] = decryptField(out[f]);
        return out;
    };
    return Array.isArray(rowOrRows) ? rowOrRows.map(one) : one(rowOrRows);
}

// ─── Files ────────────────────────────────────────────────────────────────
/** Transform stream: plaintext in → DSRENC1 container out. */
export function createEncryptStream() {
    const { ring, currentId } = keys();
    const kid = Buffer.from(currentId, 'utf8');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', ring.get(currentId), iv);
    let headerSent = false;
    return new Transform({
        transform(chunk, _enc, cb) {
            const parts = [];
            if (!headerSent) { parts.push(FILE_MAGIC, Buffer.from([kid.length]), kid, iv); headerSent = true; }
            parts.push(cipher.update(chunk));
            cb(null, Buffer.concat(parts));
        },
        flush(cb) {
            const parts = [];
            if (!headerSent) parts.push(FILE_MAGIC, Buffer.from([kid.length]), kid, iv);
            parts.push(cipher.final(), cipher.getAuthTag());
            cb(null, Buffer.concat(parts));
        },
    });
}

export function isEncryptedBuffer(buf) {
    return buf.length > FILE_MAGIC.length && buf.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC);
}

/** Buffer in (encrypted or legacy plain) → plaintext Buffer. Throws on tamper. */
export function decryptBuffer(buf) {
    if (!isEncryptedBuffer(buf)) return buf;
    let o = FILE_MAGIC.length;
    const kidLen = buf[o]; o += 1;
    const kid = buf.subarray(o, o + kidLen).toString('utf8'); o += kidLen;
    const iv = buf.subarray(o, o + 12); o += 12;
    const tag = buf.subarray(buf.length - 16);
    const ct = buf.subarray(o, buf.length - 16);
    const key = keys().ring.get(kid);
    if (!key) throw new Error(`Kunci enkripsi ${kid} tidak tersedia.`);
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
}

export function encryptBuffer(buf) {
    const { ring, currentId } = keys();
    if (!currentId) throw new Error('DATA_ENCRYPTION_KEY belum diatur.');
    const kid = Buffer.from(currentId, 'utf8');
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', ring.get(currentId), iv);
    const ct = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([FILE_MAGIC, Buffer.from([kid.length]), kid, iv, ct, c.getAuthTag()]);
}

/** Read a private file from disk and return plaintext bytes. */
export async function readPrivateFile(abs) {
    return decryptBuffer(await fs.promises.readFile(abs));
}
