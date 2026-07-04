# EDUCRM / EZCRM Deploy Checklist

## 1. Backend

Create and activate a Python environment, then install dependencies:

```bash
pip install -r backend/requirements.txt
```

Local run from the repository root:

```powershell
cd C:\Users\kivim\Desktop\EDUCRM
backend\venv\Scripts\python.exe backend\manage.py runserver
```

## 2. Environment

Copy `backend/.env.example` to `backend/.env` and set real values:

```env
DEBUG=False
SECRET_KEY=change-me
ALLOWED_HOSTS=domain.kz,www.domain.kz
CORS_ALLOWED_ORIGINS=https://domain.kz,https://www.domain.kz
CSRF_TRUSTED_ORIGINS=https://domain.kz,https://www.domain.kz
DB_ENGINE=postgres
DB_NAME=educrm
DB_USER=postgres
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432
```

Never commit real `.env` files.

## 3. PostgreSQL

Create the database and user, then verify the app can connect with:

```bash
python manage.py check
```

## 4. Migrations

```bash
python manage.py migrate
```

## 5. Admin User

Create the first admin through the app registration flow or use:

```bash
python manage.py createsuperuser
```

## 6. Static Files

```bash
python manage.py collectstatic --noinput
```

## 7. Gunicorn

Example production command from the `backend` directory:

```bash
gunicorn config.wsgi:application
```

Use a process manager such as systemd or supervisor in production.

## 8. Frontend

Copy `frontend/.env.example` to `frontend/.env` and set:

```env
VITE_API_BASE_URL=https://domain.kz/api
```

Local frontend run:

```powershell
cd C:\Users\kivim\Desktop\EDUCRM\frontend
npm run dev -- --port 5173
```

Production build:

```bash
npm run build
```

## 9. Nginx / Reverse Proxy

Serve the frontend build as static files and proxy `/api/` to the backend Gunicorn service. Configure HTTPS and forward the original host/protocol headers.

## 10. Backup

Create a database backup before deploys and before risky migrations:

```bash
python manage.py backup_db
```

For PostgreSQL, ensure `pg_dump` is available in `PATH` or set `PG_DUMP_PATH`.

## 11. Rollback

Keep the previous frontend build, backend release, and latest database backup. If deploy fails, restore the previous code/build and restore the database from the backup if migrations changed data.
