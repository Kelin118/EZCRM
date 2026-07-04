from django.core.management.base import BaseCommand, CommandError

from crm.backup import create_database_backup


class Command(BaseCommand):
    help = 'Create a local database backup in backend/backups/.'

    def handle(self, *args, **options):
        try:
            result = create_database_backup()
        except Exception as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(f"Backup created: {result['filename']}"))
