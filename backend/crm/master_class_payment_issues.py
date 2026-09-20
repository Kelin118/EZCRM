from decimal import Decimal, ROUND_HALF_UP
from types import SimpleNamespace


MONEY = Decimal('0.01')
FINAL_PAYMENT_STAGES = {'paid', 'bought', 'completed'}
FINAL_STAGE_LABELS = {'paid': 'Оплатил', 'bought': 'Купил абонемент', 'completed': 'Завершён'}


def _money(value):
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def _format_money(value):
    amount = _money(value)
    rendered = f'{amount:,.2f}'.replace(',', ' ')
    if rendered.endswith('.00'):
        rendered = rendered[:-3]
    return f'{rendered} ₸'


def _transaction_issues(payment, transaction):
    issues = []
    payment_amount = _money(payment.amount)
    transaction_amount = _money(transaction.amount)
    if payment_amount != transaction_amount:
        difference = abs(payment_amount - transaction_amount)
        issues.append({
            'code': 'finance_transaction_mismatch',
            'severity': 'critical',
            'amount': str(difference),
            'message': f'Оплата МК и финансовая операция отличаются на {_format_money(difference)}.',
        })
    parts = list(transaction.payment_parts.all())
    if parts:
        parts_total = _money(sum((part.amount for part in parts), Decimal('0.00')))
        if parts_total != transaction_amount:
            difference = abs(parts_total - transaction_amount)
            issues.append({
                'code': 'payment_parts_mismatch',
                'severity': 'critical',
                'amount': str(difference),
                'message': f'Разбивка способов оплаты отличается от платежа на {_format_money(difference)}.',
            })
    return issues


def master_class_payment_diagnostics(master_class):
    amount_due = _money(master_class.amount_due)
    paid_total = _money(master_class.paid_total)
    difference = _money(paid_total - amount_due)
    issues = []
    mismatch_type = ''
    mismatch_amount = Decimal('0.00')
    final_stage = master_class.stage in FINAL_PAYMENT_STAGES

    if paid_total > amount_due:
        mismatch_type = 'overpaid'
        mismatch_amount = paid_total - amount_due
        message = (
            'Оплата внесена при нулевой сумме к оплате.'
            if amount_due == 0
            else f'Переплата: {_format_money(mismatch_amount)}'
        )
        issues.append({'code': 'overpaid', 'severity': 'critical', 'amount': str(_money(mismatch_amount)), 'message': message})
    elif 0 < paid_total < amount_due:
        mismatch_type = 'underpaid'
        mismatch_amount = amount_due - paid_total
        message = (
            f'Этап «{FINAL_STAGE_LABELS[master_class.stage]}», но не хватает {_format_money(mismatch_amount)}.'
            if final_stage
            else f'Недоплата: {_format_money(mismatch_amount)}'
        )
        issues.append({
            'code': 'underpaid',
            'severity': 'critical' if final_stage else 'warning',
            'amount': str(_money(mismatch_amount)),
            'message': message,
        })
    elif paid_total == 0 and amount_due > 0 and final_stage:
        issues.append({
            'code': 'stage_unpaid',
            'severity': 'critical',
            'amount': str(amount_due),
            'message': f'Этап «{FINAL_STAGE_LABELS[master_class.stage]}», но оплаты нет.',
        })

    payments = list(master_class.payments.all())
    if payments:
        for payment in payments:
            issues.extend(_transaction_issues(payment, payment.finance_transaction))
    elif master_class.finance_transaction_id:
        issues.extend(_transaction_issues(SimpleNamespace(amount=master_class.payment_amount), master_class.finance_transaction))

    attention = 'critical' if any(item['severity'] == 'critical' for item in issues) else ('warning' if issues else 'none')
    return {
        'payment_difference': str(difference),
        'has_payment_mismatch': bool(issues),
        'payment_mismatch_type': mismatch_type,
        'payment_mismatch_amount': str(_money(mismatch_amount)),
        'payment_mismatch_message': issues[0]['message'] if issues else '',
        'payment_attention_level': attention,
        'has_internal_payment_mismatch': any(item['code'] in {'finance_transaction_mismatch', 'payment_parts_mismatch'} for item in issues),
        'payment_issues': issues,
    }
