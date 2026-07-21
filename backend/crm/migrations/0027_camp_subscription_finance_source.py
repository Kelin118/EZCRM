from django.db import migrations


def forwards(apps, schema_editor):
    FinanceTransaction = apps.get_model('crm', 'FinanceTransaction')
    FinanceTransaction.objects.filter(
        source='subscription',
        subscription__service__service_type='camp',
    ).update(source='camp')


def backwards(apps, schema_editor):
    FinanceTransaction = apps.get_model('crm', 'FinanceTransaction')
    FinanceTransaction.objects.filter(
        source='camp',
        subscription__service__service_type='camp',
    ).update(source='subscription')


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0026_catalogitem_service_type'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
