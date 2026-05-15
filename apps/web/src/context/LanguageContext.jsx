import { createContext, useContext, useState, useCallback } from 'react';
import { id as idLang } from '../i18n/id';
import { en as enLang } from '../i18n/en';

const languages = { id: idLang, en: enLang };
const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
    const [lang, setLang] = useState(() => {
        return localStorage.getItem('dsr-lang') || 'id';
    });

    const t = useCallback((key) => {
        return languages[lang]?.[key] || languages.id[key] || key;
    }, [lang]);

    const toggleLanguage = useCallback(() => {
        setLang(prev => {
            const next = prev === 'id' ? 'en' : 'id';
            localStorage.setItem('dsr-lang', next);
            return next;
        });
    }, []);

    const setLanguage = useCallback((newLang) => {
        setLang(newLang);
        localStorage.setItem('dsr-lang', newLang);
    }, []);

    return (
        <LanguageContext.Provider value={{ lang, t, toggleLanguage, setLanguage }}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (!context) throw new Error('useLanguage must be used within LanguageProvider');
    return context;
}
