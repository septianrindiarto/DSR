/**
 * Global error handler middleware.
 */
export function errorHandler(err, req, res, next) {
    console.error('❌ Error:', err);

    if (err.name === 'ZodError') {
        return res.status(400).json({
            error: 'Validation failed',
            details: err.errors || err.issues,
        });
    }

    if (err.code === '23505') {
        return res.status(409).json({
            error: 'Duplicate entry — resource already exists',
        });
    }

    if (err.code === '23503') {
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
    const message = err.message || 'Internal server error';

    res.status(status).json({
        error: message,
        ...(process.env.DEBUG === 'true' && { stack: err.stack }),
    });
}
