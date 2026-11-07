from django.db import migrations, models


def mark_existing_culinary_subjects(apps, schema_editor):
    subject_model = apps.get_model('crm', 'MasterClassSubject')
    subject_model.objects.using(schema_editor.connection.alias).filter(
        name__icontains='Кулинарный мастер класс',
    ).update(is_culinary=True)


class Migration(migrations.Migration):
    dependencies = [('crm', '0049_master_class_purchase_group')]

    operations = [
        migrations.AddField(
            model_name='masterclasssubject',
            name='is_culinary',
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(mark_existing_culinary_subjects, migrations.RunPython.noop),
    ]
