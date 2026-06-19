import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [sessionExpired, setSessionExpired] = useState(false);

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
        function onAuthExpired() {
            if (user || sessionExpired) {
                setUser(null);
                setSessionExpired(true);
            }
        }
        window.addEventListener('auth:expired', onAuthExpired);
        return () => window.removeEventListener('auth:expired', onAuthExpired);
    }, [user, sessionExpired]);

    function clearSessionExpired() {
        setSessionExpired(false);
    }

    async function checkSession() {
        try {
            const session = await api.auth.getSession();
            if (session?.user) {
                setUser(session.user);
            }
        } catch (error) {
            // Not authenticated
            setUser(null);
        } finally {
            setLoading(false);
        }
    }

    async function login(email, password) {
        const result = await api.auth.signIn({ email, password });
        if (result?.user) {
            setUser(result.user);
        }
        return result;
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
            user, loading, login, register, logout, checkSession,
            sessionExpired, clearSessionExpired,
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
