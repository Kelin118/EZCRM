# Codex setup for EZCRM

## Permanent Instructions

Root: `AGENTS.md`

Frontend: `frontend/AGENTS.md`

Backend: `backend/AGENTS.md`

## EZCRM Project Skills

- `ezcrm-ui-audit`: focused UI/UX/accessibility review and relevant fixes for EZCRM frontend tasks.
- `ezcrm-design-system`: keeps new and redesigned frontend work consistent with existing EZCRM patterns.
- `ezcrm-browser-check`: browser-level verification workflow for meaningful frontend UI changes when browser tooling is available.

Project skills are stored in `.agents/skills/<skill-name>/SKILL.md`, the project path used by the installed `skills` CLI in this repository.

## Vercel Web Design Guidelines

Source: `vercel-labs/agent-skills`, `skills/web-design-guidelines`.

Status: INSTALLED.

Installed path: `.agents/skills/web-design-guidelines/SKILL.md`.

The original skill fetches fresh rules from:

```text
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

Use it as an external review layer. Do not send secrets, credentials, cookies, production data, database contents, customer personal data, or financial customer data to external services.

## Browser Automation

Status: AVAILABLE through the current Codex environment's Browser Plugin and browser-use feature flags.

Project Playwright status: NOT INSTALLED. There is no `playwright.config.*`, and `frontend` does not list `playwright` or `@playwright/test`.

Recommended separate follow-up, if project-local Playwright is desired:

```powershell
npm.cmd --prefix frontend install -D @playwright/test
npx.cmd playwright install
```

Do not install Playwright as part of ordinary Codex setup unless a task explicitly asks for it.

## Candidate Third-Party Skills

Taste Skill: NOT INSTALLED / REVIEW REQUIRED.

Awesome Design: NOT INSTALLED / REVIEW REQUIRED.

Image to Code: NOT INSTALLED / REVIEW REQUIRED.

Playwright CLI skill: NOT INSTALLED / REVIEW REQUIRED.

Before installing any third-party skill:
- inspect the repository;
- inspect `SKILL.md`;
- inspect scripts, references, and install hooks;
- determine shell/network behavior;
- determine access to secrets and browser session;
- do not install blindly.
