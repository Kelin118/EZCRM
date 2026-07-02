# Generated manually for Excel import stages.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0006_client_direction_client_parent_name_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='trial',
            name='status',
            field=models.CharField(
                choices=[
                    ('lead', 'Lead'),
                    ('booked', 'Booked'),
                    ('attended', 'Attended'),
                    ('bought', 'Bought'),
                    ('lost', 'Lost'),
                    ('new', 'New'),
                    ('scheduled', 'Scheduled'),
                    ('completed', 'Completed'),
                    ('cancelled', 'Cancelled'),
                ],
                default='new',
                max_length=20,
            ),
        ),
    ]
