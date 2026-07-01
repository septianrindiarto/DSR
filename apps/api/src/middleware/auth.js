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
 * Optional auth — attaches req.user/req.session IF a valid session cookie is
 * present, but NEVER rejects. Use on routes that are public but behave
 * differently for a logged-in caller (e.g. POST /orders/public: a dashboard
 * submission by an agency must be recognised as theirs, while an anonymous
 * landing submission still works).
 */
export async function optionalAuth(req, res, next) {
    try {
        const session = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
        });
        if (session) {
            req.user = session.user;
            req.session = session.session;
        }
    } catch {
        // ignore — treat as anonymous
    }
    next();
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

/**
 * Generic role guard. Usage: router.use(requireAuth, requireRole(['admin','superadmin']))
 * or per-route: router.get('/x', requireRole(['superadmin']), handler).
 * MUST be used after requireAuth — assumes req.user is populated.
 */
export function requireRole(allowedRoles) {
    if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
        throw new Error('requireRole: allowedRoles must be a non-empty array');
    }
    return function roleGuard(req, res, next) {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Forbidden — your role does not have access to this resource',
                code: 'ROLE_FORBIDDEN',
            });
        }
        next();
    };
}
