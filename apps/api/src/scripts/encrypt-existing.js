#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Encrypt data that was stored BEFORE AES-256 encryption was switched on.
//
//   node src/scripts/encrypt-existing.js            # DRY-RUN: only counts
//   node src/scripts/encrypt-existing.js --apply    # encrypts (DML + files)
//
// Fields: drivers.license_number, organizations.nib, organizations.npwp
// Files:  apps/api/uploads-private/** and legacy uploads/driver-* , uploads/finance/*
// Needs DATA_ENCRYPTION_KEY. Safe to re-run (already-encrypted items skipped).
// Take a DB backup + copy of the upload folders first.
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { encryptField, isEncrypted, encryptBuffer, isEncryptedBuffer, encryptionEnabled } from '../services/crypto.service.js';

const APPLY = process.argv.includes('--apply');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, '../..');

if (!encryptionEnabled()) { console.error('DATA_ENCRYPTION_KEY is not set.'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 30 });

async function fields() {
    const plan = [
        ['drivers', 'license_number'],
        ['organizations', 'nib'],
        ['organizations', 'npwp'],
    ];
    for (const [table, col] of plan) {
        const rows = await sql.unsafe(`SELECT id, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> '' AND ${col} NOT LIKE 'enc:v1:%'`);
        console.log(`${table}.${col}: ${rows.length} plain value(s)`);
        if (!APPLY) continue;
        for (const r of rows) {
            if (isEncrypted(r.v)) continue;
            await sql.unsafe(`UPDATE ${table} SET ${col} = $1 WHERE id = $2 AND ${col} = $3`, [encryptField(r.v), r.id, r.v]);
        }
        console.log(`  → encrypted ${rows.length}`);
    }
}

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p, out); else out.push(p);
    }
    return out;
}

function files() {
    const priv = walk(path.join(API_ROOT, 'uploads-private'));
    const pub = path.join(API_ROOT, 'uploads');
    const legacy = [
        ...(fs.existsSync(pub) ? fs.readdirSync(pub).filter((f) => f.startsWith('driver-')).map((f) => path.join(pub, f)) : []),
        ...walk(path.join(pub, 'finance')),
    ];
    let plain = 0, done = 0;
    for (const p of [...priv, ...legacy]) {
        const buf = fs.readFileSync(p);
        if (isEncryptedBuffer(buf)) continue;
        plain++;
        if (!APPLY) continue;
        const tmp = `${p}.enc-tmp`;
        fs.writeFileSync(tmp, encryptBuffer(buf), { mode: 0o600 });
        fs.renameSync(tmp, p);
        done++;
    }
    console.log(`files: ${plain} plain file(s)${APPLY ? ` → encrypted ${done}` : ''}`);
}

(async () => {
    console.log(APPLY ? '== APPLY ==' : '== DRY-RUN (nothing changed; add --apply) ==');
    try { await fields(); files(); }
    catch (e) { console.error('failed:', e.message); process.exitCode = 1; }
    finally { await sql.end(); }
})();
