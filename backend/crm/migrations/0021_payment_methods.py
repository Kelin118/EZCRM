from django.db import migrations, models
import django.db.models.deletion


ALIASES = {
    'cash': ('Наличные', 'cash'), 'наличные': ('Наличные', 'cash'),
    'card': ('Банковская карта', 'card'), 'terminal': ('Банковская карта', 'card'), 'карта': ('Банковская карта', 'card'),
    'kaspi': ('Kaspi QR', 'kaspi_qr'), 'kaspi_qr': ('Kaspi QR', 'kaspi_qr'),
    'transfer': ('Перевод', 'transfer'), 'перевод': ('Перевод', 'transfer'),
}
DEFAULTS = [('Наличные', 'cash'), ('Банковская карта', 'card'), ('Kaspi QR', 'kaspi_qr'), ('Перевод', 'transfer')]


def migrate_payment_methods(apps, schema_editor):
    PaymentMethod = apps.get_model('crm', 'PaymentMethod')
    FinanceTransaction = apps.get_model('crm', 'FinanceTransaction')
    methods = {}
    for order, (name, code) in enumerate(DEFAULTS):
        method, _ = PaymentMethod.objects.get_or_create(name=name, defaults={'code': code, 'sort_order': order})
        methods[code] = method

    for operation in FinanceTransaction.objects.exclude(legacy_payment_method='').iterator():
        raw = (operation.legacy_payment_method or '').strip()
        normalized = raw.casefold()
        name, code = ALIASES.get(normalized, (raw, ''))
        method = methods.get(code)
        if not method:
            method, _ = PaymentMethod.objects.get_or_create(name=name, defaults={'code': code})
            if code:
                methods[code] = method
        operation.payment_method_id = method.id
        operation.payment_method_name = method.name
        operation.save(update_fields=('payment_method', 'payment_method_name'))


class Migration(migrations.Migration):
    dependencies = [('crm', '0020_alter_catalogitem_category_subscriptionaddon')]

    operations = [
        migrations.RenameField(model_name='financetransaction', old_name='payment_method', new_name='legacy_payment_method'),
        migrations.CreateModel(
            name='PaymentMethod',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('name', models.CharField(max_length=150, unique=True)),
                ('code', models.SlugField(blank=True, max_length=80)),
                ('description', models.TextField(blank=True)),
                ('is_active', models.BooleanField(default=True)),
                ('sort_order', models.PositiveIntegerField(blank=True, default=0)),
            ],
            options={'ordering': ('sort_order', 'name')},
        ),
        migrations.AddField(
            model_name='financetransaction', name='payment_method_name',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='financetransaction', name='payment_method',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='finance_transactions', to='crm.paymentmethod'),
        ),
        migrations.RunPython(migrate_payment_methods, migrations.RunPython.noop),
        migrations.RemoveField(model_name='financetransaction', name='legacy_payment_method'),
    ]
