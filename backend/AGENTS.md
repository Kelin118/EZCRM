# EZCRM Backend Instructions

## Architecture

- Use existing Django/DRF architecture.
- Inspect models, serializers, views, permissions, and helpers before adding abstractions.
- Do not create duplicate services for functionality that already exists.
- Prefer extending existing shared helpers.

## Data Integrity

- Historical finance/payroll/payment data must not be silently rewritten.
- Use Decimal for financial calculations.
- Use transaction.atomic for multi-model writes.
- Use select_for_update for race-sensitive operations.
- Ensure retries/double submit do not create duplicates.
- Prefer database constraints when appropriate.
- Do not delete historical data merely to simplify code.

## Migrations

- Real schema changes require committed migrations.
- Data migrations must be deterministic and safe.
- Prefer idempotent migration logic where practical.
- Never run makemigrations in production/Render.
- Never use --fake as a workaround.
- After creating migrations run:

```powershell
backend\venv\Scripts\python.exe backend\manage.py makemigrations --check --dry-run
```

## API

- Validate business rules server-side.
- Return human-readable validation errors.
- Preserve existing API compatibility where practical.
- Do not expose secrets, tokens, or credentials.
- Enforce roles and permissions server-side.
- Do not rely on frontend-only access control.

## Queries

- Use select_related/prefetch_related appropriately.
- Avoid serializer N+1 queries.
- Do not iterate large querysets in Python when a database query can safely perform the operation.
- Be mindful of list endpoints and report endpoints.

## Time

- Respect Django timezone settings.
- Business-day comparisons must use local application time when appropriate.
- Historical calculations must use the historical date, not today's schedule/configuration unless explicitly intended.

## Tests

For changed business logic:
- add regression tests;
- test permissions;
- test edge cases;
- test historical-data compatibility;
- test duplicate/concurrency behavior where relevant;
- test financial double-counting where relevant.
