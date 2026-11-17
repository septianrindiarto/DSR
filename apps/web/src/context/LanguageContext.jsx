import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { DICTIONARIES, setCurrentLang, translate } from '../i18n';

// ─── i18n ───────────────────────────────────────────────────────────────────
// Indonesian is the primary (and, for now, only enabled) language. The setup
// stays multi-language ready:
//   • Dictionaries per language; feature dictionaries (e.g. finance.id.js)
//     are merged in, so big features keep their own file.
//   • Missing keys fall back to Indonesian, then to the key itself — a new
//     language can be added gradually.
//   • VITE_LANGUAGES (comma list, default "id") decides which languages are
//     offered. With one language the switch buttons are hidden.
//     Example to re-enable English: VITE_LANGUAGES=id,en
//   • t(key, { n: 3 }) replaces {n} placeholders. Non-component code uses
//     translate()/labelMap() from src/i18n/index.js.
export const ENABLED_LANGUAGES = String(import.meta.env.VITE_LANGUAGES || 'id')
    .split(',').map((s) => s.trim()).filter((l) => DICTIONARIES[l]);
if (!ENABLED_LANGUAGES.length) ENABLED_LANGUAGES.push('id');
const DEFAULT_LANG = ENABLED_LANGUAGES[0];

const LanguageContext = createContext(null);

function readStoredLang() {
    try {
        const v = localStorage.getItem('dsr-lang');
        return ENABLED_LANGUAGES.includes(v) ? v : DEFAULT_LANG;
    } catch { return DEFAULT_LANG; }
}
function storeLang(v) { try { localStorage.setItem('dsr-lang', v); } catch { /* storage unavailable */ } }

export function LanguageProvider({ children }) {
    const [lang, setLang] = useState(readStoredLang);

    setCurrentLang(lang); // keeps module-level translate()/labelMap in step
    const t = useCallback((key, vars) => translate(key, vars, lang), [lang]);

    const toggleLanguage = useCallback(() => {
        setLang((prev) => {
            const i = ENABLED_LANGUAGES.indexOf(prev);
            const next = ENABLED_LANGUAGES[(i + 1) % ENABLED_LANGUAGES.length];
            storeLang(next);
            return next;
        });
    }, []);

    const setLanguage = useCallback((newLang) => {
        if (!ENABLED_LANGUAGES.includes(newLang)) return;
        setLang(newLang);
        storeLang(newLang);
    }, []);

    const value = useMemo(() => ({
        lang, t, toggleLanguage, setLanguage,
        languages: ENABLED_LANGUAGES, multiLanguage: ENABLED_LANGUAGES.length > 1,
    }), [lang, t, toggleLanguage, setLanguage]);

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLanguage() {
    const context = useContext(LanguageContext);
    if (!context) throw new Error('useLanguage must be used within LanguageProvider');
    return context;
}
