# EZCRM

Educational center CRM.

## Stack

Backend:
- Django REST Framework
- Django ORM
- PostgreSQL in production

Frontend:
- React
- Vite
- existing Tailwind/project UI components

Deployment:
- Render

## General Rules

- Before changing functionality, inspect the existing implementation.
- Extend existing architecture instead of creating parallel systems.
- Reuse existing models, serializers, helpers, hooks, utilities, and UI components.
- Do not duplicate business logic between frontend and backend.
- Backend remains the source of truth for authoritative business rules.
- Preserve backward compatibility unless the task explicitly requires breaking it.
- Never silently delete or rewrite historical business, finance, payment, or payroll data.
- Use Decimal for money; never float for authoritative financial calculations.
- Use application timezone for business dates and times.
- Avoid N+1 queries.
- Use transaction.atomic/select_for_update where concurrency matters.
- Validate permissions server-side.
- User-facing CRM content is Russian unless the task explicitly specifies otherwise.
- Code names, classes, variables, and IDs remain English.

## Scope Discipline

- Do not redesign unrelated screens.
- Do not refactor unrelated backend/frontend code.
- Do not modify migrations unless a real schema/model change requires it.
- Do not create migrations merely to make checks pass.
- Never use --fake migrations unless schema state has explicitly been verified.
- Never run makemigrations on Render.
- Never touch "Текстовый документ.txt".

## Git

- Do not commit unless explicitly asked.
- Do not push unless explicitly asked.
- Never stage unrelated or untracked files.
- Always show `git status --short` after work.

## Testing

For backend changes, run when relevant:

```powershell
backend\venv\Scripts\python.exe backend\manage.py makemigrations --check --dry-run
backend\venv\Scripts\python.exe backend\manage.py check
```

During iteration, prefer focused tests for affected functionality.

Before final completion, run the relevant final test scope.

When the task materially affects broad backend behavior, use:

```powershell
backend\venv\Scripts\python.exe backend\manage.py test crm users --noinput
```

For frontend changes, run:

```powershell
npm.cmd --prefix frontend run build
```

Always run when relevant:

```powershell
git diff --check
git status --short
```

Do not blindly run the entire backend test suite for every small iteration when a focused suite is sufficient.

## Communication During Verification

When running tests, builds, migration checks, Django checks, linters, git diff checks, browser test suites, or other automated verification, stay silent until the command finishes.

Do not send intermediate progress messages, narrate individual test cases, or repeatedly report that a command is still running. After completion, report only what verification completed, whether it passed or failed, final count/summary when available, and relevant error details only if failed.

Interrupt this silence only if explicit user input is required, a command is genuinely stuck, environment permissions block execution, or execution cannot continue without intervention.

## Completion Report

At the end report changed files, what changed, migration status, tests/build/checks, browser verification if actually performed, and `git status --short`.
