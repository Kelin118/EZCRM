import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from django.conf import settings


def create_database_backup():
    backups_dir = Path(settings.BASE_DIR) / 'backups'
    backups_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    database = settings.DATABASES['default']
    engine = database.get('ENGINE', '')

    if 'postgresql' in engine:
        filename = f'educrm_backup_{timestamp}.sql'
        path = backups_dir / filename
        pg_dump = os.getenv('PG_DUMP_PATH') or shutil.which('pg_dump')
        if not pg_dump:
            raise RuntimeError('pg_dump не найден. Добавьте PostgreSQL bin в PATH или укажите PG_DUMP_PATH в .env')

        env = os.environ.copy()
        if database.get('PASSWORD'):
            env['PGPASSWORD'] = database['PASSWORD']
        command = [
            pg_dump,
            '-h',
            str(database.get('HOST') or 'localhost'),
            '-p',
            str(database.get('PORT') or '5432'),
            '-U',
            str(database.get('USER') or 'postgres'),
            '-d',
            str(database.get('NAME')),
            '-f',
            str(path),
        ]
        result = subprocess.run(command, env=env, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or 'Не удалось создать PostgreSQL backup.')
        return {'filename': filename, 'path': path}

    if 'sqlite3' in engine:
        source = Path(database['NAME'])
        filename = f'educrm_backup_{timestamp}.sqlite3'
        path = backups_dir / filename
        shutil.copy2(source, path)
        return {'filename': filename, 'path': path}

    raise RuntimeError(f'Backup для engine {engine} не поддержан.')
