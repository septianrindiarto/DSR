import { auth } from '../auth.js';
import { fromNodeHeaders } from 'better-auth/node';

/**
 * Middleware to require authentication.
 * Attaches req.user and req.session if valid.
 */
export async function requireAuth(req, res, next) {
    try {
        const session = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
        });

        if (!session) {
            return res.status(401).json({ error: 'Unauthorized — please login' });
        }

        req.user = session.user;
        req.session = session.session;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(401).json({ error: 'Unauthorized — invalid session' });
    }
}

/**
 * Middleware to require admin role (company admin OR superadmin).
 * Must be used after requireAuth.
 */
export function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const allowed = ['admin', 'superadmin'];
    if (!allowed.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden — admin access required' });
    }
    next();
}

/**
 * Middleware to require superadmin role only.
 */
export function requireSuperAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (req.user.role !== 'superadmin') {
        return res.status(403).json({ error: 'Forbidden — superadmin access required' });
    }
    next();
}

/**
 * Middleware to allow any authenticated non-demo user (agent, admin, superadmin).
 */
export function requireAgent(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const allowed = ['agent', 'admin', 'superadmin'];
    if (!allowed.includes(req.user.role) && !req.user.isDemo) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
}
