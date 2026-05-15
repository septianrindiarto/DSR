# AGENTS.md

## Project Context

You are an AI coding assistant for **DSR Solution** — a car-rental management web application.

The project is a monorepo rooted at `D:\Project\DSR\`. The active application lives in `apps/web/` and is a React + Vite single-page app that talks to a separate backend API at `http://localhost:5000` (the backend is not part of this folder; treat it as an external contract).

The app has two surfaces:

- **Public landing page** — for end-customers browsing and ordering rental cars.
- **Admin panel** — internal tool for managing fleet, orders, schedule, customers, drivers, finance, documents, analytics, and settings.

Your main responsibility is to make changes that are consistent with the current codebase, safe for production, and limited to the requested scope. Do not modernize the stack, redesign UI, or refactor unrelated areas unless the user explicitly asks for it.

Primary stack:

- React 19 (functional components + hooks, no class components)
- Vite 7
- React Router DOM 7
- Tailwind CSS v4 (CSS-first `@theme` config in `src/index.css`, **no** `tailwind.config.js`)
- Material Symbols Outlined (icon font, loaded via `index.html`)
- Outfit (display) + Inter (body) — Google Fonts
- ESLint 9 (flat config, `eslint.config.js`)
- Auth: cookie-based session via Better Auth (backend); consumed through `src/lib/api.js`
- i18n: Indonesian (default) + English, hand-rolled `useLanguage()` context

Do not introduce TypeScript, Next.js, Redux, Zustand, React Query, Axios, styled-components, MUI, shadcn, Radix, or any other framework unless the user explicitly asks.

## Core Principles

1. Existing pattern over new architecture.
2. Stability over modernization.
3. Small scoped changes over broad refactors.
4. Backend and frontend contracts must be checked together (`src/lib/api.js` is the source of truth on the frontend).
5. Reusable helper changes are preferred when the same pattern appears in multiple admin pages.
6. Indonesian is the **primary** UI language. Every user-facing string must have a key in `src/i18n/id.js` and a matching key in `src/i18n/en.js`.
7. Never edit files inside `node_modules/`, `dist/`, or any backup file (e.g. `*_backup_YYYYMMDD.jsx`). Backup files exist as historical references only.

## Repository Structure

Use the existing project layout:

- `apps/web/` — the React app (the only active app today).
- `apps/web/src/main.jsx` — Vite entry, mounts `<App />` inside `<StrictMode>`.
- `apps/web/src/App.jsx` — `<BrowserRouter>` + `LanguageProvider` + `AuthProvider` + `<Routes>`. Add new routes here.
- `apps/web/src/pages/` — top-level route components. Public pages and `Admin*` pages live side by side.
- `apps/web/src/components/` — shared UI components (Header, Footer, AdminLayout, AdminSidebar, CarCard, TablePagination, FormatPickerModal, WhatsAppFAB, etc.).
- `apps/web/src/components/[feature]/` — feature-grouped subcomponents (e.g. `components/finance/ExportModal.jsx`). Use this when a page grows enough that it has 3+ owned subcomponents.
- `apps/web/src/context/` — React Context providers (`AuthContext`, `LanguageContext`). Keep contexts small and focused.
- `apps/web/src/lib/` — framework-agnostic helpers (`api.js` for the API client + SWR cache, `dataFormats.js` for export/import utilities). No JSX in this folder.
- `apps/web/src/data/` — static seed/demo data (e.g. `cars.js`).
- `apps/web/src/i18n/` — `id.js` and `en.js` translation maps.
- `apps/web/src/assets/` — bundled assets imported from JS.
- `apps/web/public/` — static files served at the site root (logos, favicon, vite.svg, etc.).
- `apps/web/index.html` — Google Fonts + Material Symbols `<link>` tags live here.
- `apps/web/eslint.config.js` — flat ESLint config.
- `Implementation Plan/` — design docs and feature plans (not shipped code).

Do not move legacy code into a new folder structure unless the user asks for that refactor. Do not introduce `src/hooks/`, `src/types/`, `src/services/`, `src/store/`, `src/utils/`, etc. unless the user explicitly requests a new convention.

## Architecture Rules

The standard flow for any new admin feature is:

1. **Route** — register the path in `App.jsx`. Wrap admin paths in `<ProtectedRoute>`.
2. **Page** — `src/pages/AdminFeature.jsx`, wrapped in `<AdminLayout>`.
3. **API surface** — add a namespaced object to `src/lib/api.js` (e.g. `api.feature.list`, `api.feature.get`, …). Never call `fetch` directly from a page.
4. **i18n** — add user-facing strings to both `src/i18n/id.js` and `src/i18n/en.js`. Read via `const { t } = useLanguage(); t('keyName')`.
5. **Cache** — for list/detail loads, use the `swr(key, fetcher, onUpdate)` helper exported from `src/lib/api.js`. Hydrate initial state from `apiCache.get(key)` so the table renders on the first paint.
6. **Components** — split heavy UI into `src/components/[feature]/*.jsx` when the page has 3+ owned subcomponents.

Public-page architecture is simpler: section components composed inside `pages/LandingPage.jsx` (Header → HeroSection → CarGrid → FeaturesSection → … → Footer). Keep that flow when adding landing-page sections.

## Routing Rules

All routes live in `apps/web/src/App.jsx`.

Rules:

- Public routes are direct: `<Route path="/" element={<LandingPage />} />`.
- Admin routes (anything under `/admin/...` except `/admin/login`) MUST be wrapped: `<Route path="/admin/x" element={<ProtectedRoute><AdminX /></ProtectedRoute>} />`.
- Use `<Link to="/...">` from `react-router-dom`. Do not use raw `<a href>` for in-app navigation.
- Use `useNavigate()` for programmatic navigation, `useLocation()` for active-link state, `useSearchParams()` for query strings.
- Do not introduce nested router layouts (`<Outlet>` patterns) — current pages compose `<AdminLayout>` themselves.

## Page (Route Component) Rules

Pages are the orchestration layer. They may:

- Read URL params and query strings.
- Hold local UI state with `useState` / `useReducer`.
- Call the centralized API client (`api.*`) and the `swr` cache helper.
- Manage modals, filters, search, sort, and pagination.
- Compose layout primitives (`<AdminLayout>`, `<TablePagination>`, etc.).
- Render lists by mapping over fetched data.

Pages must not:

- Call `fetch` directly (use `api.*`).
- Hardcode the API base URL outside the existing `const API_BASE = 'http://localhost:5000'` pattern used for image URL composition. New API calls go through `api.js`.
- Embed translation strings inline. Add a key and use `t('key')`.
- Re-implement table pagination, format picker, or export/import logic. Reuse the shared components and `lib/dataFormats.js`.
- Duplicate auth/session checks — `<ProtectedRoute>` handles that.

Standard admin page skeleton:

```jsx
import { useState, useEffect } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api, apiCache, swr } from "../lib/api";
import TablePagination, { usePagination } from "../components/TablePagination";

export default function AdminFeature() {
  const { t } = useLanguage();
  const cacheKey = "feature:list";
  const [items, setItems] = useState(() => apiCache.get(cacheKey)?.data || []);
  const [loading, setLoading] = useState(() => !apiCache.has(cacheKey));

  useEffect(() => { load(); }, []);

  function load() {
    swr(cacheKey, () => api.feature.list(), (data) => {
      setItems(data?.data || []);
      setLoading(false);
    }).catch(err => { console.error("Failed to load feature:", err); setLoading(false); });
  }

  return (
    <AdminLayout>
      {/* page body */}
    </AdminLayout>
  );
}
```

## Component Rules

Components in `src/components/` should be small, presentational, and reusable.

Components may:

- Accept props and render markup with Tailwind classes.
- Hold local UI state (open/closed, hover, etc.).
- Call hooks (`useLanguage`, `useAuth`, `useState`, `useEffect`).
- Compose other components.

Components must not:

- Own page-level data fetching unless they are clearly a feature container (e.g. `CarGrid` may fetch its own list).
- Receive deeply nested anonymous prop objects when a flat prop list is clearer.
- Mutate parent state without going through a passed-in callback.
- Hardcode user-facing strings without an i18n fallback path. (Public marketing copy that is intentionally Indonesian-only — like brand taglines — is acceptable, but prefer `t()` when the same surface has both languages.)

Naming:

- Files use `PascalCase.jsx` matching the default-exported component name (`CarCard.jsx` exports `CarCard`).
- Admin pages are prefixed `Admin*` (`AdminFleet`, `AdminOrders`, …).
- Subcomponents owned by one feature live in `src/components/[feature]/` (e.g. `components/finance/ExportModal.jsx`).
- One component per file unless it is a tiny private helper (≤30 lines) used only inside the same file.

## State & Context Rules

- Local component state: `useState`, `useReducer`, `useRef`, `useMemo`. Prefer the smallest scope that works.
- Cross-route shared state: existing `AuthContext` (current user, login/logout) and `LanguageContext` (current language, `t()`).
- Persist user preferences (column visibility, language, dashboard widget config) in `localStorage` with a versioned key like `dsr:orders:visibleColumns:v1`. When the schema changes, write a migration step inside the loader (see `loadVisibleColumns()` in `AdminOrders.jsx`).
- Do not introduce Redux, Zustand, Jotai, Recoil, or React Query. The existing in-memory `swr` + `apiCache` in `src/lib/api.js` is the project's data-fetching pattern.

## API Client Rules

The single source of truth for backend calls is `src/lib/api.js`. It exposes:

- `api.get / post / put / delete` — generic helpers.
- `api.<resource>.<verb>(...)` — namespaced helpers (`api.cars.list`, `api.orders.update`, `api.auth.signIn`, …).
- `swr(key, fetcher, onUpdate)` — stale-while-revalidate wrapper.
- `apiCache` — in-memory cache with `get`, `set`, `has`, `invalidate(prefix)`, `clear`.

Rules:

- Add new endpoints as a new method on the matching resource object inside `api.js`. Match the backend's URL exactly.
- After a mutation (create / update / delete), call `apiCache.invalidate('resource:')` so the next list load refetches.
- Never set the `Authorization` header manually — the request helper sends `credentials: 'include'` so the cookie session works.
- Never set `Content-Type` for `FormData` uploads (the request helper already strips it).
- Map new backend error messages to friendly Indonesian text in the `errorMessageMap` inside `api.js` when the raw English message would reach the user.

## Backend Contract Rules

Always verify the full contract before changing one side of a flow:

- HTTP method
- URL path (matches `api.<resource>.<verb>` definition)
- Route params and query strings
- Request body shape (JSON vs FormData)
- Response shape — most list endpoints return `{ data: [...], total, page, ... }`; pages read `result.data`. Detail endpoints typically return the entity directly.
- Cookie/session expectations (Better Auth sets `connect.sid`-style cookies; `credentials: 'include'` is required).

If a backend change is needed, state clearly which endpoint must change, the new request/response shape, and which file in `api.js` will mirror it. Do not silently change the contract.

## i18n & Wording Rules

The project ships in **Indonesian first, English second**. Indonesian is the canonical product voice; English is a translation.

Rules:

- Every new user-facing string goes into `src/i18n/id.js` AND `src/i18n/en.js`. Use the same key in both.
- Read with `const { t } = useLanguage(); t('keyName')`. Never hardcode a string the user will read.
- Keys are camelCase and feature-scoped: `dashboard`, `fleet`, `orderRecap`, `confirmDelete`, `monthlyOrders`. Do not invent a new naming scheme.
- Voice in Indonesian: clear, semi-formal business tone. Prefer "Simpan", "Batal", "Hapus", "Pesan Sekarang", "Tersedia". Avoid SMS shortcuts (no "yg", "tgl", "dgn").
- Voice in English: plain business English mirroring the Indonesian meaning. Do not invent extra strings the Indonesian copy doesn't have.
- Currency is Indonesian Rupiah, formatted as `Rp1jt`, `Rp500rb`, or full `Rp1.250.000` per the helper used in `CarCard.jsx`. Match the surrounding format.
- Dates: short Indonesian format (`12 Mei 2026`) or ISO (`2026-05-12`) where machine-readable is needed. Match the surrounding column.

## Design System & Tailwind Rules

Tailwind is configured **CSS-first** in `src/index.css` via `@theme { … }`. There is no `tailwind.config.js`. To add or edit a color, font, or token, edit the `@theme` block.

Brand tokens (do not change without explicit request):

- `--color-primary: #ff0008` — DSR red, used for primary CTAs, active nav, badges.
- `--color-primary-dark: #cc0006` — hover state for primary.
- `--color-primary-hover: #d40007`
- `--color-whatsapp: #25D366` — only the WhatsApp FAB.
- `--color-background-light: #fcf8f8` — public-page background.
- `--color-background-dark: #230f0f`
- `--color-text-main: #1d0c0d`
- `--color-text-sub: #a14548`
- `--color-border-color: #eacdce`
- `--color-sidebar-dark: #1a1a1a` — admin sidebar background.
- `--color-sidebar-text: #d4d4d4`
- `--color-sidebar-hover: #2e2e2e`

Plus a Material Design 3 token set (`--color-on-tertiary`, `--color-surface`, `--color-outline`, …) used by the schedule view. Reuse those tokens in the schedule page; do not introduce parallel ad-hoc colors.

Typography:

- Headings: `font-display` → Outfit.
- Body: `font-body` → Inter.
- Body element already sets these in `index.css`. Do not override globally.

Layout & visual conventions:

- Cards: `rounded-xl bg-white shadow-sm border border-gray-100`. On hover: `hover:shadow-xl hover:-translate-y-1 transition-all duration-300` (see `CarCard.jsx`).
- Buttons (primary): `bg-primary hover:bg-primary-dark text-white font-bold rounded-lg`. Add `shadow-md shadow-primary/20` for emphasis.
- Status badges follow a `statusColors` map per page (e.g. `available: "bg-green-100 text-green-700"`). Reuse the same color semantics:
  - green = available / active / completed-success
  - blue = confirmed / rented (in-use)
  - amber = pending / maintenance
  - red = cancelled / error
  - slate = completed / archived
- Page background (admin): `bg-[#f8f5f5]` — set by `AdminLayout`. Do not override per-page.
- Mobile breakpoint: `md:` (768px). The admin sidebar is `hidden md:flex` and toggles via `mobileMenuOpen` state managed in `AdminLayout`.
- Spacing scale: stick to Tailwind defaults (`gap-3`, `p-4`, `p-8 lg:px-12`). Avoid arbitrary values like `p-[17px]` unless matching an existing one.
- Use Tailwind utility classes inline. Do not add new global CSS unless extending `index.css` `@theme` or adding a keyframe (`fadeIn`, `slideUp` exist already — reuse them).

Forbidden in styles unless explicitly requested:

- A new CSS framework, design system library, or component kit.
- CSS modules, styled-components, emotion, vanilla-extract.
- A `tailwind.config.js` file (we are on Tailwind v4 CSS-first).
- Inline `<style>` tags.

## Iconography Rules

Icons come from **Material Symbols Outlined** (loaded in `index.html`). Use them like:

```jsx
<span className="material-symbols-outlined text-[22px]">dashboard</span>
```

- Pick icon names from the official Material Symbols set.
- Size with `text-[Npx]` arbitrary value to keep visual rhythm consistent with the sidebar (`22px`), card meta rows (`18px`), and sort indicators (`14px`).
- Do not introduce `lucide-react`, `react-icons`, `heroicons`, FontAwesome, or SVG icon files for a glyph that exists in Material Symbols.

## Auth Rules

Authentication is cookie-based through Better Auth on the backend. The frontend touches it via:

- `useAuth()` — exposes `user`, `loading`, `login(email, password)`, `register(name, email, password)`, `logout()`, `checkSession()`.
- `<ProtectedRoute>` — renders a loading spinner while `loading` is true, redirects to `/admin/login` when there is no `user`, otherwise renders children.
- `api.auth.signIn / signUp / signOut / getSession` — the only correct way to hit auth endpoints.

Rules:

- Always wrap new admin routes in `<ProtectedRoute>`.
- Never store passwords or tokens in `localStorage`. Sessions are managed by HTTP-only cookies the backend sets.
- Surface errors from `api.auth.*` directly — `errorMessageMap` already translates the common ones to Indonesian.
- Do not fork the auth flow per page. If a page needs the current user, read `useAuth()`.

## Caching Rules

Use the shared `swr` + `apiCache` from `src/lib/api.js`.

Rules:

- Cache key naming: `<resource>:<view>:<filterA>:<filterB>` — colon-separated, lowercase. Examples: `cars:list:available:createdAt:desc`, `cars:stats`, `orders:list::pickupDate:asc`.
- Hydrate from `apiCache.get(key)` inside `useState` initializers so the page renders immediately on revisit.
- Use `setLoading(() => !apiCache.has(key))` so spinners only show on a true cold load.
- After a mutation, call `apiCache.invalidate('<resource>:')` — the prefix wipe — so the next list refetches.
- Do not write to `apiCache` directly from a page; the `swr` helper handles writes.

## Forms & Validation Rules

The codebase uses plain controlled inputs, no form library.

Rules:

- Manage form state with one `useState` object (see `emptyForm` in `AdminFleet.jsx`).
- Validate inline before calling `api.*`. Show errors as red helper text under the field.
- File uploads use `FormData`. Don't set `Content-Type`; `api.post` handles it.
- For multi-step forms, keep the state in the page component, not in a context.
- Do not introduce Formik, React Hook Form, Yup, Zod, or any validation library.

## Tables, Pagination & Sorting Rules

Reuse the shared building blocks:

- `<TablePagination>` from `src/components/TablePagination.jsx` for page-size + paging UI. Pair with the `usePagination` hook.
- Column visibility patterns: store the visible-column array in `localStorage` under a versioned key (`dsr:<feature>:visibleColumns:v1`). On load, run a migration step if columns were renamed/split (see `AdminOrders.jsx`).
- Sort by clicking a column header. Local `sortBy` + `sortOrder` state, with the `SortIcon` pattern from `AdminFleet.jsx`.
- Client-side filter for search, server-side filter for status / sort / sort order — match what each page already does.
- Status pills: `<span className="px-2 py-0.5 rounded text-xs font-medium ${statusColors[status]}">`.

## Export / Import Rules

The project supports XLSX, CSV, JSON, XML, and TXT through `src/lib/dataFormats.js` and `src/components/FormatPickerModal.jsx`.

Rules:

- Use the existing `exportAs(rows, format, filename)` and `parse(file, format)` helpers.
- Use `<FormatPickerModal>` to let users pick a format. Do not build a separate UI.
- Backend `exportData` / `importData` endpoints are the canonical persistence path. Wire new resources by adding `api.<resource>.exportData` and `api.<resource>.importData` in `api.js`.
- XLSX support is lazy-loaded from CDN at first use — do not `npm install` SheetJS.

## Logging Rules

- Use `console.error("Failed to load <thing>:", err)` for swallowed background errors (e.g. failed `swr` refetch).
- Do not leave `console.log` in shipped code.
- Do not add a logging library.
- Never log password fields, full session cookies, or full PII payloads.

## Build & Verification Rules

Available scripts (from `apps/web/package.json`):

- `npm run dev` — Vite dev server on `http://localhost:5173`.
- `npm run build` — production build into `dist/`.
- `npm run lint` — ESLint over `**/*.{js,jsx}`.
- `npm run preview` — preview the production build.

Before finishing a change:

- Run `npm run lint` if the change touches more than one file.
- Visually confirm the page mounts (manual `npm run dev` + browser check) when the change spans layout/state.
- Confirm the i18n key exists in BOTH `id.js` and `en.js` if a string was added.
- Confirm `api.<resource>.<verb>` exists in `api.js` if a new endpoint was used.
- Confirm `<ProtectedRoute>` wraps any new admin route.

If the change is trivial (one-line copy, one Tailwind class), running the dev server is optional; state that explicitly.

## Git & Editing Rules

1. Do not revert user changes unless explicitly requested.
2. Keep edits limited to the requested files and directly related dependencies (e.g. an i18n key in both language files counts as related).
3. Do not format unrelated files. Match the surrounding indentation (2 spaces, double-quoted JSX strings, single-quoted JS strings — both appear; mirror the file you're editing).
4. Do not rename files or move folders unless the user asks.
5. Do not delete `*_backup_YYYYMMDD.jsx` files. They are intentional snapshots.
6. Do not commit `node_modules/`, `dist/`, or `.env*` files.

## Output Rules for AI Responses

When generating or changing code:

1. Always mention the file path (full or `apps/web/src/...`).
2. Explain the changed section briefly.
3. Do not provide code without a path.
4. Do not place logic in the wrong layer (no `fetch` in components, no JSX in `lib/`, no inline copy without an i18n key).
5. State any build/lint command that was run, and the result.
6. If verification was skipped or impossible, state why.
7. When adding a new admin page, also list the route to add in `App.jsx`, the i18n keys to add in `id.js` and `en.js`, and the `api.<resource>` block to add in `api.js`.
8. When adding a new API method, also provide the matching backend endpoint contract (HTTP method, path, request body shape, expected response shape) so the backend team can mirror it.
9. When adding a new color, font, or design token, edit `@theme` in `src/index.css` and call out the new token name.
10. Keep the answer direct and specific. Indonesian project, English answers — unless the user writes to you in Indonesian.

## Backend Endpoint Spec Rules

When introducing or modifying a frontend API call, document the matching backend contract:

- HTTP method.
- URL path (must match `api.<resource>.<verb>` exactly).
- Required headers (the request helper already sends cookie + JSON; mention only deviations).
- Request body type — JSON for normal calls, `FormData` for uploads.
- Example request payload.
- Expected success response shape (list endpoints almost always return `{ data, total, page, ... }`; detail endpoints return the entity).
- Expected error response shape (Better Auth uses `{ message, code }`; other endpoints use `{ error }`). The frontend reads either via `errBody.message || errBody.error`.

Rules:

- Match the actual `api.js` method signature exactly.
- Do not invent fields the frontend will not send or read.
- For file downloads, mention the expected `Content-Type` and `Content-Disposition`.
- For uploads, list the expected multipart field names (`file`, `images[]`, etc.).

## Forbidden Unless Explicitly Requested

Do not introduce:

- TypeScript or `.tsx` files.
- Next.js, Remix, Astro, or any meta-framework.
- Redux, Zustand, Jotai, Recoil, MobX.
- React Query / TanStack Query, SWR (the npm one), Axios.
- A new component library (MUI, Chakra, shadcn/ui, Radix, Mantine, Ant Design, …).
- A different icon set (lucide-react, heroicons, react-icons, …).
- Storybook, Jest, Vitest, Playwright, Cypress, or any new test infrastructure.
- A `tailwind.config.js` file (Tailwind v4 is configured in CSS).
- CSS-in-JS libraries.
- Server-side rendering or hydration logic.
- A new monorepo tool (Turbo, Nx, pnpm workspaces) — current layout uses plain `apps/web`.
- Backend code in this repo (the API lives elsewhere; do not start one here).

## Decision Checklist

Before editing, ask these questions silently:

1. Which surface owns this — public landing page or admin panel?
2. Is this a route change (`App.jsx`), a page (`pages/`), a shared component (`components/`), a context, or a lib helper?
3. If it's a data fetch, does `api.<resource>.<verb>` already exist? If not, where in `api.js` should it sit?
4. Does the backend endpoint already exist, or is it new? If new, what is the exact contract?
5. Will any user-facing text change? If yes, which keys in `id.js` and `en.js`?
6. Should this state be persisted across reloads (`localStorage` with a `dsr:*:v1` key) or live only in component state?
7. Does this list need `swr` caching and `apiCache.invalidate` on mutation?
8. Does an existing helper (`TablePagination`, `FormatPickerModal`, `dataFormats.js`, `AdminLayout`) already cover this, or is something genuinely new?
9. Can this be fixed without a broad refactor?

If any answer is unclear, inspect the surrounding files before changing code.
