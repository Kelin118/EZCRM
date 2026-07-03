from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0008_auditlog'),
    ]

    operations = [
        migrations.AlterField(
            model_name='masterclass',
            name='stage',
            field=models.CharField(
                choices=[
                    ('lead', 'Lead'),
                    ('booked', 'Booked'),
                    ('attended', 'Attended'),
                    ('paid', 'Paid'),
                    ('bought', 'Bought'),
                    ('lost', 'Lost'),
                    ('planned', 'Planned'),
                    ('completed', 'Completed'),
                    ('cancelled', 'Cancelled'),
                ],
                default='planned',
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='task',
            name='status',
            field=models.CharField(
                choices=[
                    ('new', 'New'),
                    ('todo', 'To do'),
                    ('in_progress', 'In progress'),
                    ('today', 'Today'),
                    ('overdue', 'Overdue'),
                    ('done', 'Done'),
                    ('cancelled', 'Cancelled'),
                ],
                default='todo',
                max_length=20,
            ),
        ),
    ]
