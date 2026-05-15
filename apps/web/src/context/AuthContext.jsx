import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        checkSession();
    }, []);

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

    async function register(name, email, password) {
        const result = await api.auth.signUp({ name, email, password });
        if (result?.user) {
            setUser(result.user);
        }
        return result;
    }

    async function logout() {
        await api.auth.signOut();
        setUser(null);
    }

    return (
        <AuthContext.Provider value={{ user, loading, login, register, logout, checkSession }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
}
