from decimal import Decimal, ROUND_HALF_UP

from django.utils import timezone

from .employee_worklog import build_employee_worklog
from .models import EmployeePayrollProfile, PayrollStatement


MONEY = Decimal('0.01')


def money(value):
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def calculate_payroll(employee, date_from, date_to, branch=None, manual_adjustment=0, manual_adjustment_comment=''):
    profile, _ = EmployeePayrollProfile.objects.get_or_create(employee=employee)
    worklog = build_employee_worklog(date_from=date_from, date_to=date_to, employee=employee.id, branch=branch or 'all')
    regular_minutes = worklog['summary']['regular_minutes']
    outside_minutes = worklog['summary']['outside_minutes']
    outside_mc_count = sum(
        1
        for item in worklog['entries']
        if item['source'] == 'master_class' and item['outside_regular_master_class_hours'] and not item['warning']
    )

    regular_rate = money(profile.regular_hourly_rate)
    outside_rate = money(profile.outside_hourly_rate)
    monthly_salary = money(profile.monthly_salary)
    bonus_rate = money(profile.outside_master_class_bonus)
    adjustment = money(manual_adjustment)

    if profile.pay_type == EmployeePayrollProfile.PayType.MONTHLY:
        base_amount = monthly_salary
        regular_amount = Decimal('0.00')
    else:
        base_amount = Decimal('0.00')
        regular_amount = money(Decimal(regular_minutes) / Decimal(60) * regular_rate)
    outside_amount = money(Decimal(outside_minutes) / Decimal(60) * outside_rate)
    bonus_amount = money(Decimal(outside_mc_count) * bonus_rate)
    total = money(base_amount + regular_amount + outside_amount + bonus_amount + adjustment)

    return {
        'pay_type_snapshot': profile.pay_type,
        'monthly_salary_snapshot': profile.monthly_salary,
        'regular_hourly_rate_snapshot': profile.regular_hourly_rate,
        'outside_hourly_rate_snapshot': profile.outside_hourly_rate,
        'outside_master_class_bonus_snapshot': profile.outside_master_class_bonus,
        'regular_minutes': regular_minutes,
        'outside_minutes': outside_minutes,
        'outside_master_class_count': outside_mc_count,
        'base_amount': base_amount,
        'regular_amount': regular_amount,
        'outside_amount': outside_amount,
        'master_class_bonus_amount': bonus_amount,
        'manual_adjustment': adjustment,
        'manual_adjustment_comment': manual_adjustment_comment,
        'total_amount': total,
    }


def apply_payroll_calculation(statement):
    values = calculate_payroll(
        statement.employee,
        statement.date_from,
        statement.date_to,
        branch=statement.branch_id or 'all',
        manual_adjustment=statement.manual_adjustment,
        manual_adjustment_comment=statement.manual_adjustment_comment,
    )
    for key, value in values.items():
        setattr(statement, key, value)
    return statement


def generate_payroll_statements(*, employees, date_from, date_to, branch=None, created_by=None):
    statements = []
    for employee in employees:
        statement, created = PayrollStatement.objects.get_or_create(
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
