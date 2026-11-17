import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [sessionExpired, setSessionExpired] = useState(false);
    // Why the session ended (owner 2026-11-13): { code: SESSION_EXPIRED | SESSION_KICKED, device }
    const [sessionEnd, setSessionEnd] = useState(null);

    useEffect(() => {
        checkSession();
    }, []);

    // Audit M-05: listen for the 401 interceptor's event. When a session
    // expires while the user has the tab open, clear local auth state and
    // flip the sessionExpired flag so consumers can show a banner and
    // redirect. The probe call (/api/auth/get-session on mount) opts out
    // of this interceptor so it does not falsely trip on the very first
    // visit when the user is just not logged in yet.
    useEffect(() => {
        function onAuthExpired(e) {
            if (user || sessionExpired) {
                setUser(null);
                setSessionExpired(true);
                if (e?.detail?.code) setSessionEnd({ code: e.detail.code, device: e.detail.device || null });
            }
        }
        window.addEventListener('auth:expired', onAuthExpired);
        return () => window.removeEventListener('auth:expired', onAuthExpired);
    }, [user, sessionExpired]);

    function clearSessionExpired() {
        setSessionExpired(false);
        setSessionEnd(null);
    }

    // A transient failure (rate limit 429, DB waking 503, network blip) must
    // NOT look like "logged out" — that bounced users to the login page
    // mid-session. Retry those a few times with backoff; only a real 401 /
    // empty session means not authenticated.
    // RBAC v2: merge the server-computed permissions into the user object so
    // the UI shows exactly what the API allows (user.perms, legalStatus…).
    async function withAccess(u) {
        if (!u) return null;
        try {
            const a = await api.users.myAccess();
            return { ...u, perms: a.permissions, templateKey: a.templateKey, templateName: a.templateName, legalStatus: a.legalStatus, accountType: a.accountType || u.accountType };
        } catch {
            return u; // fall back to role-based menus; the server still enforces
        }
    }

    async function refreshAccess() {
        setUser(await withAccess(user));
    }

    async function checkSession() {
        const delays = [800, 2000, 4000];
        for (let attempt = 0; ; attempt++) {
            try {
                const session = await api.auth.getSession();
                setUser(await withAccess(session?.user || null));
                break;
            } catch (error) {
                const transient = !error?.status || error.status === 429 || error.status >= 500;
                if (transient && attempt < delays.length) {
                    await new Promise((r) => setTimeout(r, delays[attempt]));
                    continue;
                }
                // Page opened after the idle timeout / a take-over elsewhere → say why.
                const code = error?.body?.code;
                if (code === 'SESSION_EXPIRED' || code === 'SESSION_KICKED') {
                    setSessionExpired(true);
                    setSessionEnd({ code, device: error.body.device || null });
                }
                setUser(null);
                break;
            }
        }
        setLoading(false);
    }

    // 2FA users get { twoFactorRedirect: true } instead of a session; the
    // login page then asks for the 6-digit code and calls verifyTwoFactor().
    // force: take over a login idle ≥ 5 min elsewhere (server decides; owner 2026-11-13).
    async function login(email, password, { force = false } = {}) {
        const result = await api.auth.signIn({ email, password }, { force });
        if (result?.twoFactorRedirect) return { twoFactor: true };
        if (result?.user) {
            const merged = await withAccess(result.user);
            setUser(merged);
            return { ...result, user: merged };
        }
        return result;
    }

    async function verifyTwoFactor(code, { backup = false, trustDevice = false, force = false } = {}) {
        const clean = String(code || '').replace(/\s+/g, '');
        if (backup) await api.auth.twoFactor.verifyBackupCode(clean, { force });
        else await api.auth.twoFactor.verifyTotp(clean, trustDevice, { force });
        const session = await api.auth.getSession();
        const u = await withAccess(session?.user || null);
        setUser(u);
        return { user: u };
    }

    async function register(payload) {
        // Accepts the full extended payload:
        //   { name, email, password, phone, customerType, companyName, accountType }
        // For backward compatibility, also accepts the old 3-arg call signature.
        const data = (typeof payload === 'string')
            ? { name: payload, email: arguments[1], password: arguments[2] }
            : payload;
        const result = await api.auth.signUp(data);
        // Do NOT auto-login — Better Auth blocks login until verified.
        return result;
    }

    async function logout() {
        await api.auth.signOut();
        setUser(null);
    }

    return (
        <AuthContext.Provider value={{
            user, loading, login, verifyTwoFactor, register, logout, checkSession, refreshAccess,
            sessionExpired, sessionEnd, clearSessionExpired,
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
}
