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
| [`Server_Monitoring_Assessment.md`](Server_Monitoring_Assessment.md) | What to monitor and the proposed built-in monitoring page (not built yet). | Operators |
| [`CICD_GitHub_Actions_Setup.md`](CICD_GitHub_Actions_Setup.md) | One-time setup for auto-deploy on push (GitHub Actions → VPS). | Operators |
| [`Reliability_DR_Runbook.md`](Reliability_DR_Runbook.md) | Neon reliability (health, keep-warm), backups (`ops/backup/`), recovery playbooks, drills, data retention. | Operators |
| [`GPS_Telematics_Design.md`](GPS_Telematics_Design.md) | GPS tracking + driver behaviour design (Traccar, storage, scoring, phases). Not built yet. | PM, devs |

Internal documents — test scenarios, the review register (decisions awaiting the
owner), business spreadsheets, stage logs and strategy notes — are kept locally
and are not part of this repository.

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
- Internal / private documents are listed in `PRIVATE_INDEX.md` (local only, git-ignored);
  never link them from this public index.
- Keep user-facing changes reflected in `User_Guide.md`.
- Operational changes (env, migrations, deploy steps) go in
  `Deployment_Master_Guide.md`.
