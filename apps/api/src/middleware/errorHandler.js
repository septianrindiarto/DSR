/**
 * Global error handler middleware.
 */
export function errorHandler(err, req, res, next) {
    // Log without personal data: drop the SQL parameter list that postgres
    // errors embed ("params: name,phone,…") and the query string.
    const redact = (m) => String(m || '').replace(/params:[\s\S]*$/i, 'params: [redacted]');
    if (process.env.NODE_ENV === 'production') {
        console.error('❌ Error:', req.method, req.path, err.code || err.cause?.code || '', redact(err.message));
    } else {
        console.error('❌ Error:', req.method, req.originalUrl, err);
    }
    const pgCode = err.code || err.cause?.code;

    if (err.name === 'ZodError') {
        return res.status(400).json({
            error: 'Validation failed',
            details: err.errors || err.issues,
        });
    }

    // Body too large / malformed JSON / upload limits → client errors.
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Data terlalu besar.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Format JSON tidak valid.' });
    if (err.name === 'MulterError') return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran file melebihi batas.' : 'Unggahan file tidak valid.' });

    if (pgCode === '23505') {
        return res.status(409).json({
            error: 'Duplicate entry — resource already exists',
        });
    }

    // Code expects a column/table the database doesn't have yet = a migration
    // wasn't applied (e.g. new lease_contracts columns → "Failed query: select …").
    if (pgCode === '42703' || pgCode === '42P01') {
        console.error('[db] schema out of date — run `npm run migrate` in apps/api:', err.cause?.message || err.message);
        return res.status(503).json({
            error: 'Struktur database belum diperbarui. Jalankan "npm run migrate" di apps/api, lalu restart API.',
            code: 'SCHEMA_OUTDATED',
        });
    }

    // Invalid value for a Postgres enum (22P02 "invalid input value for enum …"):
    // usually a column that a migration turns into free text (e.g. cars.type →
    // agency vehicle types) while the migration hasn't run yet.
    const causeMsg = String(err.cause?.message || '');
    if (pgCode === '22P02' && /enum/i.test(causeMsg)) {
        console.error('[db] enum value rejected — run `npm run migrate` in apps/api:', causeMsg);
        return res.status(503).json({
            error: 'Struktur database belum diperbarui (nilai pilihan belum didukung). Jalankan "npm run migrate" di apps/api, lalu restart API.',
            code: 'SCHEMA_OUTDATED',
        });
    }

    if (pgCode === '23503') {
        return res.status(400).json({
            error: 'Referenced resource not found',
        });
    }

    // Database unreachable / waking up. postgres-js surfaces these as network
    // errors (often via error.cause on an AggregateError) with an empty
    // message, so a bare DB blip would otherwise render as an opaque 500. Map
    // it to a 503 with a clear, retryable message instead — the frontend can
    // tell the user to retry rather than showing "Internal Server Error".
    const CONN_CODES = new Set([
        'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND',
        'EAI_AGAIN', 'EPIPE', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED',
        'CONNECTION_DESTROYED', 'CONNECTION_ENDED',
    ]);
    const codes = [
        err.code, err.errno,
        err.cause?.code, err.cause?.errno,
        ...(Array.isArray(err.errors) ? err.errors.map((e) => e?.code) : []),
    ].filter(Boolean);
    if (codes.some((c) => CONN_CODES.has(c))) {
        return res.status(503).json({
            error: 'Database sedang tidak dapat dijangkau. Coba lagi sebentar lagi.',
            code: 'DB_UNAVAILABLE',
        });
    }

    const status = err.status || err.statusCode || 500;
    // In production never echo internal messages for 5xx (e.g. "Failed query:
    // select … params: …" leaks SQL and data). 4xx messages are intentional.
    const isProd = process.env.NODE_ENV === 'production';
    // Raw "Failed query: insert … params: …" is never shown to the user (it
    // dumps SQL and data); in dev the real cause is in the API console.
    const rawSql = /^Failed query/i.test(String(err.message || ''));
    const message = (status >= 500 && isProd) || rawSql
        ? `Terjadi kesalahan pada server${!isProd && causeMsg ? `: ${causeMsg}` : '. Silakan coba lagi.'}`
        : (err.message || 'Internal server error');

    res.status(status).json({
        error: message,
        ...(!isProd && process.env.DEBUG === 'true' && { stack: err.stack }),
    });
}
