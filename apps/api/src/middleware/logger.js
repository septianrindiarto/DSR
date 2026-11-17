import { db } from '../db/index.js';
import { activityLogs } from '../db/schema.js';

/**
 * Log an activity to the activity_logs table.
 */
export async function logActivity({ userId, action, entity, entityId, details, ipAddress }) {
    try {
        await db.insert(activityLogs).values({
            userId: userId || null,
            action,
            entity,
            entityId: entityId ? String(entityId) : null,
            details: details || null,
            ipAddress: ipAddress || null,
        });
    } catch (error) {
        console.error('Failed to log activity:', error);
    }
}

/**
 * Express middleware factory for auto-logging mutations.
 */
export function activityLogger(action, entity) {
    return (req, res, next) => {
        const originalJson = res.json.bind(res);
        res.json = function (data) {
            // Only log on success
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;
                logActivity({
                    userId: req.user?.id || null,
                    action,
                    entity,
                    entityId: req.params?.id || data?.id || null,
                    details: { method: req.method, path: req.originalUrl },
                    ipAddress: ip,
                });
            }
            return originalJson(data);
        };
        next();
    };
}

/**
 * Audit trail for SENSITIVE READS (personal documents, exports). Logs once the
 * response has been sent successfully — works for res.json and res.sendFile.
 * action: 'view' | 'export'  (activity_action enum, audit_reads_migration.sql)
 */
export function auditRead(action, entity) {
    return (req, res, next) => {
        res.on('finish', () => {
            if (res.statusCode < 200 || res.statusCode >= 300) return;
            const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;
            logActivity({
                userId: req.user?.id || null,
                action,
                entity,
                entityId: req.params?.id || req.params?.doc || null,
                details: { method: req.method, path: req.originalUrl, ...(req.params?.kind ? { kind: req.params.kind } : {}), ...(req.params?.doc ? { doc: req.params.doc } : {}) },
                ipAddress: ip,
            });
        });
        next();
    };
}
