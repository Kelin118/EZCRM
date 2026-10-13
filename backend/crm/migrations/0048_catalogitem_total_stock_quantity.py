from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0047_client_relatives'),
    ]

    operations = [
        migrations.AddField(
            model_name='catalogitem',
            name='total_stock_quantity',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
