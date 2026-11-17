// ─── i18n core (no React) ───────────────────────────────────────────────────
// Dictionaries + a module-level translate() for code that runs outside
// components (label maps, helpers). Components use t() from useLanguage();
// LanguageProvider keeps the current language here in sync.
import { id as idLang } from './id';
import { en as enLang } from './en';
import { financeId } from './finance.id';
import { corporateId } from './corporate.id';
import { phaseBcId } from './phasebc.id';
import { contractsId } from './contracts.id';
import { sceneId } from './scene.id';
import { opsId } from './ops.id';
import { taxId } from './tax.id';
import { fleetId } from './fleet.id';

export const DICTIONARIES = {
    id: { ...idLang, ...financeId, ...corporateId, ...phaseBcId, ...contractsId, ...sceneId, ...opsId, ...taxId, ...fleetId },
    en: enLang, // missing keys fall back to Indonesian
};

let current = 'id';
export const setCurrentLang = (l) => { if (DICTIONARIES[l]) current = l; };
export const currentLang = () => current;

/** translate('key', { n: 3 }) → string with {n} replaced. Falls back id → key. */
export function translate(key, vars, lang = current) {
    let s = DICTIONARIES[lang]?.[key] ?? DICTIONARIES.id[key] ?? key;
    if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
    return s;
}

/**
 * Label map whose values are i18n keys, translated on read:
 *   const STATUS = labelMap({ draft: 'fin_status_draft' });  STATUS.draft → "Draft"
 * Arrays work too: labelMap(['fin_month_1', …])[0].
 */
export function labelMap(keys) {
    return new Proxy(keys, {
        get(o, k) {
            const v = o[k];
            if (typeof k === 'string' && typeof v === 'string' && (Array.isArray(o) ? /^\d+$/.test(k) : true)) return translate(v);
            if (k === 'map' && Array.isArray(o)) return (fn) => o.map((v2, i) => fn(translate(v2), i));
            return typeof v === 'function' ? v.bind(o) : v;
        },
    });
}
