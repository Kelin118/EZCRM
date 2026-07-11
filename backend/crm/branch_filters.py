from rest_framework.exceptions import ValidationError


ALL_BRANCHES = 'all'
UNASSIGNED_BRANCH = 'unassigned'
PSEUDO_BRANCH_NAMES = {'все филиалы', 'все', 'all branches', 'без филиала', 'не распределено'}


def apply_branch_filter(queryset, branch_value, field_name='branch'):
    """Apply the shared all / real branch / unassigned filtering contract."""
    if branch_value is None:
        return queryset

    value = str(branch_value).strip()
    if not value or value == ALL_BRANCHES:
        return queryset
    if value == UNASSIGNED_BRANCH:
        return queryset.filter(**{f'{field_name}__isnull': True})
    try:
        branch_id = int(value)
    except (TypeError, ValueError):
        raise ValidationError({'branch': 'Некорректный филиал.'})
    if branch_id <= 0:
        raise ValidationError({'branch': 'Некорректный филиал.'})
    return queryset.filter(**{f'{field_name}_id': branch_id})
