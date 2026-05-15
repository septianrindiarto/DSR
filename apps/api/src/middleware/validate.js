/**
 * Zod validation middleware factory.
 * Validates req.body against the given Zod schema.
 */
export function validate(schema) {
    return (req, res, next) => {
        try {
            req.body = schema.parse(req.body);
            next();
        } catch (error) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.errors || error.issues,
            });
        }
    };
}
