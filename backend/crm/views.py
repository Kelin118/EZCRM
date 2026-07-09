from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .audit import log_action
from .backup import create_database_backup
from .export_excel import (
    export_clients,
    export_finance,
    export_groups,
    export_lessons,
    export_master_classes,
    export_subscriptions,
    export_summary_report,
    export_trials,
    export_visits,
)
from .excel_import import import_excel
from .group_schedule import sync_group_schedule_slots
from .models import (
    AuditLog,
    Branch,
    CatalogItem,
    ChatMessage,
    Client,
    FinanceTransaction,
    GroupMembership,
    Lesson,
    MasterClass,
    Room,
    ScheduleSlot,
    StudioSettings,
    StudyGroup,
    Subject,
    Subscription,
    Task,
    Trial,
    Visit,
)
from .permissions import (
    ACCOUNTANT,
    MANAGER,
    TEACHER,
    AuditLogPermission,
    BranchPermission,
    CatalogItemPermission,
    ChatPermission,
    ClientPermission,
    DashboardPermission,
    ExcelImportPermission,
    EducationPermission,
    BackupPermission,
    FinancePermission,
    ExportPermission,
    MasterClassPermission,
    ReportsPermission,
    SettingsPermission,
    SubscriptionPermission,
    TaskPermission,
    TrialPermission,
    VisitPermission,
    has_any_role,
    has_role,
    is_admin,
    role,
)
from .serializers import (
    AuditLogSerializer,
    BranchSerializer,
    CatalogItemSerializer,
    ChatMessageSerializer,
    ClientSerializer,
    FinanceTransactionSerializer,
    GroupMembershipSerializer,
    LessonSerializer,
    MasterClassSerializer,
    RoomSerializer,
    ScheduleSlotSerializer,
    StudioSettingsSerializer,
    StudyGroupSerializer,
    SubjectSerializer,
    SubscriptionSerializer,
    TaskSerializer,
    TrialSerializer,
    VisitSerializer,
)
from .subscription_dates import calculate_subscription_end_date


def _filter_branch(queryset, request):
    branch = request.query_params.get('branch')
    return queryset.filter(branch_id=branch) if branch else queryset


def _date_param(request, name):
    value = request.query_params.get(name)
    return parse_date(value) if value else None


def _decimal(value):
    return value or 0


def _paid_at_from_date(value):
    if not value:
        return timezone.now()
    return timezone.make_aware(datetime.combine(value, time.min))


def _my_param(request):
    return request.query_params.get('my') in ('1', 'true', 'True', 'yes')


def _create_income_transaction(*, client, amount, source, paid_at, comment, created_by=None, subscription=None):
    return FinanceTransaction.objects.create(
        transaction_type=FinanceTransaction.Type.INCOME,
        amount=amount,
        source=source,
        client=client,
        subscription=subscription,
        created_by=created_by,
        paid_at=paid_at,
        comment=comment,
    )


def _lesson_visited_at(lesson):
    return timezone.make_aware(datetime.combine(lesson.lesson_date, lesson.start_time))


def _restore_subscription_lesson(subscription):
    if subscription and subscription.remaining_visits < subscription.total_visits:
        subscription.remaining_visits += 1
        subscription.save(update_fields=('remaining_visits', 'updated_at'))


def _deduct_subscription_lesson(visit):
    if (
        visit.status == Visit.Status.ATTENDED
        and visit.subscription_id
        and not visit.lesson_deducted
        and visit.subscription.remaining_visits > 0
    ):
        visit.subscription.remaining_visits -= 1
        visit.subscription.save(update_fields=('remaining_visits', 'updated_at'))
        visit.lesson_deducted = True
        visit.save(update_fields=('lesson_deducted', 'updated_at'))


def _active_subscription_queryset(client):
    today = timezone.localdate()
    return (
        Subscription.objects.filter(
            client=client,
            status=Subscription.Status.ACTIVE,
            remaining_visits__gt=0,
        )
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=today))
    )


def _client_active_subscription(client):
    return _active_subscription_queryset(client).order_by('-start_date', '-created_at').first()


def create_lessons_for_slot(slot, date_from, date_to):
    created_count = 0
    current = date_from
    while current <= date_to:
        if current.weekday() == slot.weekday:
            lesson = Lesson.objects.filter(
                group=slot.group,
                lesson_date=current,
                start_time=slot.start_time,
            ).first()
            if not lesson:
                Lesson.objects.create(
                    schedule_slot=slot,
                    lesson_date=current,
                    start_time=slot.start_time,
                    group=slot.group,
                    subject=slot.subject or slot.group.subject,
                    teacher=slot.teacher or slot.group.teacher,
                    room=slot.room,
                    end_time=slot.end_time,
                )
                created_count += 1
            elif not lesson.schedule_slot_id:
                lesson.schedule_slot = slot
                lesson.save(update_fields=('schedule_slot', 'updated_at'))
        current += timedelta(days=1)
    return created_count


def ensure_lesson_for_slot(slot, lesson_date):
    lesson = Lesson.objects.filter(
        schedule_slot=slot,
        lesson_date=lesson_date,
        start_time=slot.start_time,
    ).first()
    if not lesson:
        lesson = Lesson.objects.filter(
            group=slot.group,
            lesson_date=lesson_date,
            start_time=slot.start_time,
        ).first()
    if lesson:
        if not lesson.schedule_slot_id:
            lesson.schedule_slot = slot
            lesson.save(update_fields=('schedule_slot', 'updated_at'))
        return lesson, False
    lesson = Lesson.objects.create(
        schedule_slot=slot,
        lesson_date=lesson_date,
        start_time=slot.start_time,
        group=slot.group,
        subject=slot.subject or slot.group.subject,
        teacher=slot.teacher or slot.group.teacher,
        room=slot.room,
        end_time=slot.end_time,
    )
    return lesson, True


class BaseAuthenticatedViewSet(viewsets.ModelViewSet):
    permission_classes = (IsAuthenticated,)

    audit_entity_type = None
    audit_create_description = ''
    audit_update_description = ''
    audit_delete_description = ''

    def _audit_entity_type(self):
        return self.audit_entity_type or self.get_queryset().model.__name__

    def _audit_changes(self):
        return {
            key: value
            for key, value in self.request.data.items()
            if key not in {'password', 'password_confirm'} and 'password' not in key.lower()
        }

    def _log_instance(self, action, instance, description='', changes=None):
        log_action(
            self.request,
            action,
            self._audit_entity_type(),
            entity_id=getattr(instance, 'pk', None),
            entity_name=str(instance),
            description=description,
            changes=changes,
        )

    def perform_create(self, serializer):
        instance = serializer.save()
        if self.audit_create_description:
            self._log_instance(AuditLog.Action.CREATE, instance, self.audit_create_description, self._audit_changes())

    def perform_update(self, serializer):
        instance = serializer.save()
        if self.audit_update_description:
            self._log_instance(AuditLog.Action.UPDATE, instance, self.audit_update_description, self._audit_changes())

    def perform_destroy(self, instance):
        entity_id = instance.pk
        entity_name = str(instance)
        super().perform_destroy(instance)
        if self.audit_delete_description:
            log_action(
                self.request,
                AuditLog.Action.DELETE,
                self._audit_entity_type(),
                entity_id=entity_id,
                entity_name=entity_name,
                description=self.audit_delete_description,
            )

    def permission_denied(self, request, message=None, code=None):
        if getattr(self, 'action', None) == 'destroy':
            log_action(
                request,
                AuditLog.Action.DELETE,
                self._audit_entity_type(),
                entity_id=self.kwargs.get(self.lookup_url_kwarg or self.lookup_field),
                description='Попытка удаления',
            )
        return super().permission_denied(request, message=message, code=code)


class CurrentUserView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        user = request.user
        return Response(
            {
                'id': user.id,
                'username': user.username,
                'full_name': user.get_full_name() or user.username,
                'role': 'admin' if user.is_superuser else role(user),
                'roles': user.get_roles() if hasattr(user, 'get_roles') else [role(user)],
                'is_superuser': user.is_superuser,
            }
        )


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = (IsAuthenticated, AuditLogPermission)
    serializer_class = AuditLogSerializer
    queryset = AuditLog.objects.select_related('user').all()

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.query_params.get('user')
        action_value = self.request.query_params.get('action')
        entity_type = self.request.query_params.get('entity_type')
        date_from = _date_param(self.request, 'date_from')
        date_to = _date_param(self.request, 'date_to')
        search = self.request.query_params.get('search')

        if user:
            queryset = queryset.filter(user_id=user)
        if action_value:
            queryset = queryset.filter(action=action_value)
        if entity_type:
            queryset = queryset.filter(entity_type=entity_type)
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)
        if search:
            queryset = queryset.filter(
                Q(entity_name__icontains=search)
                | Q(description__icontains=search)
                | Q(action__icontains=search)
                | Q(entity_type__icontains=search)
                | Q(user__username__icontains=search)
                | Q(user__first_name__icontains=search)
                | Q(user__last_name__icontains=search)
            )
        return queryset


class EducationBaseViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, EducationPermission)


class BranchViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, BranchPermission)
    queryset = Branch.objects.all()
    serializer_class = BranchSerializer
    audit_entity_type = 'Branch'

    def get_queryset(self):
        queryset = super().get_queryset()
        search = self.request.query_params.get('search')
        is_active = self.request.query_params.get('is_active')
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(address__icontains=search) | Q(phone__icontains=search))
        if is_active in ('1', 'true', 'True', 'yes'):
            queryset = queryset.filter(is_active=True)
        elif is_active in ('0', 'false', 'False', 'no'):
            queryset = queryset.filter(is_active=False)
        return queryset.order_by('name')

    def perform_create(self, serializer):
        branch = serializer.save()
        self._log_instance(AuditLog.Action.BRANCH_CREATE, branch, 'Создан филиал', self._audit_changes())

    def perform_update(self, serializer):
        branch = serializer.save()
        self._log_instance(AuditLog.Action.BRANCH_UPDATE, branch, 'Изменён филиал', self._audit_changes())

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=('is_active', 'updated_at'))
        self._log_instance(AuditLog.Action.BRANCH_DISABLE, instance, 'Филиал отключён', {'is_active': False})


class SubjectViewSet(EducationBaseViewSet):
    queryset = Subject.objects.all()
    serializer_class = SubjectSerializer
    audit_entity_type = 'Subject'
    audit_create_description = 'Создан предмет'
    audit_update_description = 'Изменён предмет'
    audit_delete_description = 'Удалён предмет'

    def get_queryset(self):
        queryset = super().get_queryset()
        search = self.request.query_params.get('search')
        is_active = self.request.query_params.get('is_active')
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(description__icontains=search))
        if is_active in ('1', 'true', 'True', 'yes'):
            queryset = queryset.filter(is_active=True)
        elif is_active in ('0', 'false', 'False', 'no'):
            queryset = queryset.filter(is_active=False)
        return queryset.order_by('name')


class RoomViewSet(EducationBaseViewSet):
    queryset = Room.objects.all()
    serializer_class = RoomSerializer
    audit_entity_type = 'Room'
    audit_create_description = 'Создан кабинет'
    audit_update_description = 'Изменён кабинет'
    audit_delete_description = 'Удалён кабинет'

    def get_queryset(self):
        queryset = super().get_queryset()
        search = self.request.query_params.get('search')
        is_active = self.request.query_params.get('is_active')
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(description__icontains=search))
        if is_active in ('1', 'true', 'True', 'yes'):
            queryset = queryset.filter(is_active=True)
        elif is_active in ('0', 'false', 'False', 'no'):
            queryset = queryset.filter(is_active=False)
        return queryset.order_by('name')


class StudyGroupViewSet(EducationBaseViewSet):
    queryset = StudyGroup.objects.select_related('subject', 'room', 'teacher', 'manager').prefetch_related('memberships__client').all()
    serializer_class = StudyGroupSerializer
    audit_entity_type = 'StudyGroup'
    audit_create_description = 'Создана группа'
    audit_update_description = 'Изменена группа'
    audit_delete_description = 'Удалена группа'

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        status_value = self.request.query_params.get('status')
        teacher = self.request.query_params.get('teacher')
        manager = self.request.query_params.get('manager')
        subject = self.request.query_params.get('subject')
        search = self.request.query_params.get('search')

        if has_role(self.request.user, TEACHER) and not has_any_role(self.request.user, {MANAGER, ACCOUNTANT}):
            queryset = queryset.filter(teacher=self.request.user)
        if status_value:
            queryset = queryset.filter(status=status_value)
        if teacher:
            queryset = queryset.filter(teacher_id=teacher)
        if manager:
            queryset = queryset.filter(manager_id=manager)
        if subject:
            queryset = queryset.filter(subject_id=subject)
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search)
                | Q(description__icontains=search)
                | Q(subject__name__icontains=search)
                | Q(teacher__username__icontains=search)
            )
        return queryset.order_by('name')

    def perform_create(self, serializer):
        group = serializer.save()
        sync_group_schedule_slots(group)
        self._log_instance(AuditLog.Action.CREATE, group, self.audit_create_description, self._audit_changes())

    def perform_update(self, serializer):
        instance = serializer.instance
        old_schedule = {
            'schedule_days': list(instance.schedule_days or []),
            'start_time': instance.start_time,
            'end_time': instance.end_time,
        }
        group = serializer.save()
        sync_group_schedule_slots(group, old_schedule=old_schedule)
        self._log_instance(AuditLog.Action.UPDATE, group, self.audit_update_description, self._audit_changes())

    @action(detail=True, methods=['post'], url_path='generate-lessons')
    def generate_lessons(self, request, pk=None):
        group = self.get_object()
        sync_group_schedule_slots(group)
        date_from = parse_date(request.data.get('date_from') or '')
        date_to = parse_date(request.data.get('date_to') or '')
        if not date_from or not date_to or date_from > date_to:
            return Response({'detail': 'Укажите корректный период.'}, status=status.HTTP_400_BAD_REQUEST)

        created_count = 0
        for slot in group.schedule_slots.filter(is_active=True):
            created_count += create_lessons_for_slot(slot, date_from, date_to)

        log_action(
            request,
            AuditLog.Action.CREATE,
            'Lesson',
            entity_id=group.id,
            entity_name=str(group),
            description='Сгенерированы уроки из расписания группы',
            changes={'created': created_count, 'date_from': str(date_from), 'date_to': str(date_to)},
        )
        return Response({'created': created_count}, status=status.HTTP_201_CREATED)


class GroupMembershipViewSet(EducationBaseViewSet):
    queryset = GroupMembership.objects.select_related('group', 'client', 'group__teacher').all()
    serializer_class = GroupMembershipSerializer
    audit_entity_type = 'GroupMembership'
    audit_create_description = 'Ученик добавлен в группу'
    audit_update_description = 'Изменено участие ученика в группе'
    audit_delete_description = 'Ученик удалён из группы'

    def create(self, request, *args, **kwargs):
        group_id = request.data.get('group')
        client_id = request.data.get('client')
        requested_status = request.data.get('status') or GroupMembership.Status.ACTIVE
        if group_id and client_id and requested_status == GroupMembership.Status.ACTIVE:
            existing = GroupMembership.objects.filter(group_id=group_id, client_id=client_id).order_by('-created_at').first()
            if existing:
                if existing.status != GroupMembership.Status.ACTIVE:
                    existing.status = GroupMembership.Status.ACTIVE
                    existing.left_at = None
                    existing.note = request.data.get('note', existing.note)
                    existing.save(update_fields=('status', 'left_at', 'note', 'updated_at'))
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        return super().create(request, *args, **kwargs)

    def get_queryset(self):
        queryset = super().get_queryset()
        group = self.request.query_params.get('group')
        client = self.request.query_params.get('client')
        status_value = self.request.query_params.get('status')

        if has_role(self.request.user, TEACHER) and not has_any_role(self.request.user, {MANAGER, ACCOUNTANT}):
            queryset = queryset.filter(group__teacher=self.request.user)
        if group:
            queryset = queryset.filter(group_id=group)
        if client:
            queryset = queryset.filter(client_id=client)
        if status_value:
            queryset = queryset.filter(status=status_value)
        return queryset.order_by('group__name', 'client__first_name', 'client__last_name')


class ScheduleSlotViewSet(EducationBaseViewSet):
    queryset = ScheduleSlot.objects.select_related('group', 'subject', 'teacher', 'room').all()
    serializer_class = ScheduleSlotSerializer
    audit_entity_type = 'ScheduleSlot'
    audit_create_description = 'Создан слот расписания'
    audit_update_description = 'Изменён слот расписания'
    audit_delete_description = 'Удалён слот расписания'

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        group = self.request.query_params.get('group')
        teacher = self.request.query_params.get('teacher')
        weekday = self.request.query_params.get('weekday')
        room = self.request.query_params.get('room')
        is_active = self.request.query_params.get('is_active')

        if has_role(self.request.user, TEACHER) and not has_any_role(self.request.user, {MANAGER, ACCOUNTANT}):
            queryset = queryset.filter(teacher=self.request.user)
        if group:
            queryset = queryset.filter(group_id=group)
        if teacher:
            queryset = queryset.filter(teacher_id=teacher)
        if weekday not in (None, ''):
            queryset = queryset.filter(weekday=weekday)
        if room:
            queryset = queryset.filter(room_id=room)
        if is_active in ('1', 'true', 'True', 'yes'):
            queryset = queryset.filter(is_active=True)
        elif is_active in ('0', 'false', 'False', 'no'):
            queryset = queryset.filter(is_active=False)
        return queryset.order_by('weekday', 'start_time')

    @action(detail=True, methods=['post'], url_path='generate-lessons')
    def generate_lessons(self, request, pk=None):
        if not (has_role(request.user, MANAGER) or is_admin(request.user)):
            return Response({'detail': 'Недостаточно прав.'}, status=status.HTTP_403_FORBIDDEN)

        slot = self.get_object()
        date_from = parse_date(request.data.get('date_from') or '')
        date_to = parse_date(request.data.get('date_to') or '')
        if not date_from or not date_to or date_from > date_to:
            return Response({'detail': 'Укажите корректный период.'}, status=status.HTTP_400_BAD_REQUEST)

        created_count = create_lessons_for_slot(slot, date_from, date_to)

        log_action(
            request,
            AuditLog.Action.CREATE,
            'Lesson',
            entity_id=slot.id,
            entity_name=str(slot),
            description='Сгенерированы уроки из расписания',
            changes={'created': created_count, 'date_from': str(date_from), 'date_to': str(date_to)},
        )
        return Response({'created': created_count}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='ensure-lesson')
    def ensure_lesson(self, request, pk=None):
        slot = self.get_object()
        lesson_date = parse_date(request.data.get('date') or '')
        if not lesson_date:
            return Response({'detail': 'Укажите дату.'}, status=status.HTTP_400_BAD_REQUEST)
        if lesson_date.weekday() != slot.weekday:
            return Response({'detail': 'Дата не соответствует дню недели расписания.'}, status=status.HTTP_400_BAD_REQUEST)

        lesson, created = ensure_lesson_for_slot(slot, lesson_date)
        if created:
            log_action(
                request,
                AuditLog.Action.CREATE,
                'Lesson',
                entity_id=lesson.id,
                entity_name=str(lesson),
                description='Урок создан для табеля посещений',
                changes={'date': str(lesson_date), 'schedule_slot': slot.id},
            )
        return Response({'lesson': LessonSerializer(lesson).data, 'created': created})


class LessonViewSet(EducationBaseViewSet):
    queryset = Lesson.objects.select_related('group', 'schedule_slot', 'subject', 'teacher', 'room').prefetch_related('visits').all()
    serializer_class = LessonSerializer
    audit_entity_type = 'Lesson'
    audit_create_description = 'Создан урок'
    audit_update_description = 'Изменён урок'
    audit_delete_description = 'Удалён урок'

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        group = self.request.query_params.get('group')
        teacher = self.request.query_params.get('teacher')
        subject = self.request.query_params.get('subject')
        room = self.request.query_params.get('room')
        status_value = self.request.query_params.get('status')
        lesson_date = _date_param(self.request, 'lesson_date')
        date_from = _date_param(self.request, 'date_from')
        date_to = _date_param(self.request, 'date_to')
        search = self.request.query_params.get('search')

        if has_role(self.request.user, TEACHER) and not has_any_role(self.request.user, {MANAGER, ACCOUNTANT}):
            queryset = queryset.filter(teacher=self.request.user)
        if group:
            queryset = queryset.filter(group_id=group)
        if teacher:
            queryset = queryset.filter(teacher_id=teacher)
        if subject:
            queryset = queryset.filter(subject_id=subject)
        if room:
            queryset = queryset.filter(room_id=room)
        if status_value:
            queryset = queryset.filter(status=status_value)
        if lesson_date:
            queryset = queryset.filter(lesson_date=lesson_date)
        if date_from:
            queryset = queryset.filter(lesson_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(lesson_date__lte=date_to)
        if search:
            queryset = queryset.filter(
                Q(topic__icontains=search)
                | Q(comment__icontains=search)
                | Q(group__name__icontains=search)
                | Q(subject__name__icontains=search)
            )
        return queryset.order_by('-lesson_date', 'start_time')

    def _attendance_payload(self, lesson):
        memberships = GroupMembership.objects.select_related('client').filter(
            group=lesson.group,
            status=GroupMembership.Status.ACTIVE,
        ).order_by('client__first_name', 'client__last_name')
        visits = {visit.client_id: visit for visit in lesson.visits.select_related('subscription', 'client')}
        items = []
        for membership in memberships:
            client = membership.client
            subscription = Subscription.objects.filter(client=client, status=Subscription.Status.ACTIVE).order_by('-start_date').first()
            visit = visits.get(client.id)
            items.append(
                {
                    'client': client.id,
                    'client_name': str(client),
                    'client_phone': client.phone,
                    'client_parent_name': client.parent_name,
                    'subscription': subscription.id if subscription else None,
                    'subscription_title': subscription.title if subscription else '',
                    'remaining_lessons': subscription.remaining_visits if subscription else None,
                    'lessons_left': subscription.remaining_visits if subscription else None,
                    'visit': VisitSerializer(visit).data if visit else None,
                    'status': visit.status if visit else None,
                    'comment': visit.notes if visit else '',
                    'lesson_deducted': visit.lesson_deducted if visit else False,
                }
            )
        return {'lesson': LessonSerializer(lesson).data, 'items': items, 'students': items}

    @action(detail=True, methods=['get', 'post'], url_path='attendance')
    def attendance(self, request, pk=None):
        lesson = self.get_object()
        if not lesson.group_id:
            return Response({'detail': 'У урока не указана группа.'}, status=status.HTTP_400_BAD_REQUEST)

        if request.method.lower() == 'get':
            return Response(self._attendance_payload(lesson))

        items = request.data.get('items') or []
        if not isinstance(items, list):
            return Response({'detail': 'items должен быть списком.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            for item in items:
                client_id = item.get('client')
                if not GroupMembership.objects.filter(
                    group=lesson.group,
                    client_id=client_id,
                    status=GroupMembership.Status.ACTIVE,
                ).exists():
                    return Response(
                        {'detail': 'Ученик не состоит в группе выбранного урока.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                status_value = item.get('status') or Visit.Status.PLANNED
                if status_value not in Visit.Status.values:
                    return Response({'detail': f'Invalid status: {status_value}'}, status=status.HTTP_400_BAD_REQUEST)
                subscription_id = item.get('subscription') or None
                if not subscription_id:
                    subscription = (
                        Subscription.objects.filter(client_id=client_id, status=Subscription.Status.ACTIVE)
                        .order_by('-start_date')
                        .first()
                    )
                    subscription_id = subscription.id if subscription else None
                notes = item.get('comment') or item.get('notes') or ''
                previous = Visit.objects.select_related('subscription').filter(lesson=lesson, client_id=client_id).first()

                if previous:
                    old_subscription = previous.subscription
                    old_lesson_deducted = previous.lesson_deducted
                    old_subscription_id = previous.subscription_id
                    previous.subscription_id = subscription_id
                    previous.teacher = lesson.teacher
                    previous.visited_at = _lesson_visited_at(lesson)
                    previous.status = status_value
                    previous.notes = notes
                    previous.save()
                    subscription_changed = old_subscription_id != previous.subscription_id
                    if old_lesson_deducted and (previous.status != Visit.Status.ATTENDED or subscription_changed):
                        _restore_subscription_lesson(old_subscription)
                        previous.lesson_deducted = False
                        previous.save(update_fields=('lesson_deducted', 'updated_at'))
                    if subscription_changed:
                        previous.refresh_from_db()
                    _deduct_subscription_lesson(previous)
                else:
                    visit = Visit.objects.create(
                        lesson=lesson,
                        client_id=client_id,
                        subscription_id=subscription_id,
                        teacher=lesson.teacher,
                        visited_at=_lesson_visited_at(lesson),
                        status=status_value,
                        notes=notes,
                    )
                    _deduct_subscription_lesson(visit)

            if items and lesson.status != Lesson.Status.COMPLETED:
                lesson.status = Lesson.Status.COMPLETED
                lesson.save(update_fields=('status', 'updated_at'))

        log_action(
            request,
            AuditLog.Action.VISIT,
            'Lesson',
            entity_id=lesson.id,
            entity_name=str(lesson),
            description='Отмечены посещения по уроку',
            changes={'items': len(items)},
        )
        lesson.refresh_from_db()
        return Response(self._attendance_payload(lesson))

    @action(detail=True, methods=['post'], url_path='add-student')
    def add_student(self, request, pk=None):
        lesson = self.get_object()
        if not (is_admin(request.user) or has_role(request.user, MANAGER)):
            return Response({'detail': 'Добавлять учеников в группу может только администратор или менеджер.'}, status=status.HTTP_403_FORBIDDEN)
        if not lesson.group_id:
            return Response({'detail': 'У занятия не указана группа.'}, status=status.HTTP_400_BAD_REQUEST)

        client_id = request.data.get('client')
        try:
            client = Client.objects.get(pk=client_id)
        except (Client.DoesNotExist, TypeError, ValueError):
            return Response({'detail': 'Выберите ученика.'}, status=status.HTTP_400_BAD_REQUEST)

        status_value = request.data.get('status') or Visit.Status.PLANNED
        allowed_statuses = {Visit.Status.ATTENDED, Visit.Status.SICK, Visit.Status.MISSED, Visit.Status.PLANNED}
        if status_value not in allowed_statuses:
            return Response({'detail': 'Недопустимый статус посещения.'}, status=status.HTTP_400_BAD_REQUEST)

        notes = request.data.get('comment') or request.data.get('notes') or ''
        create_subscription = request.data.get('create_subscription') in (True, 'true', 'True', '1', 1)
        service = None
        if create_subscription:
            service = CatalogItem.objects.filter(
                pk=request.data.get('service'),
                category=CatalogItem.Category.SERVICE,
                is_active=True,
            ).first()
            if not service:
                return Response({'detail': 'Выберите активную услугу.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            memberships = GroupMembership.objects.select_for_update().filter(group=lesson.group, client=client)
            active_membership = memberships.filter(status=GroupMembership.Status.ACTIVE).first()
            membership_created = False
            if not active_membership:
                inactive_membership = memberships.order_by('-created_at').first()
                if inactive_membership:
                    inactive_membership.status = GroupMembership.Status.ACTIVE
                    inactive_membership.left_at = None
                    inactive_membership.save(update_fields=('status', 'left_at', 'updated_at'))
                else:
                    GroupMembership.objects.create(
                        group=lesson.group,
                        client=client,
                        status=GroupMembership.Status.ACTIVE,
                    )
                    membership_created = True

            subscription = _client_active_subscription(client)
            created_subscription = None
            finance_transaction = None
            if create_subscription:
                start_date = parse_date(request.data.get('start_date') or '') or lesson.lesson_date or timezone.localdate()
                total_visits = int(request.data.get('total_visits') or service.lessons_count or 0)
                remaining_visits = int(request.data.get('remaining_visits') or total_visits or 0)
                if total_visits <= 0:
                    return Response({'detail': 'Количество занятий должно быть больше 0.'}, status=status.HTTP_400_BAD_REQUEST)
                price = Decimal(str(request.data.get('price') if request.data.get('price') not in (None, '') else service.price))
                payment_amount = Decimal(str(request.data.get('payment_amount') or 0))
                end_date = parse_date(request.data.get('end_date') or '') or calculate_subscription_end_date(
                    start_date,
                    lessons_count=total_visits,
                    validity_days=service.validity_days,
                    group=lesson.group,
                    service_schedule_days=service.schedule_days,
                )
                created_subscription = Subscription.objects.create(
                    branch=lesson.branch or lesson.group.branch or client.branch,
                    service=service,
                    client=client,
                    title=service.name,
                    start_date=start_date,
                    end_date=end_date,
                    total_visits=total_visits,
                    remaining_visits=remaining_visits,
                    price=price,
                    paid_amount=payment_amount,
                    purchase_date=start_date,
                    status=Subscription.Status.ACTIVE,
                )
                if payment_amount > 0:
                    finance_transaction = _create_income_transaction(
                        client=client,
                        amount=payment_amount,
                        source='subscription',
                        paid_at=_paid_at_from_date(start_date),
                        comment='Оплата абонемента из посещений',
                        created_by=request.user,
                        subscription=created_subscription,
                    )
                    created_subscription.finance_transaction = finance_transaction
                    created_subscription.save(update_fields=('finance_transaction', 'updated_at'))
                subscription = created_subscription
            visit = Visit.objects.select_for_update().filter(lesson=lesson, client=client).first()
            if visit:
                old_subscription = visit.subscription
                old_subscription_id = visit.subscription_id
                was_deducted = visit.lesson_deducted
                visit.subscription = subscription
                visit.teacher = lesson.teacher
                visit.visited_at = _lesson_visited_at(lesson)
                visit.status = status_value
                visit.notes = notes
                visit.save()
                subscription_changed = old_subscription_id != visit.subscription_id
                if was_deducted and (status_value != Visit.Status.ATTENDED or subscription_changed):
                    _restore_subscription_lesson(old_subscription)
                    visit.lesson_deducted = False
                    visit.save(update_fields=('lesson_deducted', 'updated_at'))
                _deduct_subscription_lesson(visit)
                visit_created = False
            else:
                visit = Visit.objects.create(
                    lesson=lesson,
                    client=client,
                    subscription=subscription,
                    teacher=lesson.teacher,
                    visited_at=_lesson_visited_at(lesson),
                    status=status_value,
                    notes=notes,
                )
                _deduct_subscription_lesson(visit)
                visit_created = True

            if status_value != Visit.Status.PLANNED and lesson.status != Lesson.Status.COMPLETED:
                lesson.status = Lesson.Status.COMPLETED
                lesson.save(update_fields=('status', 'updated_at'))

        payload = self._attendance_payload(lesson)
        row = next(item for item in payload['items'] if item['client'] == client.id)
        return Response(
            {
                'item': row,
                'membership_created': membership_created,
                'visit_created': visit_created,
                'already_in_group': active_membership is not None,
                'subscription_created': created_subscription is not None,
                'subscription': SubscriptionSerializer(created_subscription).data if created_subscription else None,
                'finance_transaction': finance_transaction.id if finance_transaction else None,
                'message': 'Ученик уже есть в этой группе' if active_membership else '',
            },
            status=status.HTTP_201_CREATED if visit_created else status.HTTP_200_OK,
        )

    @action(detail=True, methods=['patch'], url_path='cancel')
    def cancel(self, request, pk=None):
        lesson = self.get_object()
        lesson.status = Lesson.Status.CANCELLED
        lesson.save(update_fields=('status', 'updated_at'))
        self._log_instance(AuditLog.Action.UPDATE, lesson, 'Урок отменён', {'status': Lesson.Status.CANCELLED})
        return Response(self.get_serializer(lesson).data)


class AttendanceDayView(APIView):
    permission_classes = (IsAuthenticated, EducationPermission)

    def _weekday_name(self, weekday):
        names = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
        return names[weekday]

    def _person_name(self, user):
        return user.get_full_name() or user.username if user else ''

    def _lesson_item(self, lesson):
        return {
            'id': lesson.id,
            'type': 'lesson',
            'lesson_id': lesson.id,
            'schedule_slot_id': lesson.schedule_slot_id,
            'group': lesson.group_id,
            'group_name': lesson.group.name if lesson.group else '',
            'subject_name': lesson.subject.name if lesson.subject else '',
            'teacher_name': self._person_name(lesson.teacher),
            'room_name': lesson.room.name if lesson.room else '',
            'start_time': lesson.start_time.strftime('%H:%M') if lesson.start_time else '',
            'end_time': lesson.end_time.strftime('%H:%M') if lesson.end_time else '',
            'status': lesson.status,
        }

    def _slot_item(self, slot, lesson_date):
        return {
            'id': f'slot-{slot.id}-{lesson_date}',
            'type': 'schedule_slot',
            'lesson_id': None,
            'schedule_slot_id': slot.id,
            'group': slot.group_id,
            'group_name': slot.group.name if slot.group else '',
            'subject_name': slot.subject.name if slot.subject else (slot.group.subject.name if slot.group and slot.group.subject else ''),
            'teacher_name': self._person_name(slot.teacher or (slot.group.teacher if slot.group else None)),
            'room_name': slot.room.name if slot.room else '',
            'start_time': slot.start_time.strftime('%H:%M') if slot.start_time else '',
            'end_time': slot.end_time.strftime('%H:%M') if slot.end_time else '',
            'status': 'planned',
        }

    def get(self, request):
        lesson_date = parse_date(request.query_params.get('date') or '')
        if not lesson_date:
            return Response({'detail': 'Укажите дату.'}, status=status.HTTP_400_BAD_REQUEST)

        group = request.query_params.get('group')
        teacher = request.query_params.get('teacher')
        room = request.query_params.get('room')
        branch = request.query_params.get('branch')
        weekday = lesson_date.weekday()

        lessons = Lesson.objects.select_related('group', 'schedule_slot', 'subject', 'teacher', 'room').filter(lesson_date=lesson_date)
        slots = ScheduleSlot.objects.select_related('group', 'group__subject', 'group__teacher', 'subject', 'teacher', 'room').filter(weekday=weekday, is_active=True)

        if has_role(request.user, TEACHER) and not has_any_role(request.user, {MANAGER, ACCOUNTANT}):
            lessons = lessons.filter(teacher=request.user)
            slots = slots.filter(Q(teacher=request.user) | Q(teacher__isnull=True, group__teacher=request.user))
        if group:
            lessons = lessons.filter(group_id=group)
            slots = slots.filter(group_id=group)
        if teacher:
            lessons = lessons.filter(teacher_id=teacher)
            slots = slots.filter(Q(teacher_id=teacher) | Q(teacher__isnull=True, group__teacher_id=teacher))
        if room:
            lessons = lessons.filter(room_id=room)
            slots = slots.filter(room_id=room)
        if branch:
            lessons = lessons.filter(branch_id=branch)
            slots = slots.filter(branch_id=branch)

        items = []
        lesson_keys = set()
        for lesson in lessons:
            items.append(self._lesson_item(lesson))
            if lesson.schedule_slot_id:
                lesson_keys.add(('slot', lesson.schedule_slot_id))
            if lesson.group_id and lesson.start_time:
                lesson_keys.add(('fallback', lesson.group_id, lesson.start_time))

        for slot in slots:
            slot_key = ('slot', slot.id)
            fallback_key = ('fallback', slot.group_id, slot.start_time)
            if slot_key in lesson_keys or fallback_key in lesson_keys:
                continue
            items.append(self._slot_item(slot, lesson_date))

        items.sort(key=lambda item: (item.get('start_time') or '', item.get('group_name') or ''))
        return Response({'date': str(lesson_date), 'weekday': self._weekday_name(weekday), 'items': items})


class ClientViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, ClientPermission)
    queryset = Client.objects.select_related('manager').all()
    serializer_class = ClientSerializer
    audit_entity_type = 'Client'
    audit_create_description = 'Создан клиент'
    audit_update_description = 'Изменён клиент'
    audit_delete_description = 'Удалён клиент'

    @action(detail=False, methods=['get'], url_path='options')
    def options(self, request):
        clients = self.filter_queryset(self.get_queryset().filter(is_active=True))
        return Response(
            [
                {
                    'id': client.id,
                    'full_name': str(client),
                    'display_name': ' · '.join(filter(None, [str(client), client.parent_name, client.phone])),
                    'phone': client.phone,
                    'parent_name': client.parent_name,
                    'is_active': client.is_active,
                }
                for client in clients
            ]
        )

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        search = self.request.query_params.get('search')
        status_value = self.request.query_params.get('status')
        manager = self.request.query_params.get('manager')

        if search:
            queryset = queryset.filter(first_name__icontains=search) | queryset.filter(
                last_name__icontains=search
            ) | queryset.filter(phone__icontains=search) | queryset.filter(email__icontains=search)
        if status_value in ('active', 'inactive'):
            queryset = queryset.filter(is_active=status_value == 'active')
        if manager:
            queryset = queryset.filter(manager_id=manager)
        if _my_param(self.request):
            queryset = queryset.filter(manager=self.request.user)
        return queryset.order_by('-created_at')


class SubscriptionViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, SubscriptionPermission)
    queryset = Subscription.objects.select_related('client').all()
    serializer_class = SubscriptionSerializer
    audit_entity_type = 'Subscription'
    audit_update_description = 'Изменён абонемент'

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        status_value = self.request.query_params.get('status')
        client = self.request.query_params.get('client')
        active = self.request.query_params.get('active')
        date_from = _date_param(self.request, 'date_from')
        date_to = _date_param(self.request, 'date_to')

        if status_value:
            queryset = queryset.filter(status=status_value)
        if client:
            queryset = queryset.filter(client_id=client)
        if active in ('1', 'true', 'True', 'yes'):
            today = timezone.localdate()
            queryset = queryset.filter(
                status=Subscription.Status.ACTIVE,
                remaining_visits__gt=0,
            ).filter(Q(end_date__isnull=True) | Q(end_date__gte=today))
        if date_from:
            queryset = queryset.filter(start_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(start_date__lte=date_to)
        return queryset.order_by('-start_date', '-created_at')

    def perform_create(self, serializer):
        with transaction.atomic():
            subscription = serializer.save()
            if subscription.paid_amount > 0 and not subscription.finance_transaction_id:
                finance_transaction = _create_income_transaction(
                    client=subscription.client,
                    amount=subscription.paid_amount,
                    source='subscription',
                    paid_at=_paid_at_from_date(subscription.purchase_date),
                    comment='Оплата абонемента',
                    created_by=self.request.user,
                    subscription=subscription,
                )
                subscription.finance_transaction = finance_transaction
                subscription.save(update_fields=('finance_transaction', 'updated_at'))
            self._log_instance(AuditLog.Action.CREATE, subscription, 'Создан абонемент', self._audit_changes())


class VisitViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, VisitPermission)
    queryset = Visit.objects.select_related(
        'client',
        'subscription',
        'teacher',
        'lesson',
        'lesson__group',
        'lesson__subject',
        'lesson__teacher',
    ).all()
    serializer_class = VisitSerializer
    audit_entity_type = 'Visit'

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        client = self.request.query_params.get('client')
        group = self.request.query_params.get('group')
        teacher = self.request.query_params.get('teacher')
        status_value = self.request.query_params.get('status')
        subscription = self.request.query_params.get('subscription')
        date = _date_param(self.request, 'date')
        date_from = _date_param(self.request, 'date_from')
        date_to = _date_param(self.request, 'date_to')

        if has_role(self.request.user, TEACHER) and not has_any_role(self.request.user, {MANAGER, ACCOUNTANT}):
            queryset = queryset.filter(Q(teacher=self.request.user) | Q(lesson__teacher=self.request.user))
        if client:
            queryset = queryset.filter(client_id=client)
        if group:
            queryset = queryset.filter(lesson__group_id=group)
        if teacher:
            queryset = queryset.filter(Q(teacher_id=teacher) | Q(lesson__teacher_id=teacher))
        if status_value:
            queryset = queryset.filter(status=status_value)
        if subscription:
            queryset = queryset.filter(subscription_id=subscription)
        if date:
            queryset = queryset.filter(visited_at__date=date)
        if date_from:
            queryset = queryset.filter(visited_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(visited_at__date__lte=date_to)
        return queryset.order_by('-visited_at', '-created_at')

    def _restore_lesson(self, subscription):
        if subscription and subscription.remaining_visits < subscription.total_visits:
            subscription.remaining_visits += 1
            subscription.save(update_fields=('remaining_visits', 'updated_at'))

    def _deduct_lesson(self, visit):
        if (
            visit.status == Visit.Status.ATTENDED
            and visit.subscription_id
            and not visit.lesson_deducted
            and visit.subscription.remaining_visits > 0
        ):
            visit.subscription.remaining_visits -= 1
            visit.subscription.save(update_fields=('remaining_visits', 'updated_at'))
            visit.lesson_deducted = True
            visit.save(update_fields=('lesson_deducted', 'updated_at'))

    def perform_create(self, serializer):
        with transaction.atomic():
            visit = serializer.save()
            self._deduct_lesson(visit)
            description = 'Занятие отмечено как посещённое' if visit.status == Visit.Status.ATTENDED else 'Добавлено посещение'
            self._log_instance(AuditLog.Action.VISIT, visit, description, self._audit_changes())

    def perform_update(self, serializer):
        with transaction.atomic():
            previous = Visit.objects.select_related('subscription').get(pk=serializer.instance.pk)
            visit = serializer.save()
            subscription_changed = previous.subscription_id != visit.subscription_id
            should_restore = previous.lesson_deducted and (
                visit.status != Visit.Status.ATTENDED or subscription_changed
            )

            if should_restore:
                self._restore_lesson(previous.subscription)
                visit.lesson_deducted = False
                visit.save(update_fields=('lesson_deducted', 'updated_at'))

            self._deduct_lesson(visit)
            description = 'Занятие отмечено как посещённое' if visit.status == Visit.Status.ATTENDED else 'Изменено посещение'
            self._log_instance(AuditLog.Action.UPDATE, visit, description, self._audit_changes())


class TrialViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, TrialPermission)
    queryset = Trial.objects.select_related('client', 'manager', 'teacher', 'subscription').all()
    serializer_class = TrialSerializer
    audit_entity_type = 'Trial'
    audit_update_description = 'Изменён пробник'

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        stage = self.request.query_params.get('stage')
        manager = self.request.query_params.get('manager')
        client = self.request.query_params.get('client')
        search = self.request.query_params.get('search')
        scheduled_at_from = _date_param(self.request, 'scheduled_at_from')
        scheduled_at_to = _date_param(self.request, 'scheduled_at_to')
        payment_date_from = _date_param(self.request, 'payment_date_from')
        payment_date_to = _date_param(self.request, 'payment_date_to')

        if search:
            queryset = queryset.filter(
                Q(client__first_name__icontains=search)
                | Q(client__last_name__icontains=search)
                | Q(client__parent_name__icontains=search)
                | Q(client__phone__icontains=search)
                | Q(notes__icontains=search)
            )
        if stage:
            queryset = queryset.filter(status=stage)
        if manager:
            queryset = queryset.filter(manager_id=manager)
        if client:
            queryset = queryset.filter(client_id=client)
        if _my_param(self.request):
            queryset = queryset.filter(manager=self.request.user) | queryset.filter(teacher=self.request.user)
        if scheduled_at_from:
            queryset = queryset.filter(scheduled_at__date__gte=scheduled_at_from)
        if scheduled_at_to:
            queryset = queryset.filter(scheduled_at__date__lte=scheduled_at_to)
        if payment_date_from:
            queryset = queryset.filter(payment_date__gte=payment_date_from)
        if payment_date_to:
            queryset = queryset.filter(payment_date__lte=payment_date_to)
        return queryset.order_by('-scheduled_at')

    def perform_create(self, serializer):
        with transaction.atomic():
            trial = serializer.save()
            if trial.price > 0 and trial.payment_date and not trial.finance_transaction_id:
                finance_transaction = _create_income_transaction(
                    client=trial.client,
                    amount=trial.price,
                    source='trial',
                    paid_at=_paid_at_from_date(trial.payment_date),
                    comment='Оплата пробника',
                    created_by=self.request.user,
                )
                trial.finance_transaction = finance_transaction
                trial.save(update_fields=('finance_transaction', 'updated_at'))
            self._log_instance(AuditLog.Action.CREATE, trial, 'Добавлен пробник', self._audit_changes())

    def perform_update(self, serializer):
        previous_status = serializer.instance.status
        trial = serializer.save()
        changes = self._audit_changes()
        if previous_status != trial.status:
            changes['stage'] = {'from': previous_status, 'to': trial.status}
        self._log_instance(AuditLog.Action.UPDATE, trial, 'Изменён пробник', changes)

    @action(detail=True, methods=['post'], url_path='convert-to-subscription')
    def convert_to_subscription(self, request, pk=None):
        trial = self.get_object()
        if not (is_admin(request.user) or has_role(request.user, MANAGER)):
            return Response({'detail': 'Нет доступа к этому действию'}, status=status.HTTP_403_FORBIDDEN)
        if not trial.client_id:
            return Response({'detail': 'У пробника не указан клиент'}, status=status.HTTP_400_BAD_REQUEST)
        if trial.subscription_id:
            return Response({'detail': 'Абонемент по этому пробнику уже создан'}, status=status.HTTP_400_BAD_REQUEST)

        service = None
        service_id = request.data.get('service')
        if service_id:
            service = CatalogItem.objects.filter(
                pk=service_id,
                category=CatalogItem.Category.SERVICE,
                is_active=True,
            ).first()
            if not service:
                return Response({'detail': 'Выберите активную услугу.'}, status=status.HTTP_400_BAD_REQUEST)

        title = (service.name if service else None) or request.data.get('subscription_type') or request.data.get('title') or ''
        start_date = parse_date(request.data.get('start_date') or '') or (timezone.localdate() if service else None)
        total_visits = int(request.data.get('total_visits') or (service.lessons_count if service else 0) or 0)
        price = Decimal(str(request.data.get('price') if request.data.get('price') not in (None, '') else (service.price if service else 0)))
        payment_amount = Decimal(str(request.data.get('payment_amount') if request.data.get('payment_amount') not in (None, '') else (service.price if service else 0)))
        payment_method = request.data.get('payment_method') or ''
        comment = request.data.get('comment') or 'Оплата абонемента после пробного'

        if not title:
            return Response({'detail': 'Укажите вид абонемента'}, status=status.HTTP_400_BAD_REQUEST)
        if not start_date:
            return Response({'detail': 'Укажите дату начала'}, status=status.HTTP_400_BAD_REQUEST)
        if total_visits <= 0:
            return Response({'detail': 'Количество занятий должно быть больше 0'}, status=status.HTTP_400_BAD_REQUEST)

        end_date = parse_date(request.data.get('end_date') or '')
        if not end_date and service:
            membership = (
                GroupMembership.objects.select_related('group')
                .filter(client=trial.client, status=GroupMembership.Status.ACTIVE)
                .order_by('joined_at', 'id')
                .first()
            )
            end_date = calculate_subscription_end_date(
                start_date,
                lessons_count=total_visits,
                validity_days=service.validity_days,
                group=membership.group if membership else None,
                service_schedule_days=service.schedule_days,
            )

        with transaction.atomic():
            subscription = Subscription.objects.create(
                branch=trial.branch or trial.client.branch,
                service=service,
                client=trial.client,
                title=title,
                start_date=start_date,
                end_date=end_date,
                total_visits=total_visits,
                remaining_visits=total_visits,
                price=price,
                paid_amount=payment_amount,
                purchase_date=start_date,
                status=Subscription.Status.ACTIVE,
            )
            finance_transaction = None
            if payment_amount > 0:
                finance_transaction = _create_income_transaction(
                    client=trial.client,
                    amount=payment_amount,
                    source='subscription',
                    paid_at=_paid_at_from_date(start_date),
                    comment=comment or 'Оплата абонемента после пробного',
                    created_by=request.user,
                    subscription=subscription,
                )
                finance_transaction.payment_method = payment_method
                finance_transaction.save(update_fields=('payment_method', 'updated_at'))
                subscription.finance_transaction = finance_transaction
                subscription.save(update_fields=('finance_transaction', 'updated_at'))

            trial.status = Trial.Status.BOUGHT
            trial.bought_subscription = True
            trial.subscription = subscription
            trial.save(update_fields=('status', 'bought_subscription', 'subscription', 'updated_at'))

        log_action(
            request,
            AuditLog.Action.TRIAL_CONVERTED_TO_SUBSCRIPTION,
            'Trial',
            entity_id=trial.id,
            entity_name=str(trial),
            description='Пробник переведен в абонемент',
            changes={
                'trial_id': trial.id,
                'client_id': trial.client_id,
                'subscription_id': subscription.id,
                'payment_amount': str(payment_amount),
            },
        )
        return Response(
            {
                'trial': TrialSerializer(trial).data,
                'subscription': SubscriptionSerializer(subscription).data,
                'finance_transaction': FinanceTransactionSerializer(finance_transaction).data if finance_transaction else None,
            },
            status=status.HTTP_201_CREATED,
        )


class MasterClassViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, MasterClassPermission)
    queryset = MasterClass.objects.select_related('manager', 'teacher').prefetch_related('participants').all()
    serializer_class = MasterClassSerializer
    audit_entity_type = 'MasterClass'
    audit_update_description = 'Изменён МК'

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        stage = self.request.query_params.get('stage')
        manager = self.request.query_params.get('manager')
        client = self.request.query_params.get('client')
        payment_date_from = _date_param(self.request, 'payment_date_from')
        payment_date_to = _date_param(self.request, 'payment_date_to')

        if stage:
            queryset = queryset.filter(stage=stage)
        if manager:
            queryset = queryset.filter(manager_id=manager)
        if client:
            queryset = queryset.filter(participants__id=client)
        if _my_param(self.request):
            queryset = queryset.filter(manager=self.request.user) | queryset.filter(teacher=self.request.user)
        if payment_date_from:
            queryset = queryset.filter(payment_date__gte=payment_date_from)
        if payment_date_to:
            queryset = queryset.filter(payment_date__lte=payment_date_to)
        return queryset.distinct().order_by('-starts_at')

    def perform_create(self, serializer):
        with transaction.atomic():
            master_class = serializer.save()
            if master_class.payment_amount > 0 and master_class.payment_date and not master_class.finance_transaction_id:
                client = master_class.participants.first()
                finance_transaction = _create_income_transaction(
                    client=client,
                    amount=master_class.payment_amount,
                    source='master_class',
                    paid_at=_paid_at_from_date(master_class.payment_date),
                    comment='Оплата МК',
                    created_by=self.request.user,
                )
                master_class.finance_transaction = finance_transaction
                master_class.save(update_fields=('finance_transaction', 'updated_at'))
            self._log_instance(AuditLog.Action.CREATE, master_class, 'Добавлен МК', self._audit_changes())

    def perform_update(self, serializer):
        previous_stage = serializer.instance.stage
        master_class = serializer.save()
        changes = self._audit_changes()
        if previous_stage != master_class.stage:
            changes['stage'] = {'from': previous_stage, 'to': master_class.stage}
        self._log_instance(AuditLog.Action.UPDATE, master_class, 'Изменён МК', changes)


class TaskViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, TaskPermission)
    queryset = Task.objects.select_related('assigned_to', 'client').all()
    serializer_class = TaskSerializer
    audit_entity_type = 'Task'
    audit_create_description = 'Создана задача'
    audit_update_description = 'Изменена задача'

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        status_value = self.request.query_params.get('status')
        assigned_to = self.request.query_params.get('assigned_to')
        client = self.request.query_params.get('client')
        search = self.request.query_params.get('search')
        due_date = _date_param(self.request, 'due_date')
        due_date_from = _date_param(self.request, 'due_date_from')
        due_date_to = _date_param(self.request, 'due_date_to')

        if search:
            queryset = queryset.filter(
                Q(title__icontains=search)
                | Q(description__icontains=search)
                | Q(client__first_name__icontains=search)
                | Q(client__last_name__icontains=search)
                | Q(client__phone__icontains=search)
            )
        if status_value:
            if status_value == Task.Status.NEW:
                queryset = queryset.filter(Q(status=Task.Status.NEW) | Q(status=Task.Status.TODO))
            elif status_value == Task.Status.DONE:
                queryset = queryset.filter(Q(status=Task.Status.DONE) | Q(status='completed'))
            else:
                queryset = queryset.filter(status=status_value)
        if assigned_to:
            queryset = queryset.filter(assigned_to_id=assigned_to)
        if client:
            queryset = queryset.filter(client_id=client)
        if (has_role(self.request.user, TEACHER) and not has_role(self.request.user, MANAGER)) or _my_param(self.request):
            queryset = queryset.filter(assigned_to=self.request.user)
        if due_date:
            queryset = queryset.filter(due_at__date=due_date)
        if due_date_from:
            queryset = queryset.filter(due_at__date__gte=due_date_from)
        if due_date_to:
            queryset = queryset.filter(due_at__date__lte=due_date_to)
        return queryset.order_by('due_at', '-created_at')

    @action(detail=True, methods=['patch'], url_path='mark-done')
    def mark_done(self, request, pk=None):
        task = self.get_object()
        task.status = Task.Status.DONE
        task.save(update_fields=('status', 'updated_at'))
        self._log_instance(AuditLog.Action.TASK_DONE, task, 'Задача выполнена', {'status': Task.Status.DONE})
        return Response(self.get_serializer(task).data)


class FinanceTransactionViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, FinancePermission)
    queryset = FinanceTransaction.objects.select_related('client', 'subscription', 'created_by').all()
    serializer_class = FinanceTransactionSerializer
    audit_entity_type = 'FinanceTransaction'
    audit_update_description = 'Изменена финансовая операция'
    audit_delete_description = 'Удалена финансовая операция'

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        transaction_type = self.request.query_params.get('type')
        source = self.request.query_params.get('source')
        payment_method = self.request.query_params.get('payment_method')
        client = self.request.query_params.get('client')
        date_from = _date_param(self.request, 'date_from')
        date_to = _date_param(self.request, 'date_to')

        if transaction_type:
            queryset = queryset.filter(transaction_type=transaction_type)
        if source:
            queryset = queryset.filter(source=source)
        if payment_method:
            queryset = queryset.filter(payment_method=payment_method)
        if client:
            queryset = queryset.filter(client_id=client)
        if has_role(self.request.user, MANAGER) and not has_role(self.request.user, ACCOUNTANT):
            queryset = queryset.filter(
                transaction_type=FinanceTransaction.Type.INCOME,
                client__manager=self.request.user,
            )
        if date_from:
            queryset = queryset.filter(paid_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(paid_at__date__lte=date_to)
        return queryset.order_by('-paid_at', '-created_at')

    def perform_create(self, serializer):
        finance_transaction = serializer.save(created_by=self.request.user)
        self._log_instance(
            AuditLog.Action.PAYMENT,
            finance_transaction,
            'Добавлена финансовая операция',
            self._audit_changes(),
        )


class ChatMessageViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, ChatPermission)
    queryset = ChatMessage.objects.select_related('sender', 'client').filter(is_deleted=False)
    serializer_class = ChatMessageSerializer

    def get_queryset(self):
        return super().get_queryset().order_by('-created_at')

    def perform_create(self, serializer):
        serializer.save(sender=self.request.user)


class StudioSettingsViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, SettingsPermission)
    queryset = StudioSettings.objects.all()
    serializer_class = StudioSettingsSerializer
    audit_entity_type = 'Settings'
    audit_update_description = 'Изменены настройки студии'

    price_fields = {
        'default_price_ab4',
        'default_price_ab8',
        'default_price_trial',
        'default_price_master_class',
    }

    def update(self, request, *args, **kwargs):
        if has_role(request.user, ACCOUNTANT):
            instance = self.get_object()
            data = {field: request.data[field] for field in self.price_fields if field in request.data}
            serializer = self.get_serializer(instance, data=data, partial=True)
            serializer.is_valid(raise_exception=True)
            self.perform_update(serializer)
            return Response(serializer.data)
        return super().update(request, *args, **kwargs)


class CatalogItemViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, CatalogItemPermission)
    queryset = CatalogItem.objects.all()
    serializer_class = CatalogItemSerializer
    audit_entity_type = 'CatalogItem'

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        category = self.request.query_params.get('category')
        is_active = self.request.query_params.get('is_active')
        if category:
            queryset = queryset.filter(category=category)
        if is_active in ('1', 'true', 'True', 'yes'):
            queryset = queryset.filter(is_active=True)
        elif is_active in ('0', 'false', 'False', 'no'):
            queryset = queryset.filter(is_active=False)
        return queryset.order_by('category', 'sort_order', 'name')

    def _catalog_changes(self, instance):
        return {
            'name': instance.name,
            'price': str(instance.price),
            'category': instance.category,
            'is_active': instance.is_active,
            'lessons_count': instance.lessons_count,
            'validity_days': instance.validity_days,
            'schedule_days': list(instance.schedule_days or []),
        }

    def perform_create(self, serializer):
        instance = serializer.save()
        self._log_instance(
            AuditLog.Action.CATALOG_ITEM_CREATE,
            instance,
            'Создана позиция справочника цен',
            self._catalog_changes(instance),
        )

    def perform_update(self, serializer):
        instance = serializer.save()
        self._log_instance(
            AuditLog.Action.CATALOG_ITEM_UPDATE,
            instance,
            'Изменена позиция справочника цен',
            self._catalog_changes(instance),
        )

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=('is_active', 'updated_at'))
        self._log_instance(
            AuditLog.Action.CATALOG_ITEM_DISABLE,
            instance,
            'Отключена позиция справочника цен',
            self._catalog_changes(instance),
        )


class ExcelImportView(APIView):
    permission_classes = (IsAuthenticated, ExcelImportPermission)
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request):
        uploaded_file = request.FILES.get('file')
        if not uploaded_file:
            return Response({'detail': 'Файл .xlsx обязателен.'}, status=status.HTTP_400_BAD_REQUEST)
        if not uploaded_file.name.lower().endswith('.xlsx'):
            return Response({'detail': 'Поддерживаются только файлы .xlsx.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            result = import_excel(uploaded_file, request.user)
        except Exception as exc:
            return Response({'detail': f'Не удалось прочитать Excel-файл: {exc}'}, status=status.HTTP_400_BAD_REQUEST)
        created = result.get('created', {})
        log_action(
            request,
            AuditLog.Action.IMPORT,
            'ExcelImport',
            entity_name=uploaded_file.name,
            description=(
                f"Импорт Excel: clients={created.get('clients', 0)}, "
                f"subscriptions={created.get('subscriptions', 0)}, "
                f"trials={created.get('trials', 0)}, "
                f"master_classes={created.get('master_classes', 0)}, "
                f"visits={created.get('visits', 0)}, skipped={result.get('skipped', 0)}"
            ),
            changes=result,
        )
        return Response(result, status=status.HTTP_200_OK)


def _xlsx_response(buffer, filename):
    response = HttpResponse(
        buffer.getvalue(),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


def _filter_period(queryset, field, request):
    date_from = _date_param(request, 'date_from')
    date_to = _date_param(request, 'date_to')
    if date_from:
        queryset = queryset.filter(**{f'{field}__gte': date_from})
    if date_to:
        queryset = queryset.filter(**{f'{field}__lte': date_to})
    return queryset


class BaseExportView(APIView):
    permission_classes = (IsAuthenticated, ExportPermission)
    export_type = ''
    filename_prefix = 'export'
    description = 'Экспорт данных'

    def _filename(self):
        return f'{self.filename_prefix}_{timezone.localdate():%Y-%m-%d}.xlsx'

    def _log_export(self, request, count):
        log_action(
            request,
            'export',
            'Export',
            entity_name=self.export_type,
            description=f'{self.description}: строк {count}',
            changes={
                'date_from': request.query_params.get('date_from', ''),
                'date_to': request.query_params.get('date_to', ''),
                'count': count,
            },
        )


class ClientsExportView(BaseExportView):
    export_type = 'clients'
    filename_prefix = 'clients'
    description = 'Экспорт клиентов'

    def get(self, request):
        queryset = Client.objects.select_related('manager').all()
        queryset = _filter_period(queryset, 'created_at__date', request)
        search = request.query_params.get('search')
        status_value = request.query_params.get('status')
        manager = request.query_params.get('manager')
        if search:
            queryset = queryset.filter(Q(first_name__icontains=search) | Q(last_name__icontains=search) | Q(phone__icontains=search) | Q(parent_name__icontains=search))
        if status_value in ('active', 'inactive'):
            queryset = queryset.filter(is_active=status_value == 'active')
        if manager:
            queryset = queryset.filter(manager_id=manager)
        self._log_export(request, queryset.count())
        return _xlsx_response(export_clients(queryset.order_by('-created_at')), self._filename())


class SubscriptionsExportView(BaseExportView):
    export_type = 'subscriptions'
    filename_prefix = 'subscriptions'
    description = 'Экспорт абонементов'

    def get(self, request):
        queryset = Subscription.objects.select_related('client').all()
        queryset = _filter_period(queryset, 'start_date', request)
        status_value = request.query_params.get('status')
        if status_value:
            queryset = queryset.filter(status=status_value)
        self._log_export(request, queryset.count())
        return _xlsx_response(export_subscriptions(queryset.order_by('-start_date')), self._filename())


class VisitsExportView(BaseExportView):
    export_type = 'visits'
    filename_prefix = 'visits'
    description = 'Экспорт посещений'

    def get(self, request):
        queryset = Visit.objects.select_related('client', 'subscription', 'teacher', 'lesson').all()
        if has_role(request.user, TEACHER) and not has_any_role(request.user, {MANAGER, ACCOUNTANT}):
            queryset = queryset.filter(Q(teacher=request.user) | Q(lesson__teacher=request.user))
        queryset = _filter_period(queryset, 'visited_at__date', request)
        status_value = request.query_params.get('status')
        teacher = request.query_params.get('teacher')
        group = request.query_params.get('group')
        if status_value:
            queryset = queryset.filter(status=status_value)
        if teacher:
            queryset = queryset.filter(teacher_id=teacher)
        if group:
            queryset = queryset.filter(lesson__group_id=group)
        self._log_export(request, queryset.count())
        return _xlsx_response(export_visits(queryset.order_by('-visited_at')), self._filename())


class FinanceExportView(BaseExportView):
    export_type = 'finance'
    filename_prefix = 'finance'
    description = 'Экспорт финансов'

    def get(self, request):
        queryset = FinanceTransaction.objects.select_related('client', 'created_by').all()
        queryset = _filter_period(queryset, 'paid_at__date', request)
        source = request.query_params.get('source')
        status_value = request.query_params.get('status')
        if source:
            queryset = queryset.filter(source=source)
        if status_value in ('income', 'expense'):
            queryset = queryset.filter(transaction_type=status_value)
        self._log_export(request, queryset.count())
        return _xlsx_response(export_finance(queryset.order_by('-paid_at')), self._filename())


class TrialsExportView(BaseExportView):
    export_type = 'trials'
    filename_prefix = 'trials'
    description = 'Экспорт пробников'

    def get(self, request):
        queryset = Trial.objects.select_related('client', 'manager', 'teacher').all()
        queryset = _filter_period(queryset, 'scheduled_at__date', request)
        status_value = request.query_params.get('status')
        manager = request.query_params.get('manager')
        teacher = request.query_params.get('teacher')
        if status_value:
            queryset = queryset.filter(status=status_value)
        if manager:
            queryset = queryset.filter(manager_id=manager)
        if teacher:
            queryset = queryset.filter(teacher_id=teacher)
        self._log_export(request, queryset.count())
        return _xlsx_response(export_trials(queryset.order_by('-scheduled_at')), self._filename())


class MasterClassesExportView(BaseExportView):
    export_type = 'master-classes'
    filename_prefix = 'master_classes'
    description = 'Экспорт МК'

    def get(self, request):
        queryset = MasterClass.objects.select_related('manager', 'teacher').prefetch_related('participants').all()
        queryset = _filter_period(queryset, 'starts_at__date', request)
        status_value = request.query_params.get('status')
        manager = request.query_params.get('manager')
        teacher = request.query_params.get('teacher')
        if status_value:
            queryset = queryset.filter(stage=status_value)
        if manager:
            queryset = queryset.filter(manager_id=manager)
        if teacher:
            queryset = queryset.filter(teacher_id=teacher)
        self._log_export(request, queryset.count())
        return _xlsx_response(export_master_classes(queryset.order_by('-starts_at')), self._filename())


class GroupsExportView(BaseExportView):
    export_type = 'groups'
    filename_prefix = 'groups'
    description = 'Экспорт групп'

    def get(self, request):
        queryset = StudyGroup.objects.select_related('subject', 'teacher', 'manager').prefetch_related('memberships').all()
        if has_role(request.user, TEACHER) and not has_any_role(request.user, {MANAGER, ACCOUNTANT}):
            queryset = queryset.filter(teacher=request.user)
        status_value = request.query_params.get('status')
        teacher = request.query_params.get('teacher')
        manager = request.query_params.get('manager')
        search = request.query_params.get('search')
        if status_value:
            queryset = queryset.filter(status=status_value)
        if teacher:
            queryset = queryset.filter(teacher_id=teacher)
        if manager:
            queryset = queryset.filter(manager_id=manager)
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(subject__name__icontains=search))
        self._log_export(request, queryset.count())
        return _xlsx_response(export_groups(queryset.order_by('name')), self._filename())


class LessonsExportView(BaseExportView):
    export_type = 'lessons'
    filename_prefix = 'lessons'
    description = 'Экспорт уроков'

    def get(self, request):
        queryset = Lesson.objects.select_related('group', 'subject', 'teacher', 'room').prefetch_related('visits').all()
        if has_role(request.user, TEACHER) and not has_any_role(request.user, {MANAGER, ACCOUNTANT}):
            queryset = queryset.filter(teacher=request.user)
        queryset = _filter_period(queryset, 'lesson_date', request)
        status_value = request.query_params.get('status')
        teacher = request.query_params.get('teacher')
        group = request.query_params.get('group')
        if status_value:
            queryset = queryset.filter(status=status_value)
        if teacher:
            queryset = queryset.filter(teacher_id=teacher)
        if group:
            queryset = queryset.filter(group_id=group)
        self._log_export(request, queryset.count())
        return _xlsx_response(export_lessons(queryset.order_by('-lesson_date', 'start_time')), self._filename())


class ReportSummaryExportView(BaseExportView):
    export_type = 'report-summary'
    filename_prefix = 'report_summary'
    description = 'Экспорт сводного отчёта'

    def get(self, request):
        data = ReportsSummaryView().get(request).data
        rows_count = sum(len(data.get(key, [])) for key in [
            'daily_finance',
            'income_by_source',
            'sales_by_manager',
            'attendance_by_group',
            'attendance_by_teacher',
            'ending_subscriptions',
            'low_attendance_clients',
        ])
        self._log_export(request, rows_count)
        return _xlsx_response(export_summary_report(data), self._filename())


class BackupCreateView(APIView):
    permission_classes = (IsAuthenticated, BackupPermission)

    def post(self, request):
        try:
            result = create_database_backup()
        except Exception as exc:
            return Response({'success': False, 'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        log_action(
            request,
            'backup',
            'Backup',
            entity_name=result['filename'],
            description='Создан backup базы',
        )
        return Response(
            {
                'success': True,
                'filename': result['filename'],
                'path': 'backups/',
                'created_at': timezone.now(),
            }
        )


class DashboardStatsView(APIView):
    permission_classes = (IsAuthenticated, DashboardPermission)

    def get(self, request):
        today = timezone.localdate()
        date_to = _date_param(request, 'date_to') or today
        date_from = _date_param(request, 'date_from') or (date_to - timedelta(days=29))
        ending_date = today + timedelta(days=7)
        is_teacher = has_role(request.user, TEACHER) and not has_any_role(request.user, {MANAGER, ACCOUNTANT})
        can_view_finance = not is_teacher
        branch = request.query_params.get('branch')

        transactions = FinanceTransaction.objects.filter(paid_at__date__gte=date_from, paid_at__date__lte=date_to)
        clients = Client.objects.all()
        subscriptions = Subscription.objects.all()
        trials = Trial.objects.filter(scheduled_at__date__gte=date_from, scheduled_at__date__lte=date_to)
        master_classes = MasterClass.objects.filter(starts_at__date__gte=date_from, starts_at__date__lte=date_to)
        groups = StudyGroup.objects.all()
        lessons = Lesson.objects.filter(lesson_date__gte=date_from, lesson_date__lte=date_to)
        visits = Visit.objects.filter(visited_at__date__gte=date_from, visited_at__date__lte=date_to)
        tasks = Task.objects.all()

        if branch:
            transactions = transactions.filter(branch_id=branch)
            clients = clients.filter(branch_id=branch)
            subscriptions = subscriptions.filter(branch_id=branch)
            trials = trials.filter(branch_id=branch)
            master_classes = master_classes.filter(branch_id=branch)
            groups = groups.filter(branch_id=branch)
            lessons = lessons.filter(branch_id=branch)
            visits = visits.filter(branch_id=branch)
            tasks = tasks.filter(branch_id=branch)

        if is_teacher:
            groups = groups.filter(teacher=request.user)
            lessons = lessons.filter(teacher=request.user)
            visits = visits.filter(Q(teacher=request.user) | Q(lesson__teacher=request.user))
            tasks = tasks.filter(assigned_to=request.user)

        income_total = 0
        expense_total = 0
        income_today = 0
        income_month = 0
        cash = 0
        card = 0
        payment_count = 0
        avg_check = 0
        if can_view_finance:
            income_total = _decimal(
                transactions.filter(transaction_type=FinanceTransaction.Type.INCOME).aggregate(total=Sum('amount'))['total']
            )
            expense_total = _decimal(
                transactions.filter(transaction_type=FinanceTransaction.Type.EXPENSE).aggregate(total=Sum('amount'))['total']
            )
            all_income = FinanceTransaction.objects.filter(transaction_type=FinanceTransaction.Type.INCOME)
            if branch:
                all_income = all_income.filter(branch_id=branch)
            income_today = _decimal(
                all_income.filter(
                    paid_at__date=today,
                ).aggregate(total=Sum('amount'))['total']
            )
            income_month = _decimal(
                all_income.filter(
                    paid_at__year=today.year,
                    paid_at__month=today.month,
                ).aggregate(total=Sum('amount'))['total']
            )
            cash = _decimal(transactions.filter(transaction_type=FinanceTransaction.Type.INCOME, payment_method__icontains='cash').aggregate(total=Sum('amount'))['total'])
            card = _decimal(transactions.filter(transaction_type=FinanceTransaction.Type.INCOME, payment_method__icontains='card').aggregate(total=Sum('amount'))['total'])
            payment_count = transactions.filter(transaction_type=FinanceTransaction.Type.INCOME).count()
            avg_check = round(float(income_total) / payment_count, 2) if payment_count else 0

        trials_total = trials.count()
        trials_bought = trials.filter(Q(bought_subscription=True) | Q(status__in=['bought'])).count()
        trials_lost = trials.filter(status='lost').count()
        trials_income = _decimal(trials.aggregate(total=Sum('price'))['total'])

        mk_total = master_classes.count()
        mk_bought = master_classes.filter(stage='bought').count()
        mk_paid = master_classes.filter(stage='paid').count()
        mk_lost = master_classes.filter(stage='lost').count()
        mk_income = _decimal(master_classes.aggregate(total=Sum('payment_amount'))['total'])

        active_subscriptions = subscriptions.filter(status=Subscription.Status.ACTIVE)
        ending_subscriptions_qs = active_subscriptions.filter(
            Q(remaining_visits__lte=2)
            | Q(end_date__isnull=False, end_date__gte=today, end_date__lte=ending_date)
        )

        attended = visits.filter(status=Visit.Status.ATTENDED).count()
        missed = visits.filter(status=Visit.Status.MISSED).count()
        attendance_base = attended + missed
        attendance_rate = round(attended / attendance_base * 100, 2) if attendance_base else 0

        dashboard = {
            'finance': {
                'income': income_total,
                'expense': expense_total,
                'balance': income_total - expense_total,
                'cash': cash,
                'card': card,
                'payment_count': payment_count,
                'avg_check': avg_check,
            },
            'clients': {
                'total': clients.count() if not is_teacher else 0,
                'new_in_period': clients.filter(created_at__date__gte=date_from, created_at__date__lte=date_to).count() if not is_teacher else 0,
                'active': clients.filter(is_active=True).count() if not is_teacher else 0,
            },
            'subscriptions': {
                'total': subscriptions.count() if not is_teacher else 0,
                'active': active_subscriptions.count() if not is_teacher else 0,
                'ending_soon': ending_subscriptions_qs.count() if not is_teacher else 0,
                'expired': subscriptions.filter(status=Subscription.Status.EXPIRED).count() if not is_teacher else 0,
                'lessons_left_total': _decimal(active_subscriptions.aggregate(total=Sum('remaining_visits'))['total']) if not is_teacher else 0,
            },
            'trials': {
                'total': trials_total if not is_teacher else 0,
                'bought': trials_bought if not is_teacher else 0,
                'lost': trials_lost if not is_teacher else 0,
                'conversion': round(trials_bought / trials_total * 100, 2) if trials_total and not is_teacher else 0,
                'income': trials_income if not is_teacher else 0,
            },
            'master_classes': {
                'total': mk_total if not is_teacher else 0,
                'paid': mk_paid if not is_teacher else 0,
                'bought': mk_bought if not is_teacher else 0,
                'lost': mk_lost if not is_teacher else 0,
                'conversion': round(mk_bought / mk_total * 100, 2) if mk_total and not is_teacher else 0,
                'income': mk_income if not is_teacher else 0,
            },
            'groups': {
                'total': groups.count(),
                'active': groups.filter(status=StudyGroup.Status.ACTIVE).count(),
                'paused': groups.filter(status=StudyGroup.Status.PAUSED).count(),
                'archived': groups.filter(status=StudyGroup.Status.ARCHIVED).count(),
                'students_total': GroupMembership.objects.filter(group__in=groups, status=GroupMembership.Status.ACTIVE).count(),
            },
            'lessons': {
                'planned': lessons.filter(status=Lesson.Status.PLANNED).count(),
                'completed': lessons.filter(status=Lesson.Status.COMPLETED).count(),
                'cancelled': lessons.filter(status=Lesson.Status.CANCELLED).count(),
                'total': lessons.count(),
            },
            'attendance': {
                'total_visits': visits.count(),
                'attended': attended,
                'missed': missed,
                'makeup': visits.filter(status=Visit.Status.MAKEUP).count(),
                'frozen': visits.filter(status=Visit.Status.FROZEN).count(),
                'trial': visits.filter(status=Visit.Status.TRIAL).count(),
                'attendance_rate': attendance_rate,
            },
            'tasks': {
                'total': tasks.count(),
                'new': tasks.filter(Q(status=Task.Status.NEW) | Q(status=Task.Status.TODO)).count(),
                'in_progress': tasks.filter(status=Task.Status.IN_PROGRESS).count(),
                'done': tasks.filter(status=Task.Status.DONE).count(),
                'overdue': tasks.filter(due_at__date__lt=today).exclude(status=Task.Status.DONE).count(),
            },
            'period': {'date_from': date_from, 'date_to': date_to},
        }

        dashboard.update(
            {
                'clients_total': dashboard['clients']['total'],
                'active_subscriptions': dashboard['subscriptions']['active'],
                'ending_subscriptions': dashboard['subscriptions']['ending_soon'],
                'subscriptions_ending': dashboard['subscriptions']['ending_soon'],
                'trials_total': dashboard['trials']['total'],
                'trials_bought': dashboard['trials']['bought'],
                'trials_conversion': dashboard['trials']['conversion'],
                'master_classes_total': dashboard['master_classes']['total'],
                'income_total': income_total,
                'expense_total': expense_total,
                'balance': income_total - expense_total,
                'tasks_today': tasks.filter(due_at__date=today).exclude(status=Task.Status.DONE).count(),
                'tasks_overdue': dashboard['tasks']['overdue'],
                'visits_today': visits.filter(visited_at__date=today).count(),
                'trials_today': trials.filter(scheduled_at__date=today).count() if not is_teacher else 0,
                'master_classes_today': master_classes.filter(starts_at__date=today).count() if not is_teacher else 0,
                'income_today': income_today,
                'income_month': income_month,
            }
        )
        return Response(dashboard)


class ReportsSummaryView(APIView):
    permission_classes = (IsAuthenticated, ReportsPermission)

    def get(self, request):
        today = timezone.localdate()
        date_to = _date_param(request, 'date_to') or today
        date_from = _date_param(request, 'date_from') or (date_to - timedelta(days=29))
        transactions = FinanceTransaction.objects.all()
        trials = Trial.objects.all()
        master_classes = MasterClass.objects.all()
        lessons = Lesson.objects.all()
        visits = Visit.objects.select_related('client', 'lesson', 'lesson__group', 'teacher')
        branch = request.query_params.get('branch')
        if branch:
            transactions = transactions.filter(branch_id=branch)
            trials = trials.filter(branch_id=branch)
            master_classes = master_classes.filter(branch_id=branch)
            lessons = lessons.filter(branch_id=branch)
            visits = visits.filter(branch_id=branch)

        if date_from:
            transactions = transactions.filter(paid_at__date__gte=date_from)
            trials = trials.filter(scheduled_at__date__gte=date_from)
            master_classes = master_classes.filter(starts_at__date__gte=date_from)
            lessons = lessons.filter(lesson_date__gte=date_from)
            visits = visits.filter(visited_at__date__gte=date_from)
        if date_to:
            transactions = transactions.filter(paid_at__date__lte=date_to)
            trials = trials.filter(scheduled_at__date__lte=date_to)
            master_classes = master_classes.filter(starts_at__date__lte=date_to)
            lessons = lessons.filter(lesson_date__lte=date_to)
            visits = visits.filter(visited_at__date__lte=date_to)

        income_total = _decimal(
            transactions.filter(transaction_type=FinanceTransaction.Type.INCOME).aggregate(total=Sum('amount'))[
                'total'
            ]
        )
        expense_total = _decimal(
            transactions.filter(transaction_type=FinanceTransaction.Type.EXPENSE).aggregate(total=Sum('amount'))[
                'total'
            ]
        )
        trials_total = trials.count()
        trials_bought = trials.filter(Q(bought_subscription=True) | Q(status='bought')).count()
        income_transactions = transactions.filter(transaction_type=FinanceTransaction.Type.INCOME)
        expense_transactions = transactions.filter(transaction_type=FinanceTransaction.Type.EXPENSE)

        daily_map = {}
        current = date_from
        while current <= date_to:
            daily_map[current] = {'date': current, 'income': 0, 'expense': 0, 'balance': 0}
            current += timedelta(days=1)
        for item in transactions.annotate(day=TruncDate('paid_at')).values('day', 'transaction_type').annotate(total=Sum('amount')):
            if item['day'] in daily_map:
                key = 'income' if item['transaction_type'] == FinanceTransaction.Type.INCOME else 'expense'
                daily_map[item['day']][key] = _decimal(item['total'])
        daily_finance = []
        for item in daily_map.values():
            item['balance'] = item['income'] - item['expense']
            daily_finance.append(item)

        source_display = {
            'subscription': 'Абонементы',
            'trial': 'Пробники',
            'master_class': 'МК',
            'manual': 'Ручные операции',
            'other': 'Другое',
            '': 'Другое',
        }
        income_by_source = []
        for item in income_transactions.values('source').annotate(count=Count('id'), amount=Sum('amount')).order_by('source'):
            source = item['source'] or 'other'
            income_by_source.append(
                {
                    'source': source,
                    'source_display': source_display.get(source, source),
                    'count': item['count'],
                    'amount': _decimal(item['amount']),
                    'total': _decimal(item['amount']),
                }
            )

        income_by_manager = list(
            income_transactions.values('created_by', 'created_by__username')
            .annotate(total=Sum('amount'))
            .order_by('created_by__username')
        )
        payments_by_day = [{'day': item['date'], 'total': item['income']} for item in daily_finance]

        manager_ids = set(filter(None, list(trials.values_list('manager_id', flat=True)) + list(master_classes.values_list('manager_id', flat=True))))
        manager_ids.update(filter(None, income_transactions.values_list('created_by_id', flat=True)))
        sales_by_manager = []
        for manager_id in manager_ids:
            manager_trials = trials.filter(manager_id=manager_id)
            manager_mk = master_classes.filter(manager_id=manager_id)
            manager_income = _decimal(income_transactions.filter(created_by_id=manager_id).aggregate(total=Sum('amount'))['total'])
            user = manager_trials.first().manager if manager_trials.exists() else None
            if not user and manager_mk.exists():
                user = manager_mk.first().manager
            manager_name = user.get_full_name() or user.username if user else f'ID {manager_id}'
            mt_total = manager_trials.count()
            mt_bought = manager_trials.filter(Q(bought_subscription=True) | Q(status='bought')).count()
            mm_total = manager_mk.count()
            mm_bought = manager_mk.filter(stage='bought').count()
            sales_by_manager.append(
                {
                    'manager_id': manager_id,
                    'manager_name': manager_name,
                    'trials_total': mt_total,
                    'trials_bought': mt_bought,
                    'trials_conversion': round(mt_bought / mt_total * 100, 2) if mt_total else 0,
                    'mk_total': mm_total,
                    'mk_bought': mm_bought,
                    'mk_conversion': round(mm_bought / mm_total * 100, 2) if mm_total else 0,
                    'income': manager_income,
                }
            )

        attendance_by_group = []
        for group in StudyGroup.objects.filter(lessons__in=lessons).distinct().order_by('name'):
            group_lessons = lessons.filter(group=group)
            group_visits = visits.filter(lesson__group=group)
            attended = group_visits.filter(status=Visit.Status.ATTENDED).count()
            missed = group_visits.filter(status=Visit.Status.MISSED).count()
            base = attended + missed
            attendance_by_group.append(
                {
                    'group_id': group.id,
                    'group_name': group.name,
                    'lessons_count': group_lessons.count(),
                    'students_count': GroupMembership.objects.filter(group=group, status=GroupMembership.Status.ACTIVE).count(),
                    'attended': attended,
                    'missed': missed,
                    'attendance_rate': round(attended / base * 100, 2) if base else 0,
                }
            )

        attendance_by_teacher = []
        teacher_ids = set(filter(None, lessons.values_list('teacher_id', flat=True)))
        for teacher_id in teacher_ids:
            teacher_lessons = lessons.filter(teacher_id=teacher_id)
            teacher_visits = visits.filter(Q(teacher_id=teacher_id) | Q(lesson__teacher_id=teacher_id))
            attended = teacher_visits.filter(status=Visit.Status.ATTENDED).count()
            missed = teacher_visits.filter(status=Visit.Status.MISSED).count()
            base = attended + missed
            teacher = teacher_lessons.first().teacher
            attendance_by_teacher.append(
                {
                    'teacher_id': teacher_id,
                    'teacher_name': teacher.get_full_name() or teacher.username if teacher else f'ID {teacher_id}',
                    'lessons_count': teacher_lessons.count(),
                    'attended': attended,
                    'missed': missed,
                    'attendance_rate': round(attended / base * 100, 2) if base else 0,
                }
            )

        lessons_by_status = [
            {'status': Lesson.Status.PLANNED, 'status_display': 'Запланирован', 'count': lessons.filter(status=Lesson.Status.PLANNED).count()},
            {'status': Lesson.Status.COMPLETED, 'status_display': 'Проведён', 'count': lessons.filter(status=Lesson.Status.COMPLETED).count()},
            {'status': Lesson.Status.CANCELLED, 'status_display': 'Отменён', 'count': lessons.filter(status=Lesson.Status.CANCELLED).count()},
        ]

        ending_subscriptions = [
            {
                'id': subscription.id,
                'client_name': str(subscription.client),
                'client_phone': subscription.client.phone if subscription.client else '',
                'title': subscription.title,
                'lessons_left': subscription.remaining_visits,
                'lessons_total': subscription.total_visits,
                'end_date': subscription.end_date,
                'status': subscription.status,
            }
            for subscription in Subscription.objects.select_related('client')
            .filter(status=Subscription.Status.ACTIVE)
            .filter(Q(remaining_visits__lte=2) | Q(end_date__isnull=False, end_date__gte=today, end_date__lte=today + timedelta(days=7)))
            .order_by('remaining_visits', 'end_date')[:30]
        ]

        low_attendance = {}
        for visit in visits.filter(status__in=[Visit.Status.ATTENDED, Visit.Status.MISSED]).select_related('client', 'lesson__group'):
            key = (visit.client_id, visit.lesson.group_id if visit.lesson and visit.lesson.group_id else None)
            item = low_attendance.setdefault(
                key,
                {
                    'client_id': visit.client_id,
                    'client_name': str(visit.client),
                    'client_phone': visit.client.phone if visit.client else '',
                    'group_name': visit.lesson.group.name if visit.lesson and visit.lesson.group else '',
                    'attended': 0,
                    'missed': 0,
                    'attendance_rate': 0,
                },
            )
            if visit.status == Visit.Status.ATTENDED:
                item['attended'] += 1
            if visit.status == Visit.Status.MISSED:
                item['missed'] += 1
        low_attendance_clients = []
        for item in low_attendance.values():
            base = item['attended'] + item['missed']
            if base >= 3:
                item['attendance_rate'] = round(item['attended'] / base * 100, 2)
                if item['attendance_rate'] < 60:
                    low_attendance_clients.append(item)
        low_attendance_clients = sorted(low_attendance_clients, key=lambda item: item['attendance_rate'])[:20]

        avg_check = round(float(income_total) / income_transactions.count(), 2) if income_transactions.count() else 0

        return Response(
            {
                'income_total': income_total,
                'expense_total': expense_total,
                'balance': income_total - expense_total,
                'avg_check': avg_check,
                'daily_finance': daily_finance,
                'income_by_source': income_by_source,
                'income_by_managers': income_by_manager,
                'sales_by_manager': sales_by_manager,
                'attendance_by_group': attendance_by_group,
                'attendance_by_teacher': attendance_by_teacher,
                'lessons_by_status': lessons_by_status,
                'ending_subscriptions': ending_subscriptions,
                'low_attendance_clients': low_attendance_clients,
                'trials_total': trials_total,
                'trials_bought': trials_bought,
                'trials_conversion': round((trials_bought / trials_total) * 100, 2) if trials_total else 0,
                'master_classes_total': master_classes.count(),
                'payments_by_day': payments_by_day,
                'period': {'date_from': date_from, 'date_to': date_to},
            },
            status=status.HTTP_200_OK,
        )
