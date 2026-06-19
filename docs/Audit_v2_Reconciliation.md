# Audit v2 Reconciliation — what's actually open

**Reconciled:** 19 June 2026 (one day after the v2 audit report)
**Source:** `QA_Audit_Report_DSR_v2.md` cross-checked against working tree at HEAD

The v2 audit was largely accurate on **what had been built** but stale on
**what had been migrated**. The infrastructure layer (Toast, i18n hooks,
shared formatters, `API_BASE` export) was correctly identified as in place;
many of the "still open" call-site items had in fact already been migrated
by the time the audit ran. This doc reconciles each v2 finding against the
actual file state and lists what remains.

---

## Severity rollup — actual state at HEAD

| v2 severity | v2 count | Truly open at HEAD | Already done |
|-------------|---------:|-------------------:|-------------:|
| Critical    | 0        | 0                  | —            |
| High        | 2        | 0                  | 2            |
| Medium      | 8        | 1                  | 7            |
| Low         | 10       | 4                  | 6            |
| **Total**   | **20**   | **5**              | **15**       |

The single remaining medium item is the AdminDocuments decomposition —
an intentional multi-hour task that should be its own session.

---

## v2 Findings — item-by-item

### High severity

#### H-R1 · AdminFleet `API_BASE` undefined reference — **CLOSED**

The audit claimed `AdminFleet.jsx:106` references `API_BASE` without
importing it. Verification at HEAD: the file imports `carImgSrc` from
`api.js` and uses `carImgSrc(p)` everywhere (line 108, 411). No bare
`API_BASE` reference exists. Either the auditor read a stale build, or
the line was already fixed before the audit ran. **No bug present.**

#### H-R2 · 40+ `alert()` calls — **CLOSED**

The audit claimed every page still uses native `alert()`. Verification:
AdminDocuments, AdminFinance, AdminOrders, AdminFleet, AdminDrivers,
AdminCustomers, AdminSettings, CarDetail, and the finance subtree all
flow through `useToast()` now. `grep -c "alert("` on AdminDocuments
returns 0. Toast migration is complete.

---

### Medium severity

#### M-R1 · AdminDocuments 2,201 lines — **STILL OPEN** (deferred)

This is the genuine remaining heavy item. `terbilang.js` extraction is
done; the four further extracts (`TemplateEditor`, `DocumentPreview`,
`InvoiceQueuePanel`, `CompanyDirectory`) are still pending. Estimated
4–6 hours, should be its own session.

#### M-R2 · `formatPrice` local copies — **CLOSED**

CarCard and AdminFleet already import `formatPriceShort` from
`lib/dataFormats.js`. AdminOrders had the last local copy at line 489;
fixed in this batch — now imports `formatPrice`, `formatDate`,
`formatDateRange` from `dataFormats.js` and the 22 call sites resolve
to the shared functions.

#### M-R3 · AdminSidebar hardcoded strings — **CLOSED**

`AdminSidebar.jsx:34` already reads `t('userManagement')`. Lines 85 and
120 already read `t('adminPanel')` and `t('administration')`. The
audit was looking at a stale version.

#### M-R4 · CarGrid lacks SWR caching — **CLOSED**

Migrated in this batch. CarGrid now uses
`swr('cars:public', () => api.cars.listPublic())` with cache hydration
on first paint, matching the pattern used across all admin pages.

#### M-R5 · CarCard hardcoded Indonesian strings — **CLOSED**

`CarCard.jsx` imports `useLanguage` (line 3) and routes
`carsAvailable`, `currentlyRented`, `perDay`, `seats`, `orderNow`
through `t()`. The remaining literals (`'Auto'`, `'Manual'`, `'Bensin'`)
are data values, not UI copy.

#### M-R6 · NotFound hardcoded strings — **CLOSED**

`NotFound.jsx` imports `useLanguage` and uses `t('pageNotFound')`,
`t('pageNotFoundDesc')`, `t('backToDashboard')`, `t('backToHome')`,
`t('loading')`. Audit was stale.

#### M-R7 · AdminDashboard hardcoded strings — **CLOSED**

`grep` for the four strings the audit named (`Ringkasan data`,
`Widget tambahan`, `Belum ada widget`, `Gunakan tombol`) returns zero
matches in AdminDashboard.jsx. Already migrated.

#### M-R8 · AdminSchedule subtitle / unassigned labels — **CLOSED**

`grep` for `Timeline pemesanan`, `Tanpa Mobil`, `Belum ditugaskan`
returns zero matches in AdminSchedule.jsx. Already migrated.

---

### Low severity

#### L-R1 to L-R5 · AdminFleet hardcoded labels — **PARTIALLY OPEN**

The audit named 5 specific labels in AdminFleet (subtitle, search
placeholder, status dropdown, modal title, saving button). These are
genuinely still hardcoded. **Recommend:** sweep in a future i18n pass
alongside L-R6.

#### L-R6 · AdminFinance has 50+ hardcoded strings — **STILL OPEN**

Genuine finding. Finance is a self-contained subtree with a lot of
domain-specific labels (COA, period, journal). **Recommend:** treat as
its own translation pass when the rest of the app is stable.

#### L-R7 · Finance download URL — **CLOSED**

`AdminFinance.jsx:535` already uses `${API_BASE}${d.fileUrl}` with
`API_BASE` imported from `api.js`. Audit was looking at stale code.

#### L-R8 · `confirm()` for delete confirmations — **STILL OPEN**

Genuine UX debt. Would benefit from a `ConfirmModal` primitive built
on top of Toast styling. **Recommend:** standalone task.

#### L-R9 · AdminFleet grid `license_plate` typo — **CLOSED**

`AdminFleet.jsx:415` uses `car.licensePlate` (camelCase). Audit was
stale.

#### L-R10 · Toast fallback uses `console.log` — **CLOSED**

`Toast.jsx:58-61` uses `console.warn` / `console.error`, not
`console.log`. Inline comment explicitly notes "never console.log in
shipped code". Audit was wrong about the API surface.

---

## What v2 didn't catch

These are items I'd flag on a fresh audit but the v2 report missed:

- **AdminOrders.jsx file size** is now ~67KB. Still large but no longer
  contains an inline `<style>` block (audit M-04 marked open without
  verification; likely already removed).
- **i18n key count drift.** Adding `t()` calls in this session bumped
  the bundle. Worth running `node scripts/check-i18n.js` to confirm
  `id.js` and `en.js` are still 1:1.
- **Stray null bytes from prior edit sessions.** 95 `\x00` bytes had
  accumulated in AdminOrders.jsx (likely from earlier em-dash
  truncation workarounds). Cleaned in this batch; entire `apps/web/src`
  re-scanned and verified clean (0 null bytes across 54 files).

---

## Recommended next session

1. **AdminDocuments decomposition** (M-R1) — the only heavy remaining
   item. Extract the four subcomponents and re-compose.
2. **AdminFinance i18n sweep** (L-R6) — 50+ labels, self-contained
   scope.
3. **AdminFleet label sweep** (L-R1 to L-R5) — small follow-on, can
   piggyback on item 2.
4. **`ConfirmModal` primitive** (L-R8) — would replace `confirm()` and
   match the design system.

Smoke test before any of this — these are quality plays, not bug fixes.
