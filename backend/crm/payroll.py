from datetime import datetime, time
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from .employee_worklog import build_employee_worklog
from .models import (
    EmployeePayrollAdvance,
    EmployeePayrollProfile,
    EmployeePayrollRule,
    FinanceTransaction,
    PayrollAdvanceAllocation,
    PayrollStatement,
)


MONEY = Decimal('0.01')
SALES_SOURCE_LABELS = {
    'subscription': 'Абонементы',
    'trial': 'Пробники',
    'master_class': 'Мастер-классы',
    'addon': 'Дополнительные услуги',
    'product': 'Товары',
    'retail': 'Товары и услуги',
    'camp': 'Лагерь',
    'certificate': 'Сертификаты',
}


def money(value):
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def _local_period_bounds(date_from, date_to):
    return (
        timezone.make_aware(datetime.combine(date_from, time.min)),
        timezone.make_aware(datetime.combine(date_to, time.max)),
    )


def _rule_rate(rule):
    return money(rule.percent if rule.rule_type == EmployeePayrollRule.RuleType.SALES_PERCENT else rule.amount)


def _rule_snapshot(rule, *, rate=None, amount='0.00', extra=None):
    data = {
        'id': rule.id,
        'rule_type': rule.rule_type,
        'rule_type_display': rule.get_rule_type_display(),
        'amount': str(money(rule.amount)) if rule.amount is not None else None,
        'percent': str(rule.percent) if rule.percent is not None else None,
        'rate': str(rate if rate is not None else _rule_rate(rule)),
        'valid_from': str(rule.valid_from),
        'valid_until': str(rule.valid_until) if rule.valid_until else None,
        'calculated_amount': str(money(amount)),
    }
    if rule.rule_type == EmployeePayrollRule.RuleType.SALES_PERCENT:
        data.update({
            'sales_sources': list(rule.sales_sources or []),
            'sales_attribution': rule.sales_attribution,
            'sales_attribution_display': rule.get_sales_attribution_display(),
        })
    if extra:
        data.update(extra)
    return data


def _fallback_rules(profile):
    rules = []
    today = timezone.localdate()

    def make(rule_type, *, amount=None, percent=None, sales_sources=None, sales_attribution=None):
        rule = EmployeePayrollRule(
            profile=profile,
            rule_type=rule_type,
            amount=amount,
            percent=percent,
            sales_sources=sales_sources or [],
            sales_attribution=sales_attribution or EmployeePayrollRule.SalesAttribution.RESPONSIBLE_MANAGER,
            valid_from=today,
            is_active=True,
        )
        rule.id = None
        return rule

    if profile.pay_type == EmployeePayrollProfile.PayType.MONTHLY and profile.monthly_salary:
        rules.append(make(EmployeePayrollRule.RuleType.MONTHLY_SALARY, amount=profile.monthly_salary))
    if profile.pay_type == EmployeePayrollProfile.PayType.HOURLY and profile.regular_hourly_rate:
        rules.append(make(EmployeePayrollRule.RuleType.REGULAR_HOURLY, amount=profile.regular_hourly_rate))
    if profile.outside_hourly_rate:
        rules.append(make(EmployeePayrollRule.RuleType.OUTSIDE_HOURLY, amount=profile.outside_hourly_rate))
    if profile.outside_master_class_bonus:
        rules.append(make(EmployeePayrollRule.RuleType.OUTSIDE_MASTER_CLASS_BONUS, amount=profile.outside_master_class_bonus))
    return rules


def applicable_rules(profile, date_from, date_to):
    rules = list(
        profile.rules.filter(is_active=True, valid_from__lte=date_to)
        .filter(Q(valid_until__isnull=True) | Q(valid_until__gte=date_from))
        .order_by('rule_type', 'valid_from', 'id')
    )
    return rules or _fallback_rules(profile)


def _sales_queryset(employee, date_from, date_to, branch, rule):
    sources = [source for source in (rule.sales_sources or []) if source in EmployeePayrollRule.SALES_SOURCES]
    if not sources:
        return FinanceTransaction.objects.none()
    period_from = max(date_from, rule.valid_from)
    period_to = min(date_to, rule.valid_until) if rule.valid_until else date_to
    if period_to < period_from:
        return FinanceTransaction.objects.none()
    start_dt, end_dt = _local_period_bounds(period_from, period_to)
    queryset = FinanceTransaction.objects.filter(
        transaction_type=FinanceTransaction.Type.INCOME,
        source__in=sources,
        paid_at__gte=start_dt,
        paid_at__lte=end_dt,
    )
    if branch not in (None, '', 'all'):
        queryset = queryset.filter(branch_id=branch)
    if rule.sales_attribution == EmployeePayrollRule.SalesAttribution.CREATED_BY:
        queryset = queryset.filter(created_by=employee)
    else:
        queryset = queryset.filter(manager=employee)
    return queryset


def _calculate_sales_component(employee, date_from, date_to, branch, rule):
    queryset = _sales_queryset(employee, date_from, date_to, branch, rule)
    by_source = []
    sales_basis = Decimal('0.00')
    percent = Decimal(rule.percent or 0)
    for item in queryset.values('source').order_by('source').annotate(total=Sum('amount')):
        source_total = money(item['total'])
        source_commission = money(source_total * percent / Decimal('100'))
        sales_basis += source_total
        by_source.append({
            'source': item['source'],
            'source_display': SALES_SOURCE_LABELS.get(item['source'], item['source']),
            'sales_basis_amount': str(source_total),
            'sales_commission_amount': str(source_commission),
        })
    transaction_amounts = {
        item['id']: money(item['amount'])
        for item in queryset.values('id', 'amount').distinct()
    }
    transaction_count = len(transaction_amounts)
    commission = money(sales_basis * percent / Decimal('100'))
    return sales_basis, commission, transaction_count, by_source, transaction_amounts


def _advance_queryset(statement):
    queryset = EmployeePayrollAdvance.objects.select_for_update().filter(
        employee=statement.employee,
        cancelled=False,
        advance_date__lte=statement.date_to,
    )
    if statement.branch_id:
        queryset = queryset.filter(Q(branch=statement.branch) | Q(branch__isnull=True))
    return queryset.order_by('advance_date', 'created_at', 'id')


def rebuild_advance_allocations(statement, gross_amount):
    if statement.status != PayrollStatement.Status.DRAFT:
        return money(statement.advance_amount)
    statement.advance_allocations.all().delete()
    remaining_need = max(money(gross_amount), Decimal('0.00'))
    applied = Decimal('0.00')
    if remaining_need <= 0:
        return applied
    for advance in _advance_queryset(statement):
        allocated_elsewhere = money(
            advance.allocations.exclude(statement=statement)
            .filter(statement__status__in=(PayrollStatement.Status.APPROVED, PayrollStatement.Status.PAID))
            .aggregate(total=Sum('amount'))['total']
        )
        available = max(money(advance.amount) - allocated_elsewhere, Decimal('0.00'))
        if available <= 0:
            continue
        amount = min(available, remaining_need)
        PayrollAdvanceAllocation.objects.create(statement=statement, advance=advance, amount=amount)
        applied += amount
        remaining_need -= amount
        if remaining_need <= 0:
            break
    return money(applied)


def calculate_payroll(employee, date_from, date_to, branch=None, manual_adjustment=0, manual_adjustment_comment='', statement=None):
    profile, _ = EmployeePayrollProfile.objects.get_or_create(employee=employee)
    worklog = build_employee_worklog(date_from=date_from, date_to=date_to, employee=employee.id, branch=branch or 'all')
    regular_minutes = worklog['summary']['regular_minutes']
    outside_minutes = worklog['summary']['outside_minutes']
    valid_worklog_entries = [
        item
        for item in worklog['entries']
        if not item['warning'] and item['duration_minutes'] > 0
    ]
    shift_count = len({item['date'] for item in valid_worklog_entries})
    lesson_count = len({
        item['source_id']
        for item in valid_worklog_entries
        if item['source'] == 'lesson' and item['source_id']
    })
    outside_mc_count = sum(
        1
        for item in worklog['entries']
        if item['source'] == 'master_class' and item['outside_regular_master_class_hours'] and not item['warning']
    )

    base_amount = Decimal('0.00')
    shift_amount = Decimal('0.00')
    lesson_amount = Decimal('0.00')
    regular_amount = Decimal('0.00')
    outside_amount = Decimal('0.00')
    bonus_amount = Decimal('0.00')
    sales_commission_amount = Decimal('0.00')
    eligible_sales_transactions = {}
    sales_breakdown = []
    snapshots = []
    components = []
    sales_rule_number = 0

    for rule in applicable_rules(profile, date_from, date_to):
        rate = _rule_rate(rule)
        amount = Decimal('0.00')
        extra = None
        if rule.rule_type == EmployeePayrollRule.RuleType.MONTHLY_SALARY:
            amount = rate
            base_amount += amount
        elif rule.rule_type == EmployeePayrollRule.RuleType.SHIFT_RATE:
            amount = money(Decimal(shift_count) * rate)
            shift_amount += amount
            extra = {'shift_count': shift_count}
        elif rule.rule_type == EmployeePayrollRule.RuleType.LESSON_RATE:
            amount = money(Decimal(lesson_count) * rate)
            lesson_amount += amount
            extra = {'lesson_count': lesson_count}
        elif rule.rule_type == EmployeePayrollRule.RuleType.REGULAR_HOURLY:
            amount = money(Decimal(regular_minutes) / Decimal(60) * rate)
            regular_amount += amount
            extra = {'minutes': regular_minutes}
        elif rule.rule_type == EmployeePayrollRule.RuleType.OUTSIDE_HOURLY:
            amount = money(Decimal(outside_minutes) / Decimal(60) * rate)
            outside_amount += amount
            extra = {'minutes': outside_minutes}
        elif rule.rule_type == EmployeePayrollRule.RuleType.OUTSIDE_MASTER_CLASS_BONUS:
            amount = money(Decimal(outside_mc_count) * rate)
            bonus_amount += amount
            extra = {'count': outside_mc_count}
        elif rule.rule_type == EmployeePayrollRule.RuleType.SALES_PERCENT:
            sales_rule_number += 1
            basis, amount, count, by_source, transaction_amounts = _calculate_sales_component(employee, date_from, date_to, branch, rule)
            sales_commission_amount += amount
            eligible_sales_transactions.update(transaction_amounts)
            sales_breakdown.extend(by_source)
            extra = {
                'rule_id': rule.id,
                'percent': str(rule.percent),
                'sales_sources': list(rule.sales_sources or []),
                'sales_attribution': rule.sales_attribution,
                'sales_basis_amount': str(basis),
                'sales_transactions_count': count,
                'sales_commission_amount': str(amount),
                'sales_breakdown': by_source,
            }
        else:
            continue
        amount = money(amount)
        snapshots.append(_rule_snapshot(rule, rate=rate, amount=amount, extra=extra))
        components.append({
            'type': rule.rule_type,
            'label': f'{rule.get_rule_type_display()} #{sales_rule_number}' if rule.rule_type == EmployeePayrollRule.RuleType.SALES_PERCENT else rule.get_rule_type_display(),
            'rate': str(rate),
            'amount': str(amount),
            **(extra or {}),
        })

    adjustment = money(manual_adjustment)
    sales_basis_amount = money(sum(eligible_sales_transactions.values(), Decimal('0.00')))
    sales_transactions_count = len(eligible_sales_transactions)
    gross = money(base_amount + shift_amount + lesson_amount + regular_amount + outside_amount + bonus_amount + sales_commission_amount + adjustment)
    advance_applied = Decimal('0.00')
    if statement is not None:
        advance_applied = rebuild_advance_allocations(statement, gross)
    amount_to_pay = money(max(gross - advance_applied, Decimal('0.00')))

    return {
        'pay_type_snapshot': profile.pay_type,
        'monthly_salary_snapshot': profile.monthly_salary,
        'regular_hourly_rate_snapshot': profile.regular_hourly_rate,
        'outside_hourly_rate_snapshot': profile.outside_hourly_rate,
        'outside_master_class_bonus_snapshot': profile.outside_master_class_bonus,
        'regular_minutes': regular_minutes,
        'outside_minutes': outside_minutes,
        'shift_count': shift_count,
        'lesson_count': lesson_count,
        'outside_master_class_count': outside_mc_count,
        'base_amount': money(base_amount),
        'shift_amount': money(shift_amount),
        'lesson_amount': money(lesson_amount),
        'regular_amount': money(regular_amount),
        'outside_amount': money(outside_amount),
        'master_class_bonus_amount': money(bonus_amount),
        'sales_basis_amount': money(sales_basis_amount),
        'sales_commission_amount': money(sales_commission_amount),
        'sales_transactions_count': sales_transactions_count,
        'manual_adjustment': adjustment,
        'manual_adjustment_comment': manual_adjustment_comment,
        'gross_amount': gross,
        'advance_amount': advance_applied,
        'amount_to_pay': amount_to_pay,
        'total_amount': amount_to_pay,
        'payroll_rules_snapshot': snapshots,
        'calculation_breakdown': {
            'components': components,
            'sales_by_source': sales_breakdown,
            'gross_amount': str(gross),
            'advance_amount': str(advance_applied),
            'amount_to_pay': str(amount_to_pay),
        },
    }


def apply_payroll_calculation(statement):
    values = calculate_payroll(
        statement.employee,
        statement.date_from,
        statement.date_to,
        branch=statement.branch_id or 'all',
        manual_adjustment=statement.manual_adjustment,
        manual_adjustment_comment=statement.manual_adjustment_comment,
        statement=statement,
    )
    for key, value in values.items():
        setattr(statement, key, value)
    return statement


def _overlapping_statement(employee, date_from, date_to, branch):
    return (
        PayrollStatement.objects.filter(employee=employee, date_from__lte=date_to, date_to__gte=date_from)
        .exclude(date_from=date_from, date_to=date_to)
        .first()
    )


def generate_payroll_statements(*, employees, date_from, date_to, branch=None, created_by=None):
    statements = []
    for employee in employees:
        overlap = _overlapping_statement(employee, date_from, date_to, branch)
        if overlap:
            raise ValueError(f'У сотрудника {employee} уже есть расчёт зарплаты за пересекающийся период {overlap.date_from}–{overlap.date_to}.')
        with transaction.atomic():
            statement, created = PayrollStatement.objects.select_for_update().get_or_create(
                employee=employee,
                date_from=date_from,
                date_to=date_to,
                defaults={'branch_id': None if branch in (None, 'all', 'unassigned') else branch, 'created_by': created_by},
            )
            if statement.status == PayrollStatement.Status.DRAFT:
                apply_payroll_calculation(statement)
                if created_by and not statement.created_by_id:
                    statement.created_by = created_by
                statement.save()
            statements.append(statement)
    return statements
