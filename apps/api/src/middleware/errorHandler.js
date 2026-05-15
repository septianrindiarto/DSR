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

    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Internal server error';

    res.status(status).json({
        error: message,
        ...(process.env.DEBUG === 'true' && { stack: err.stack }),
    });
}
