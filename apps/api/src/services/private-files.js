// ─── Private file storage (personal / financial documents) ─────────────────
// Files here live OUTSIDE the public `/uploads` static folder, so they are
// never reachable by URL guessing. They are streamed only through
// authenticated, scope-checked endpoints (drivers SIM/KTP/photo, finance docs,
// agency legal docs).
//
// DB stores a reference string `private:<area>/<sub>/<file>`; the frontend
// recognises the prefix and opens it via an authenticated blob fetch.
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream';
import { encryptionEnabled, createEncryptStream, readPrivateFile } from './crypto.service.js';

// Legacy public folder (apps/api/uploads) — same path index.js serves.
export const PUBLIC_UPLOADS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');

// Files uploaded before private storage existed. They stay where they are but
// are NO LONGER served by the public static route (see index.js); they are
// streamed through the same authenticated endpoints as private files.
export const LEGACY_SENSITIVE = /^\/(driver-[\w.-]+|finance\/[\w.-]+)$/;
export const isLegacySensitive = (v) => typeof v === 'string' && v.startsWith('/uploads/') && LEGACY_SENSITIVE.test(v.slice('/uploads'.length));

export const PRIVATE_ROOT = path.join(process.cwd(), 'uploads-private');
export const PRIVATE_PREFIX = 'private:';

export const isPrivateRef = (v) => typeof v === 'string' && v.startsWith(PRIVATE_PREFIX);

/** Absolute path for a `private:` ref, constrained to `<root>/<area>/`. Null if invalid. */
export function resolvePrivateRef(ref, area) {
    if (!isPrivateRef(ref)) return null;
    const rel = ref.slice(PRIVATE_PREFIX.length);
    const base = path.resolve(PRIVATE_ROOT, area);
    const abs = path.resolve(PRIVATE_ROOT, rel);
    return abs.startsWith(base + path.sep) ? abs : null;
}

/** Ref string for a stored multer file. */
export const toPrivateRef = (absPath) =>
    PRIVATE_PREFIX + path.relative(PRIVATE_ROOT, absPath).split(path.sep).join('/');

/** Best-effort removal of a replaced private file. */
export function removePrivateRef(ref, area) {
    const abs = resolvePrivateRef(ref, area);
    if (abs) fs.unlink(abs, () => {});
}

const EXT_OK = /\.(pdf|jpe?g|png|gif|webp|xlsx?|csv|docx?)$/i;
const MIME = {
    image: /^image\/(jpeg|png|gif|webp)$/,
    pdf: /^application\/pdf$/,
    office: /^(application\/(vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document)|vnd\.ms-excel|msword|octet-stream)|text\/csv)$/,
};

/**
 * multer storage engine that writes files AES-256-GCM encrypted (when
 * DATA_ENCRYPTION_KEY is set). Same callbacks as multer.diskStorage.
 */
export function encryptedDiskStorage({ destination, filename }) {
    return {
        _handleFile(req, file, cb) {
            destination(req, file, (err, dir) => {
                if (err) return cb(err);
                filename(req, file, (err2, name) => {
                    if (err2) return cb(err2);
                    const full = path.join(dir, name);
                    let size = 0;
                    file.stream.on('data', (c) => { size += c.length; });
                    const stages = [file.stream, ...(encryptionEnabled() ? [createEncryptStream()] : []), fs.createWriteStream(full)];
                    pipeline(...stages, (e) => (e ? cb(e) : cb(null, { destination: dir, filename: name, path: full, size })));
                });
            });
        },
        _removeFile(_req, file, cb) { fs.unlink(file.path, () => cb(null)); },
    };
}

/**
 * multer instance writing to `uploads-private/<area>/<subDir(req)>/`
 * (encrypted at rest — see encryptedDiskStorage).
 * kinds: which MIME families are accepted ('image' | 'pdf' | 'office').
 */
export function privateUpload({ area, subDir = () => 'misc', kinds = ['image', 'pdf'], maxMb = 10 }) {
    const extAllowed = new Set(
        kinds.flatMap((k) => ({ image: ['.jpg', '.jpeg', '.png', '.gif', '.webp'], pdf: ['.pdf'], office: ['.xlsx', '.xls', '.csv', '.docx', '.doc'] }[k] || [])),
    );
    return multer({
        storage: encryptedDiskStorage({
            destination: (req, _file, cb) => {
                const dir = path.join(PRIVATE_ROOT, area, String(subDir(req) || 'misc').replace(/[^a-zA-Z0-9_-]/g, ''));
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
                cb(null, dir);
            },
            filename: (_req, file, cb) => cb(null, `${file.fieldname}-${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
        }),
        limits: { fileSize: maxMb * 1024 * 1024, files: 5 },
        fileFilter: (_req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            const ok = EXT_OK.test(ext) && extAllowed.has(ext) && kinds.some((k) => MIME[k]?.test(file.mimetype));
            cb(ok ? null : Object.assign(new Error(`Jenis file tidak diizinkan (maks ${maxMb} MB).`), { status: 400 }), ok);
        },
    });
}

/** Stream a private ref (or a legacy sensitive /uploads path) with no-cache headers. */
export function sendPrivate(res, ref, area, downloadName) {
    let abs = resolvePrivateRef(ref, area);
    if (!abs && isLegacySensitive(ref)) {
        const base = path.resolve(PUBLIC_UPLOADS);
        const cand = path.resolve(base, ref.slice('/uploads/'.length));
        abs = cand.startsWith(base + path.sep) ? cand : null;
    }
    return sendFileDecrypted(res, abs, downloadName);
}

/** Send a file stored on disk (AES-256-GCM container or legacy plain). */
export async function sendFileDecrypted(res, abs, downloadName) {
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
    let buf;
    try { buf = await readPrivateFile(abs); }
    catch (e) {
        console.error('[private-files] decrypt failed:', path.basename(abs), e.message);
        return res.status(500).json({ error: 'Dokumen tidak dapat dibuka (kunci enkripsi tidak cocok).' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    res.type(path.extname(abs) || 'application/octet-stream');
    if (downloadName) res.attachment(downloadName);
    return res.send(buf);
}
