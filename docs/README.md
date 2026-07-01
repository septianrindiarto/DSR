# DSR Solution — Documentation Index

Start here. This folder is the knowledge base for the DSR Solution car-rental
platform — for developers, AI assistants, operators, and users.

## Read in this order

| Doc | What it's for | Audience |
|-----|---------------|----------|
| [`../CLAUDE.md`](../CLAUDE.md) | Canonical project context (stack, the two invariants, conventions, how to add a feature, gotchas). Load every AI session. | AI assistants, devs |
| [`../AGENTS.md`](../AGENTS.md) | Detailed **frontend** conventions (React/Tailwind/i18n/api.js rules). | AI assistants, frontend devs |
| [`Build_With_AI_Walkthrough.md`](Build_With_AI_Walkthrough.md) | How the whole app is built: design, infra, security, DB, and **every feature as input→process→output**. Follow it to rebuild the app or lift a mechanism. | Devs, learners, adopters |
| [`User_Guide.md`](User_Guide.md) | How to **use** every feature — separate client and agency walkthroughs. | Clients, agency staff, support |
| [`Deployment_Master_Guide.md`](Deployment_Master_Guide.md) | Step-by-step VPS deployment + ops + troubleshooting. | Operators |
| [`CICD_GitHub_Actions_Setup.md`](CICD_GitHub_Actions_Setup.md) | One-time setup for auto-deploy on push (GitHub Actions → VPS). | Operators |
| [`Tier2_E2E_Test_Matrix.md`](Tier2_E2E_Test_Matrix.md) | Manual test matrix for the multi-vehicle flows (pairs with `apps/api/test/`). | QA, devs |
| [`Stage1_Request_Milestones.md`](Stage1_Request_Milestones.md) | Chronological log of requests & milestones for Stage 1, plus workflow notes and open follow-ups. | PM, devs |
| [`Stage2_Request_Milestones.md`](Stage2_Request_Milestones.md) | Stage 2 milestone log (post-launch enhancements & ops). | PM, devs |
| [`Stage2_OrderClaim_Design.md`](Stage2_OrderClaim_Design.md) | Design note: agency↔client foundation fixes + claim-based order routing + agent affiliate links (not yet built). | Devs |
| [`Multi_Vendor_Roadmap.md`](Multi_Vendor_Roadmap.md) | Phase 2 design note (many clients ↔ many agencies). | Devs (future) |
| [`Audit_v2_Reconciliation.md`](Audit_v2_Reconciliation.md) | Reconciliation of the v2 QA audit vs actual code state. | Devs |

## Quick orientation

- **What is it?** A car-rental platform with a public booking surface and an
  admin panel; two account types (agency / client). See `User_Guide.md` §1.
- **The two ideas everything else builds on:** org-scoped multi-tenancy, and the
  shared booking code (one booking = N car rows sharing one `order_number`). See
  `CLAUDE.md` → "The two invariants".
- **Where code lives:** `apps/web/` (React frontend), `apps/api/` (Express +
  Drizzle backend), `apps/api/drizzle/` (SQL migrations).

## Conventions for keeping these docs useful

- When you add a feature, update `Build_With_AI_Walkthrough.md` (the IPO entry)
  and, if it changes the contract/conventions, `CLAUDE.md`.
- Log each working stage in its own `StageN_Request_Milestones.md` and link it
  here.
- Keep user-facing changes reflected in `User_Guide.md`.
- Operational changes (env, migrations, deploy steps) go in
  `Deployment_Master_Guide.md`.
