from collections import Counter

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from crm.models import (
    AuditLog, Branch, Client, FinanceTransaction, Lesson, MasterClass, Room,
    ScheduleSlot, StudyGroup, Subscription, Task, Trial, Visit,
)
from crm.branch_filters import PSEUDO_BRANCH_NAMES


class Command(BaseCommand):
    help = 'Audit pseudo branches and safely backfill unassigned branch relations.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Apply safe changes. Default is dry-run.')

    def handle(self, *args, **options):
        apply_changes = options['apply']
        self.stdout.write(self.style.WARNING('APPLY mode' if apply_changes else 'DRY-RUN: изменения не выполняются'))

        real = [branch for branch in Branch.objects.order_by('id') if self._normalized(branch.name) not in PSEUDO_BRANCH_NAMES]
        fake = [branch for branch in Branch.objects.order_by('id') if self._normalized(branch.name) in PSEUDO_BRANCH_NAMES]
        self.stdout.write(f'Реальные филиалы ({len(real)}): {self._branch_list(real)}')
        self.stdout.write(f'Фиктивные филиалы ({len(fake)}): {self._branch_list(fake)}')

        with transaction.atomic():
            for branch in fake:
                links = self._fake_links(branch)
                self.stdout.write(f'Фиктивный филиал #{branch.id} «{branch.name}»: ' + ', '.join(f'{name}={count}' for name, count in links.items()))
                if apply_changes:
                    self._detach_fake_branch(branch)
                    branch.delete()

            totals = Counter()
            for model, resolver in self._backfill_rules():
                stats = Counter()
                for instance in model.objects.filter(branch__isnull=True).iterator():
                    stats['checked'] += 1
                    branch_id, reason, conflict = resolver(instance)
                    if conflict:
                        stats['conflicts'] += 1
                    elif branch_id:
                        stats['assignable'] += 1
                        self.stdout.write(f'  {model.__name__} #{instance.pk}: NULL -> {branch_id} ({reason})')
                        if apply_changes:
                            model.objects.filter(pk=instance.pk, branch__isnull=True).update(branch_id=branch_id)
                            AuditLog.objects.create(
                                action=AuditLog.Action.UPDATE,
                                entity_type=model.__name__,
                                entity_id=str(instance.pk),
                                entity_name=str(instance),
                                description='Автоматически назначен филиал командой audit_branches',
                                changes={'old_branch': None, 'new_branch': branch_id, 'reason': reason},
                            )
                    else:
                        stats['unassigned'] += 1
                totals.update(stats)
                self.stdout.write(
                    f'{model.__name__}: проверено={stats["checked"]}, распределяемо={stats["assignable"]}, '
                    f'конфликты={stats["conflicts"]}, останется без филиала={stats["unassigned"]}'
                )

            users_without_branch = get_user_model().objects.filter(branch__isnull=True).count()
            rooms_without_branch = Room.objects.filter(branch__isnull=True).count()
            self.stdout.write(f'User: без филиала={users_without_branch} (автоматически не распределяются)')
            self.stdout.write(f'Room: без филиала={rooms_without_branch} (автоматически не распределяются)')
            self.stdout.write(
                f'ИТОГО: проверено={totals["checked"]}, распределяемо={totals["assignable"]}, '
                f'конфликты={totals["conflicts"]}, останется без филиала={totals["unassigned"]}'
            )
            if not apply_changes:
                transaction.set_rollback(True)

        self.stdout.write(self.style.SUCCESS('Изменения применены.' if apply_changes else 'Dry-run завершён. Для применения используйте --apply.'))

    @staticmethod
    def _normalized(value):
        return (value or '').strip().casefold()

    @staticmethod
    def _branch_list(branches):
        return ', '.join(f'#{item.id} «{item.name}»' for item in branches) or 'нет'

    @staticmethod
    def _unique_branch(values):
        ids = {value for value in values if value}
        if len(ids) == 1:
            return next(iter(ids)), False
        return None, len(ids) > 1

    def _backfill_rules(self):
        def client(instance):
            branch_id, conflict = self._unique_branch(
                instance.group_memberships.filter(status='active').values_list('group__branch_id', flat=True)
            )
            return branch_id, 'единственный филиал активных групп клиента', conflict

        def group(instance):
            return (instance.room.branch_id if instance.room_id else None), 'филиал кабинета', False

        def slot(instance):
            branch_id = instance.group.branch_id or (instance.room.branch_id if instance.room_id else None)
            return branch_id, 'филиал группы/кабинета', False

        def lesson(instance):
            branch_id = (
                instance.schedule_slot.branch_id if instance.schedule_slot_id else None
            ) or (instance.group.branch_id if instance.group_id else None) or (instance.room.branch_id if instance.room_id else None)
            return branch_id, 'филиал расписания/группы/кабинета', False

        def visit(instance):
            branch_id = instance.lesson.branch_id if instance.lesson_id else None
            if not branch_id and instance.lesson_id and instance.lesson.group_id:
                branch_id = instance.lesson.group.branch_id
            return branch_id, 'филиал урока/группы', False

        def subscription(instance):
            if instance.client.branch_id:
                return instance.client.branch_id, 'филиал клиента', False
            branch_id, conflict = self._unique_branch(
                instance.client.group_memberships.filter(status='active').values_list('group__branch_id', flat=True)
            )
            return branch_id, 'единственный филиал активных групп клиента', conflict

        def related_client(instance):
            return (instance.client.branch_id if instance.client_id else None), 'филиал клиента', False

        def finance(instance):
            branch_id = (instance.subscription.branch_id if instance.subscription_id else None) or (instance.client.branch_id if instance.client_id else None)
            return branch_id, 'филиал абонемента/клиента', False

        def master_class(instance):
            branch_id, conflict = self._unique_branch(instance.participants.values_list('branch_id', flat=True))
            return branch_id, 'единственный филиал участников', conflict

        return (
            (StudyGroup, group), (Client, client), (ScheduleSlot, slot), (Lesson, lesson),
            (Visit, visit), (Subscription, subscription), (Trial, related_client),
            (FinanceTransaction, finance), (Task, related_client), (MasterClass, master_class),
        )

    @staticmethod
    def _fake_links(branch):
        models = (Client, Subscription, Room, StudyGroup, ScheduleSlot, Lesson, Visit, Trial, MasterClass, Task, FinanceTransaction)
        counts = {model.__name__: model.objects.filter(branch=branch).count() for model in models}
        counts['User'] = get_user_model().objects.filter(branch=branch).count()
        return counts

    @staticmethod
    def _detach_fake_branch(branch):
        models = (Client, Subscription, Room, StudyGroup, ScheduleSlot, Lesson, Visit, Trial, MasterClass, Task, FinanceTransaction)
        for model in models:
            model.objects.filter(branch=branch).update(branch=None)
        get_user_model().objects.filter(branch=branch).update(branch=None)
