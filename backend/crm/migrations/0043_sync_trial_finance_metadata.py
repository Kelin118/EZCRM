from django.db import migrations


def sync_trial_finance_metadata(apps, schema_editor):
    Trial = apps.get_model('crm', 'Trial')
    FinanceTransaction = apps.get_model('crm', 'FinanceTransaction')
    alias = schema_editor.connection.alias

    linked_finance_ids = set(
        Trial.objects.using(alias)
        .filter(finance_transaction__isnull=False, branch__isnull=False)
        .values_list('finance_transaction_id', flat=True)
    )
    if not linked_finance_ids:
        return

    ambiguous_ids = set()
    one_to_one_relations = (
        'subscription_payment',
        'addon_sale',
        'master_class_payment',
        'master_class_payment_entry',
        'certificate_batch',
        'payroll_statement',
    )
    for relation in one_to_one_relations:
        ambiguous_ids.update(
            FinanceTransaction.objects.using(alias)
            .filter(pk__in=linked_finance_ids, **{f'{relation}__isnull': False})
            .values_list('pk', flat=True)
        )
    ambiguous_ids.update(
        FinanceTransaction.objects.using(alias)
        .filter(pk__in=linked_finance_ids, certificates__isnull=False)
        .values_list('pk', flat=True)
    )

    updates = []
    trials = (
        Trial.objects.using(alias)
        .select_related('finance_transaction')
        .filter(finance_transaction_id__in=linked_finance_ids - ambiguous_ids, branch__isnull=False)
        .iterator(chunk_size=1000)
    )
    for trial in trials:
        finance = trial.finance_transaction
        if finance.source != 'trial':
            continue
        if finance.branch_id == trial.branch_id and finance.manager_id == trial.manager_id:
            continue
        finance.branch_id = trial.branch_id
        finance.manager_id = trial.manager_id
        updates.append(finance)

    if updates:
        FinanceTransaction.objects.using(alias).bulk_update(updates, ['branch', 'manager'], batch_size=1000)


class Migration(migrations.Migration):
    dependencies = [
        ('crm', '0042_addonsaleitem_owner_name_catalogitem_owner_name'),
    ]

    operations = [
        migrations.RunPython(sync_trial_finance_metadata, migrations.RunPython.noop),
    ]
