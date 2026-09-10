from datetime import datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import hmac
import random
import re
import string
import uuid

from django.contrib.auth import get_user_model
from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import serializers as drf_serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import BasePermission, IsAuthenticated, SAFE_METHODS
from rest_framework.response import Response
from rest_framework.views import APIView

from .audit import log_action
from .branch_filters import apply_branch_filter
from .backup import create_database_backup
from .certificates import allocate_certificate_numbers, certificate_serial_code
from .export_excel import (
    export_clients,
    export_certificates,
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
from .payment_parts import payment_parts_audit, sync_finance_payment_parts, validate_payment_parts
from .models import (
    AddonSale,
    AuditLog,
    Branch,
    CashRegisterSnapshot,
    CatalogItem,
    CertificateBatch,
    CertificateDesignAsset,
    CertificateRedemption,
    CertificateTemplate,
    ChatMessage,
    Client,
    Discount,
    EmployeePayrollProfile,
    EmployeeWorkSchedule,
    FinanceTransaction,
    GiftCertificate,
    GroupMembership,
    Lesson,
    Lead,
    LeadMessage,
    MasterClass,
    MasterClassPayment,
    MasterClassStaffAssignment,
    MessagingChannel,
    MessagingContact,
    MetaWebhookEvent,
    PaymentMethod,
    PayrollStatement,
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
    AddonSalePermission,
    AuditLogPermission,
    BranchPermission,
    CatalogItemPermission,
    CertificatePermission,
    ChatPermission,
    ClientPermission,
    DashboardPermission,
    DiscountPermission,
    ExcelImportPermission,
    EducationPermission,
    BackupPermission,
    FinancePermission,
    LeadPermission,
    PaymentMethodPermission,
    MessagingChannelPermission,
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
    AddonSaleSerializer,
    AuditLogSerializer,
    BranchSerializer,
    CatalogItemSerializer,
    CertificateRedemptionSerializer,
    CertificateDesignAssetSerializer,
    CertificateBatchSerializer,
    CertificateTemplateSerializer,
    ChatMessageSerializer,
    ClientSerializer,
    DiscountSerializer,
    EmployeePayrollProfileSerializer,
    EmployeeWorkScheduleSerializer,
    FinanceTransactionSerializer,
    GiftCertificateSerializer,
    GroupMembershipSerializer,
    LessonSerializer,
    LeadSerializer,
    LeadMessageSerializer,
    MasterClassPaymentSerializer,
    MasterClassSerializer,
    MessagingChannelSerializer,
    MetaWebhookEventSerializer,
    PaymentMethodSerializer,
    PayrollStatementSerializer,
    PublicGiftCertificateSerializer,
    RoomSerializer,
    ScheduleSlotSerializer,
    StudioSettingsSerializer,
    StudyGroupSerializer,
    SubjectSerializer,
    SubscriptionSerializer,
    TaskSerializer,
    TrialSerializer,
    VisitSerializer,
    certificate_template_snapshot,
    refresh_certificate_status,
)
from .meta_webhooks import normalize_kz_phone, process_meta_webhook, verify_meta_signature
from .meta_api import (
    MetaApiError,
    exchange_embedded_signup_code,
    get_whatsapp_phone_number,
    get_whatsapp_phone_numbers,
    subscribe_whatsapp_app,
)
from .subscription_addons import addons_comment, addons_total, sync_subscription_addons, total_price, validate_addons_payload
from .discounts import calculate_discount
from .employee_worklog import build_employee_worklog, get_employee_schedule_context, split_work_interval_by_schedule
from .payroll import apply_payroll_calculation, generate_payroll_statements
from .subscription_dates import calculate_subscription_end_date
from users.role_hierarchy import manageable_by_manager


User = get_user_model()


class EmployeeSchedulePermission(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if is_admin(request.user) or has_any_role(request.user, {MANAGER, ACCOUNTANT}):
            return True
        return request.method in SAFE_METHODS and has_role(request.user, TEACHER)


class PayrollPermission(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and (is_admin(request.user) or has_role(request.user, ACCOUNTANT)))


def _filter_branch(queryset, request):
    return apply_branch_filter(queryset, request.query_params.get('branch'))


def _search_branch(queryset, request):
    return apply_branch_filter(queryset, request.query_params.get('branch'))


def _person_name(person):
    return person.get_full_name() or person.username if person else ''


def _client_name(client):
    return str(client) if client else 'Без клиента'


def _result(result_type, instance, title, subtitle, url):
    return {
        'type': result_type,
        'id': instance.pk,
        'title': title,
        'subtitle': subtitle,
        'url': url,
    }


def _date_param(request, name):
    value = request.query_params.get(name)
    return parse_date(value) if value else None


def _decimal(value):
    return value or 0


def _money(value):
    return Decimal(value or 0).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _money_str(value):
    return str(_money(value))


def _percent_str(numerator, denominator):
    if not denominator:
        return '0.00'
    return str((Decimal(numerator) / Decimal(denominator) * Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


def _paid_at_from_date(value):
    if not value:
        return timezone.now()
    return timezone.make_aware(datetime.combine(value, time.min))


def _local_date(value):
    if not value:
        return None
    return timezone.localtime(value).date() if timezone.is_aware(value) else value.date()


def _local_time(value):
    if not value:
        return None
    return timezone.localtime(value).time() if timezone.is_aware(value) else value.time()


REGULAR_MASTER_CLASS_START = time(16, 0)
REGULAR_MASTER_CLASS_END = time(21, 0)


def is_master_class_outside_regular_hours(starts_at):
    local_time = _local_time(starts_at)
    if not local_time:
        return False
    return local_time < REGULAR_MASTER_CLASS_START or local_time >= REGULAR_MASTER_CLASS_END


def normalize_master_class_title(value):
    return re.sub(r'\s+', ' ', (value or '').strip()).casefold()


def _my_param(request):
    return request.query_params.get('my') in ('1', 'true', 'True', 'yes')


def _resolve_payment_method(value, *, required=False):
    if isinstance(value, PaymentMethod):
        method = value
    elif value in (None, ''):
        method = None
    else:
        aliases = {
            'cash': 'cash', 'наличные': 'cash', 'card': 'card', 'terminal': 'card', 'карта': 'card',
            'kaspi': 'kaspi_qr', 'kaspi_qr': 'kaspi_qr', 'transfer': 'transfer', 'перевод': 'transfer',
        }
        normalized = str(value).strip().casefold()
        method = PaymentMethod.objects.filter(pk=value).first() if str(value).isdigit() else None
        if not method:
            method = PaymentMethod.objects.filter(Q(code=aliases.get(normalized, normalized)) | Q(name__iexact=str(value).strip())).first()
    if method and not method.is_active:
        raise ValueError('Выберите активный способ оплаты.')
    if required and not method:
        raise ValueError('Выберите способ оплаты.')
    return method


def _create_income_transaction(
    *,
    client,
    amount,
    source,
    paid_at=None,
    payment_date=None,
    comment,
    created_by=None,
    manager=None,
    subscription=None,
    payment_method=None,
    payment_parts=None,
    branch=None,
    discount=None,
    discount_name='',
    discount_amount=0,
    subtotal_amount=None,
):
    paid_at = paid_at or _paid_at_from_date(payment_date or timezone.localdate())
    finance_transaction = FinanceTransaction.objects.create(
        branch=branch,
        transaction_type=FinanceTransaction.Type.INCOME,
        amount=amount,
        source=source,
        subtotal_amount=subtotal_amount if subtotal_amount is not None else amount,
        discount=discount,
        discount_name=discount_name or (discount.name if discount else ''),
        discount_amount=discount_amount or 0,
        client=client,
        subscription=subscription,
        created_by=created_by,
        manager=manager,
        payment_method=payment_method,
        payment_method_name=payment_method.name if payment_method else '',
        paid_at=paid_at,
        comment=comment,
    )
    sync_finance_payment_parts(finance_transaction, payment_parts, legacy_payment_method=payment_method)
    return finance_transaction


def _master_class_payment_type_name(payment_type):
    return {
        MasterClassPayment.PaymentType.PREPAYMENT: 'Предоплата',
        MasterClassPayment.PaymentType.ADDITIONAL: 'Доплата',
        MasterClassPayment.PaymentType.LEGACY: 'Старая оплата',
    }.get(payment_type, 'Оплата')


def _master_class_payment_comment(master_class, payment_type, comment=''):
    prefix = f'{_master_class_payment_type_name(payment_type)} МК'
    title = f': {master_class.title}' if master_class.title else ''
    suffix = f' · {comment}' if comment else ''
    return f'{prefix}{title}{suffix}'


def _sync_master_class_payment_summary(master_class):
    payments = list(
        MasterClassPayment.objects
        .filter(master_class=master_class)
        .select_related('finance_transaction')
        .order_by('payment_date', 'created_at', 'id')
    )
    if not payments and master_class.finance_transaction_id and FinanceTransaction.objects.filter(pk=master_class.finance_transaction_id).exists():
        return
    paid_total = _money(sum((payment.amount for payment in payments), Decimal('0.00')))
    latest = payments[-1] if payments else None
    latest_transaction = latest.finance_transaction if latest else None
    MasterClass.objects.filter(pk=master_class.pk).update(
        payment_amount=paid_total,
        payment_date=latest.payment_date if latest else None,
        finance_transaction=latest_transaction,
    )
    master_class.payment_amount = paid_total
    master_class.payment_date = latest.payment_date if latest else None
    master_class.finance_transaction = latest_transaction


def _master_class_paid_total_excluding(master_class, exclude_payment_id=None):
    queryset = MasterClassPayment.objects.filter(master_class=master_class)
    if exclude_payment_id:
        queryset = queryset.exclude(pk=exclude_payment_id)
    return _money(queryset.aggregate(total=Sum('amount'))['total'])


def _master_class_remaining_excluding(master_class, exclude_payment_id=None):
    return _money(max(master_class.amount_due - _master_class_paid_total_excluding(master_class, exclude_payment_id), Decimal('0.00')))


def subscription_finance_source(subscription_or_service):
    service = getattr(subscription_or_service, 'service', subscription_or_service)
    if service and getattr(service, 'service_type', None) == CatalogItem.ServiceType.CAMP:
        return 'camp'
    return 'subscription'


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
        and visit.subscription.total_visits > 0
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
        .exclude(service__service_type=CatalogItem.ServiceType.CAMP, total_visits=0)
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
        queryset = super().get_queryset().exclude(name__iregex=r'^\s*(все филиалы|все|all branches|без филиала|не распределено)\s*$')
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
    audit_delete_description = 'Группа отключена'

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        status_value = self.request.query_params.get('status')
        teacher = self.request.query_params.get('teacher')
        manager = self.request.query_params.get('manager')
        subject = self.request.query_params.get('subject')
        search = self.request.query_params.get('search')

        if has_role(self.request.user, TEACHER) and not has_any_role(self.request.user, {MANAGER, ACCOUNTANT}):
            queryset = queryset.filter(teacher=self.request.user)
        if status_value and getattr(self, 'action', None) != 'members':
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
        if group.status == StudyGroup.Status.ACTIVE:
            sync_group_schedule_slots(group)
        self._log_instance(AuditLog.Action.CREATE, group, self.audit_create_description, self._audit_changes())

    def perform_update(self, serializer):
        instance = serializer.instance
        old_schedule = {
            'schedule_days': list(instance.schedule_days or []),
            'start_time': instance.start_time,
            'end_time': instance.end_time,
            'teacher': instance.teacher_id,
            'room': instance.room_id,
            'branch': instance.branch_id,
            'status': instance.status,
        }
        group = serializer.save()
        if group.status == StudyGroup.Status.ACTIVE:
            sync_group_schedule_slots(group, old_schedule=old_schedule)
        else:
            group.schedule_slots.filter(is_active=True).update(is_active=False)

        action_value = AuditLog.Action.GROUP_UPDATE
        description = self.audit_update_description
        if old_schedule['status'] == StudyGroup.Status.ACTIVE and group.status != StudyGroup.Status.ACTIVE:
            action_value = AuditLog.Action.GROUP_DISABLE
            description = 'Группа отключена'
        elif old_schedule['status'] != StudyGroup.Status.ACTIVE and group.status == StudyGroup.Status.ACTIVE:
            action_value = AuditLog.Action.GROUP_ENABLE
            description = 'Группа включена'
        changes = self._audit_changes()
        changes['old_schedule'] = {
            'schedule_days': old_schedule['schedule_days'],
            'start_time': str(old_schedule['start_time']) if old_schedule['start_time'] else None,
            'end_time': str(old_schedule['end_time']) if old_schedule['end_time'] else None,
            'teacher': old_schedule['teacher'],
            'room': old_schedule['room'],
            'branch': old_schedule['branch'],
            'status': old_schedule['status'],
        }
        self._log_instance(action_value, group, description, changes)

    def perform_destroy(self, instance):
        instance.status = StudyGroup.Status.ARCHIVED
        instance.save(update_fields=('status', 'updated_at'))
        instance.schedule_slots.filter(is_active=True).update(is_active=False)
        self._log_instance(AuditLog.Action.GROUP_DISABLE, instance, self.audit_delete_description, {'status': StudyGroup.Status.ARCHIVED})

    def _membership_queryset(self, group, status_value):
        queryset = group.memberships.select_related('client').all()
        if status_value == 'inactive':
            queryset = queryset.exclude(status=GroupMembership.Status.ACTIVE)
        elif status_value != 'all':
            queryset = queryset.filter(status=GroupMembership.Status.ACTIVE)
        return queryset.order_by('client__first_name', 'client__last_name', '-created_at')

    def _membership_response(self, membership, response_status=status.HTTP_200_OK):
        return Response(GroupMembershipSerializer(membership).data, status=response_status)

    def _client_from_request(self, request):
        client_id = request.data.get('client')
        try:
            return Client.objects.get(pk=client_id)
        except (Client.DoesNotExist, TypeError, ValueError):
            return None

    @action(detail=True, methods=['get'], url_path='members')
    def members(self, request, pk=None):
        group = self.get_object()
        status_value = request.query_params.get('status') or 'active'
        if status_value not in {'active', 'inactive', 'all'}:
            return Response({'detail': 'Недопустимый статус состава.'}, status=status.HTTP_400_BAD_REQUEST)
        serializer = GroupMembershipSerializer(self._membership_queryset(group, status_value), many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='add-member')
    def add_member(self, request, pk=None):
        group = self.get_object()
        client = self._client_from_request(request)
        if not client:
            return Response({'detail': 'Выберите ученика.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            memberships = GroupMembership.objects.select_for_update().filter(group=group, client=client)
            active = memberships.filter(status=GroupMembership.Status.ACTIVE).first()
            if active:
                return self._membership_response(active, status.HTTP_400_BAD_REQUEST)
            membership = memberships.order_by('-created_at').first()
            created = False
            if membership:
                membership.status = GroupMembership.Status.ACTIVE
                membership.left_at = None
                if request.data.get('note') is not None:
                    membership.note = request.data.get('note') or ''
                membership.save(update_fields=('status', 'left_at', 'note', 'updated_at'))
            else:
                membership = GroupMembership.objects.create(
                    group=group,
                    client=client,
                    status=GroupMembership.Status.ACTIVE,
                    note=request.data.get('note') or '',
                    joined_at=timezone.localdate(),
                )
                created = True

        log_action(
            request,
            AuditLog.Action.GROUP_MEMBER_ADD if created else AuditLog.Action.GROUP_MEMBER_RESTORE,
            'GroupMembership',
            entity_id=membership.id,
            entity_name=str(membership),
            description='Ученик добавлен в группу' if created else 'Ученик возвращён в группу',
            changes={'group': group.name, 'client': str(client)},
        )
        return self._membership_response(membership, status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='remove-member')
    def remove_member(self, request, pk=None):
        group = self.get_object()
        client = self._client_from_request(request)
        if not client:
            return Response({'detail': 'Выберите ученика.'}, status=status.HTTP_400_BAD_REQUEST)
        membership = GroupMembership.objects.filter(
            group=group,
            client=client,
            status=GroupMembership.Status.ACTIVE,
        ).first()
        if not membership:
            return Response({'detail': 'Активный участник группы не найден.'}, status=status.HTTP_404_NOT_FOUND)

        membership.status = GroupMembership.Status.LEFT
        membership.left_at = timezone.localdate()
        membership.save(update_fields=('status', 'left_at', 'updated_at'))
        log_action(
            request,
            AuditLog.Action.GROUP_MEMBER_REMOVE,
            'GroupMembership',
            entity_id=membership.id,
            entity_name=str(membership),
            description='Ученик убран из группы',
            changes={'group': group.name, 'client': str(client), 'left_at': str(membership.left_at)},
        )
        return self._membership_response(membership)

    @action(detail=True, methods=['post'], url_path='restore-member')
    def restore_member(self, request, pk=None):
        group = self.get_object()
        client = self._client_from_request(request)
        if not client:
            return Response({'detail': 'Выберите ученика.'}, status=status.HTTP_400_BAD_REQUEST)
        membership = (
            GroupMembership.objects.filter(group=group, client=client)
            .exclude(status=GroupMembership.Status.ACTIVE)
            .order_by('-created_at')
            .first()
        )
        if not membership:
            active = GroupMembership.objects.filter(group=group, client=client, status=GroupMembership.Status.ACTIVE).first()
            if active:
                return self._membership_response(active)
            return Response({'detail': 'Бывший участник группы не найден.'}, status=status.HTTP_404_NOT_FOUND)

        membership.status = GroupMembership.Status.ACTIVE
        membership.left_at = None
        membership.save(update_fields=('status', 'left_at', 'updated_at'))
        log_action(
            request,
            AuditLog.Action.GROUP_MEMBER_RESTORE,
            'GroupMembership',
            entity_id=membership.id,
            entity_name=str(membership),
            description='Ученик возвращён в группу',
            changes={'group': group.name, 'client': str(client)},
        )
        return self._membership_response(membership)

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


class GlobalSearchView(APIView):
    permission_classes = (IsAuthenticated,)
    result_limit = 10

    def get(self, request):
        query = request.query_params.get('q', '').strip()
        if len(query) < 2:
            return Response({'query': query, 'total': 0, 'results': []})

        results = []
        user = request.user
        teacher_only = has_role(user, TEACHER) and not has_any_role(user, {MANAGER, ACCOUNTANT}) and not is_admin(user)
        digits = re.sub(r'\D', '', query)

        clients = _search_branch(Client.objects.select_related('branch'), request)
        if teacher_only:
            clients = clients.filter(
                Q(group_memberships__group__teacher=user)
                | Q(trials__teacher=user)
                | Q(master_classes__teacher=user)
                | Q(tasks__assigned_to=user)
            ).distinct()
        client_filter = (
            Q(first_name__icontains=query)
            | Q(last_name__icontains=query)
            | Q(parent_name__icontains=query)
            | Q(phone__icontains=query)
            | Q(email__icontains=query)
        )
        phone_ids = []
        if digits:
            phone_query = f'7{digits[1:]}' if digits.startswith('8') and len(digits) > 1 else digits
            phone_ids = [
                item_id for item_id, phone in clients.values_list('id', 'phone')
                if phone_query in re.sub(r'\D', '', phone or '')
            ]
        matched_clients = clients.filter(client_filter | Q(id__in=phone_ids)).distinct()[:self.result_limit]
        for client in matched_clients:
            subtitle = ' · '.join(filter(None, [f'Родитель: {client.parent_name}' if client.parent_name else '', client.phone, client.email]))
            results.append(_result('client', client, _client_name(client), subtitle, f'/clients/{client.id}'))

        subscriptions = _search_branch(Subscription.objects.select_related('client', 'service'), request)
        if teacher_only:
            subscriptions = subscriptions.filter(client_id__in=clients.values('id'))
        subscription_filter = (
            Q(client__first_name__icontains=query)
            | Q(client__last_name__icontains=query)
            | Q(client__phone__icontains=query)
            | Q(service__name__icontains=query)
            | Q(title__icontains=query)
        )
        if query.isdigit():
            subscription_filter |= Q(id=int(query))
        subscriptions = subscriptions.filter(subscription_filter).distinct()[:self.result_limit]
        for subscription in subscriptions:
            name = subscription.service.name if subscription.service else subscription.title
            results.append(_result(
                'subscription', subscription, f'{name} — {_client_name(subscription.client)}',
                f'Остаток: {subscription.remaining_visits} · {subscription.get_status_display()}',
                f'/subscriptions?client={subscription.client_id}',
            ))

        groups = _search_branch(StudyGroup.objects.select_related('subject', 'teacher', 'manager'), request)
        if teacher_only:
            groups = groups.filter(teacher=user)
        groups = groups.filter(
            Q(name__icontains=query) | Q(subject__name__icontains=query)
            | Q(teacher__first_name__icontains=query) | Q(teacher__last_name__icontains=query)
            | Q(teacher__username__icontains=query) | Q(manager__first_name__icontains=query)
            | Q(manager__last_name__icontains=query) | Q(manager__username__icontains=query)
        ).distinct()[:self.result_limit]
        for group in groups:
            results.append(_result(
                'group', group, group.name,
                ' · '.join(filter(None, [group.subject.name if group.subject else '', _person_name(group.teacher)])),
                f'/groups?group={group.id}',
            ))

        if is_admin(user) or has_role(user, MANAGER):
            employee_ids = []
            lowered = query.casefold()
            role_labels = {'admin': 'администратор', 'manager': 'менеджер', 'teacher': 'преподаватель', 'accountant': 'бухгалтер'}
            for employee in User.objects.select_related('branch').all():
                if not is_admin(user) and not manageable_by_manager(employee):
                    continue
                role_values = employee.get_roles()
                haystack = ' '.join([
                    employee.first_name, employee.last_name, employee.username, employee.email,
                    ' '.join(role_values), ' '.join(role_labels.get(value, value) for value in role_values),
                ]).casefold()
                if lowered in haystack:
                    employee_ids.append(employee.id)
            for employee in User.objects.filter(id__in=employee_ids).order_by('first_name', 'last_name')[:self.result_limit]:
                results.append(_result(
                    'employee', employee, _person_name(employee), ', '.join(employee.get_roles()),
                    f'/employees?employee={employee.id}',
                ))

        trials = _search_branch(Trial.objects.select_related('client'), request)
        if teacher_only:
            trials = trials.filter(teacher=user)
        trials = trials.filter(
            Q(client__first_name__icontains=query) | Q(client__last_name__icontains=query)
            | Q(client__phone__icontains=query) | Q(status__icontains=query) | Q(notes__icontains=query)
        ).distinct()[:self.result_limit]
        for trial in trials:
            results.append(_result('trial', trial, _client_name(trial.client), trial.get_status_display(), f'/trials?trial={trial.id}'))

        tasks = _search_branch(Task.objects.select_related('client'), request)
        if teacher_only:
            tasks = tasks.filter(assigned_to=user)
        if has_any_role(user, {MANAGER, TEACHER}) or is_admin(user):
            tasks = tasks.filter(
                Q(title__icontains=query) | Q(description__icontains=query)
                | Q(client__first_name__icontains=query) | Q(client__last_name__icontains=query)
            ).distinct()[:self.result_limit]
            for task in tasks:
                results.append(_result('task', task, task.title, _client_name(task.client), f'/tasks?task={task.id}'))

        master_classes = _search_branch(MasterClass.objects.prefetch_related('participants'), request)
        if teacher_only:
            master_classes = master_classes.filter(teacher=user)
        master_classes = master_classes.filter(
            Q(title__icontains=query) | Q(description__icontains=query)
            | Q(participants__first_name__icontains=query) | Q(participants__last_name__icontains=query)
        ).distinct()[:self.result_limit]
        for master_class in master_classes:
            participants = ', '.join(str(item) for item in master_class.participants.all()[:2])
            results.append(_result('master_class', master_class, master_class.title, participants, f'/master-classes?master_class={master_class.id}'))

        if has_any_role(user, {MANAGER, ACCOUNTANT}) or is_admin(user):
            finance = _search_branch(FinanceTransaction.objects.select_related('client'), request)
            finance_filter = (
                Q(client__first_name__icontains=query) | Q(client__last_name__icontains=query)
                | Q(comment__icontains=query) | Q(source__icontains=query)
            )
            try:
                finance_filter |= Q(amount=Decimal(query.replace(',', '.')))
            except Exception:
                pass
            if has_role(user, MANAGER) and not has_role(user, ACCOUNTANT) and not is_admin(user):
                finance = finance.filter(transaction_type=FinanceTransaction.Type.INCOME, client__manager=user)
            for operation in finance.filter(finance_filter).distinct()[:self.result_limit]:
                results.append(_result(
                    'finance', operation, f'{operation.amount} · {operation.get_transaction_type_display()}',
                    ' · '.join(filter(None, [_client_name(operation.client), operation.source, operation.comment])),
                    f'/finance?transaction={operation.id}',
                ))

        if has_any_role(user, {MANAGER, ACCOUNTANT}) or is_admin(user):
            branches = Branch.objects.filter(Q(name__icontains=query) | Q(address__icontains=query))
            branch_value = (request.query_params.get('branch') or '').strip()
            if branch_value == 'unassigned':
                branches = branches.none()
            elif branch_value and branch_value != 'all':
                branches = branches.filter(id=int(branch_value))
            for branch in branches[:self.result_limit]:
                results.append(_result('branch', branch, branch.name, branch.address, f'/settings?branch={branch.id}'))

        if has_any_role(user, {MANAGER, TEACHER}) or is_admin(user):
            rooms = _search_branch(Room.objects.select_related('branch'), request).filter(
                Q(name__icontains=query) | Q(branch__name__icontains=query)
            ).distinct()[:self.result_limit]
            for room in rooms:
                results.append(_result('room', room, room.name, room.branch.name if room.branch else 'Без филиала', f'/schedule?room={room.id}'))

        return Response({'query': query, 'total': len(results), 'results': results})


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
        addons = []
        if create_subscription:
            service = CatalogItem.objects.filter(
                pk=request.data.get('service'),
                category=CatalogItem.Category.SERVICE,
                is_active=True,
            ).first()
            if not service:
                return Response({'detail': 'Выберите активную услугу.'}, status=status.HTTP_400_BAD_REQUEST)
            addons = validate_addons_payload(request.data.get('addons', []))

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
                addons_sum = sum((item['catalog_item'].price * item['quantity'] for item in addons), Decimal('0'))
                branch = lesson.branch or lesson.group.branch or client.branch
                discount = Discount.objects.filter(pk=request.data.get('discount')).first() if request.data.get('discount') else None
                discount_result = calculate_discount(price + addons_sum, discount, branch=branch, calculation_date=parse_date(request.data.get('purchase_date') or request.data.get('payment_date') or '') or timezone.localdate())
                payment_amount = Decimal(str(request.data.get('payment_amount') if request.data.get('payment_amount') not in (None, '') else discount_result['total_price']))
                try:
                    payment_method = _resolve_payment_method(request.data.get('payment_method'), required=payment_amount > 0 and request.data.get('payment_parts') is None)
                except ValueError as error:
                    return Response({'payment_method': str(error)}, status=status.HTTP_400_BAD_REQUEST)
                try:
                    payment_parts = validate_payment_parts(request.data.get('payment_parts'), total_amount=payment_amount, legacy_payment_method=payment_method)
                except drf_serializers.ValidationError as error:
                    return Response(error.detail, status=status.HTTP_400_BAD_REQUEST)
                purchase_date = parse_date(request.data.get('purchase_date') or request.data.get('payment_date') or '') or timezone.localdate()
                end_date = parse_date(request.data.get('end_date') or '') or calculate_subscription_end_date(
                    start_date,
                    lessons_count=total_visits,
                    validity_days=service.validity_days,
                    group=lesson.group,
                    service_schedule_days=service.schedule_days,
                )
                created_subscription = Subscription.objects.create(
                    branch=branch,
                    service=service,
                    client=client,
                    title=service.name,
                    start_date=start_date,
                    end_date=end_date,
                    total_visits=total_visits,
                    remaining_visits=remaining_visits,
                    price=price,
                    paid_amount=payment_amount,
                    purchase_date=purchase_date,
                    discount=discount_result['discount'],
                    discount_name=discount_result['discount_name'],
                    discount_type=discount_result['discount_type'],
                    discount_value=discount_result['discount_value'],
                    discount_amount=discount_result['discount_amount'],
                    status=Subscription.Status.ACTIVE,
                )
                sync_subscription_addons(created_subscription, addons)
                if payment_amount > 0:
                    finance_transaction = _create_income_transaction(
                        client=client,
                        amount=payment_amount,
                        source=subscription_finance_source(created_subscription),
                        payment_date=purchase_date,
                        comment=addons_comment(created_subscription, 'Оплата абонемента из посещений'),
                        created_by=request.user,
                        manager=client.manager,
                        subscription=created_subscription,
                        payment_method=payment_method,
                        payment_parts=payment_parts,
                        discount=created_subscription.discount,
                        discount_name=created_subscription.discount_name,
                        discount_amount=created_subscription.discount_amount,
                        subtotal_amount=price + addons_sum,
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
        lessons = apply_branch_filter(lessons, branch)
        slots = apply_branch_filter(slots, branch)

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
    queryset = Client.objects.select_related('manager', 'branch').all()
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
                    'branch': client.branch_id,
                    'branch_name': client.branch.name if client.branch else '',
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
    queryset = Subscription.objects.select_related('client', 'service', 'discount', 'finance_transaction').prefetch_related('subscription_addons').all()
    serializer_class = SubscriptionSerializer
    audit_entity_type = 'Subscription'
    audit_update_description = 'Изменён абонемент'

    def _subscription_audit_changes(self, subscription):
        changes = self._audit_changes()
        changes.update({
            'service': subscription.service.name if subscription.service else subscription.title,
            'addons': [
                {
                    'name': addon.name,
                    'quantity': addon.quantity,
                    'unit_price': str(addon.unit_price),
                    'total_price': str(addon.total_price),
                }
                for addon in subscription.subscription_addons.all()
            ],
            'addons_total': str(total_price(subscription) - Decimal(subscription.price or 0)),
            'discount_name': subscription.discount_name,
            'discount_amount': str(subscription.discount_amount),
            'total_price': str(total_price(subscription)),
            'payment_amount': str(subscription.paid_amount),
            'payment_date': str(subscription.purchase_date or ''),
        })
        return changes

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        status_value = self.request.query_params.get('status')
        client = self.request.query_params.get('client')
        active = self.request.query_params.get('active')
        service_type = self.request.query_params.get('service_type')
        date_from = _date_param(self.request, 'date_from')
        date_to = _date_param(self.request, 'date_to')

        if status_value:
            queryset = queryset.filter(status=status_value)
        if client:
            queryset = queryset.filter(client_id=client)
        if service_type:
            queryset = queryset.filter(service__service_type=service_type)
        if active in ('1', 'true', 'True', 'yes'):
            today = timezone.localdate()
            queryset = queryset.filter(
                status=Subscription.Status.ACTIVE,
            ).filter(
                Q(remaining_visits__gt=0) | Q(service__service_type=CatalogItem.ServiceType.CAMP, total_visits=0)
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
                payment_method = getattr(subscription, 'selected_payment_method', None)
                payment_parts = getattr(subscription, 'selected_payment_parts', None)
                if not payment_method and payment_parts is None:
                    raise drf_serializers.ValidationError({'payment_method': 'Выберите способ оплаты.'})
                finance_transaction = _create_income_transaction(
                    client=subscription.client,
                    amount=subscription.paid_amount,
                    source=subscription_finance_source(subscription),
                    payment_date=subscription.purchase_date,
                    comment=addons_comment(subscription),
                    created_by=self.request.user,
                    manager=subscription.client.manager if subscription.client else None,
                    subscription=subscription,
                    payment_method=payment_method,
                    payment_parts=payment_parts,
                    discount=subscription.discount,
                    discount_name=subscription.discount_name,
                    discount_amount=subscription.discount_amount,
                    subtotal_amount=Decimal(subscription.price or 0) + addons_total(subscription),
                )
                subscription.finance_transaction = finance_transaction
                subscription.save(update_fields=('finance_transaction', 'updated_at'))
            self._log_instance(AuditLog.Action.CREATE, subscription, 'Создан абонемент', self._subscription_audit_changes(subscription))

    def perform_update(self, serializer):
        with transaction.atomic():
            subscription = serializer.save()
            finance_transaction = subscription.finance_transaction
            payment_method = getattr(subscription, 'selected_payment_method', None) or (finance_transaction.payment_method if finance_transaction else None)
            payment_parts = getattr(subscription, 'selected_payment_parts', None)
            if subscription.paid_amount > 0:
                if finance_transaction:
                    finance_transaction.amount = subscription.paid_amount
                    finance_transaction.subtotal_amount = Decimal(subscription.price or 0) + addons_total(subscription)
                    finance_transaction.discount = subscription.discount
                    finance_transaction.discount_name = subscription.discount_name
                    finance_transaction.discount_amount = subscription.discount_amount
                    finance_transaction.client = subscription.client
                    finance_transaction.branch = subscription.branch
                    finance_transaction.manager = subscription.client.manager if subscription.client else None
                    finance_transaction.source = subscription_finance_source(subscription)
                    finance_transaction.comment = addons_comment(subscription)
                    finance_transaction.paid_at = _paid_at_from_date(subscription.purchase_date)
                    finance_transaction.save(update_fields=(
                        'amount', 'subtotal_amount', 'discount', 'discount_name', 'discount_amount',
                        'client', 'branch', 'manager', 'source', 'comment', 'paid_at', 'updated_at',
                    ))
                    if payment_parts is None and finance_transaction.payment_parts.exists():
                        existing_parts = list(finance_transaction.payment_parts.all())
                        if len(existing_parts) == 1:
                            payment_parts = [{'payment_method': existing_parts[0].payment_method_id, 'amount': subscription.paid_amount}]
                        else:
                            payment_parts = [
                                {'payment_method': part.payment_method_id, 'amount': part.amount}
                                for part in existing_parts
                            ]
                    sync_finance_payment_parts(finance_transaction, payment_parts, legacy_payment_method=payment_method)
                else:
                    if not payment_method and payment_parts is None:
                        raise drf_serializers.ValidationError({'payment_method': 'Выберите способ оплаты.'})
                    finance_transaction = _create_income_transaction(
                        client=subscription.client,
                        amount=subscription.paid_amount,
                        source=subscription_finance_source(subscription),
                        payment_date=subscription.purchase_date,
                        comment=addons_comment(subscription),
                        created_by=self.request.user,
                        manager=subscription.client.manager if subscription.client else None,
                        subscription=subscription,
                        payment_method=payment_method,
                        payment_parts=payment_parts,
                        discount=subscription.discount,
                        discount_name=subscription.discount_name,
                        discount_amount=subscription.discount_amount,
                        subtotal_amount=Decimal(subscription.price or 0) + addons_total(subscription),
                    )
                    subscription.finance_transaction = finance_transaction
                    subscription.save(update_fields=('finance_transaction', 'updated_at'))
            elif finance_transaction:
                subscription.finance_transaction = None
                subscription.save(update_fields=('finance_transaction', 'updated_at'))
                finance_transaction.delete()
            self._log_instance(AuditLog.Action.UPDATE, subscription, self.audit_update_description, self._subscription_audit_changes(subscription))


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
            and visit.subscription.total_visits > 0
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
                payment_method = getattr(trial, 'selected_payment_method', None)
                payment_parts = getattr(trial, 'selected_payment_parts', None)
                if not payment_method and payment_parts is None:
                    raise drf_serializers.ValidationError({'payment_method': 'Выберите способ оплаты.'})
                finance_transaction = _create_income_transaction(
                    client=trial.client,
                    amount=trial.price,
                    source='trial',
                    paid_at=_paid_at_from_date(trial.payment_date),
                    comment='Оплата пробника',
                    created_by=self.request.user,
                    manager=trial.manager,
                    payment_method=payment_method,
                    payment_parts=payment_parts,
                )
                trial.finance_transaction = finance_transaction
                trial.save(update_fields=('finance_transaction', 'updated_at'))
            self._log_instance(AuditLog.Action.CREATE, trial, 'Добавлен пробник', self._audit_changes())

    def perform_update(self, serializer):
        previous_status = serializer.instance.status
        with transaction.atomic():
            trial = serializer.save()
            finance_transaction = trial.finance_transaction
            payment_method = getattr(trial, 'selected_payment_method', None) or (finance_transaction.payment_method if finance_transaction else None)
            payment_parts = getattr(trial, 'selected_payment_parts', None)
            if trial.price > 0 and trial.payment_date:
                if finance_transaction:
                    finance_transaction.amount = trial.price
                    finance_transaction.subtotal_amount = trial.price
                    finance_transaction.client = trial.client
                    finance_transaction.branch = trial.branch
                    finance_transaction.manager = trial.manager
                    finance_transaction.source = 'trial'
                    finance_transaction.comment = 'Оплата пробника'
                    finance_transaction.paid_at = _paid_at_from_date(trial.payment_date)
                    finance_transaction.save(update_fields=('amount', 'subtotal_amount', 'client', 'branch', 'manager', 'source', 'comment', 'paid_at', 'updated_at'))
                    if payment_parts is None and finance_transaction.payment_parts.exists():
                        existing_parts = list(finance_transaction.payment_parts.all())
                        if len(existing_parts) == 1:
                            payment_parts = [{'payment_method': existing_parts[0].payment_method_id, 'amount': trial.price}]
                        else:
                            payment_parts = [
                                {'payment_method': part.payment_method_id, 'amount': part.amount}
                                for part in existing_parts
                            ]
                    sync_finance_payment_parts(finance_transaction, payment_parts, legacy_payment_method=payment_method)
                elif payment_method or payment_parts is not None:
                    finance_transaction = _create_income_transaction(
                        client=trial.client,
                        amount=trial.price,
                        source='trial',
                        paid_at=_paid_at_from_date(trial.payment_date),
                        comment='Оплата пробника',
                        created_by=self.request.user,
                        manager=trial.manager,
                        payment_method=payment_method,
                        payment_parts=payment_parts,
                    )
                    trial.finance_transaction = finance_transaction
                    trial.save(update_fields=('finance_transaction', 'updated_at'))
            elif finance_transaction:
                trial.finance_transaction = None
                trial.save(update_fields=('finance_transaction', 'updated_at'))
                finance_transaction.delete()
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

        addons = validate_addons_payload(request.data.get('addons', []))
        title = (service.name if service else None) or request.data.get('subscription_type') or request.data.get('title') or ''
        start_date = parse_date(request.data.get('start_date') or '') or (timezone.localdate() if service else None)
        purchase_date = parse_date(request.data.get('purchase_date') or request.data.get('payment_date') or '') or timezone.localdate()
        total_visits = int(request.data.get('total_visits') or (service.lessons_count if service else 0) or 0)
        price = Decimal(str(request.data.get('price') if request.data.get('price') not in (None, '') else (service.price if service else 0)))
        addons_sum = sum((item['catalog_item'].price * item['quantity'] for item in addons), Decimal('0'))
        branch = trial.branch or trial.client.branch
        discount = Discount.objects.filter(pk=request.data.get('discount')).first() if request.data.get('discount') else None
        discount_result = calculate_discount(price + addons_sum, discount, branch=branch, calculation_date=purchase_date)
        payment_amount = Decimal(str(request.data.get('payment_amount') if request.data.get('payment_amount') not in (None, '') else discount_result['total_price']))
        try:
            payment_method = _resolve_payment_method(request.data.get('payment_method'), required=payment_amount > 0 and request.data.get('payment_parts') is None)
        except ValueError as error:
            return Response({'payment_method': str(error)}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payment_parts = validate_payment_parts(request.data.get('payment_parts'), total_amount=payment_amount, legacy_payment_method=payment_method)
        except drf_serializers.ValidationError as error:
            return Response(error.detail, status=status.HTTP_400_BAD_REQUEST)
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
                branch=branch,
                service=service,
                client=trial.client,
                title=title,
                start_date=start_date,
                end_date=end_date,
                total_visits=total_visits,
                remaining_visits=total_visits,
                price=price,
                paid_amount=payment_amount,
                purchase_date=purchase_date,
                discount=discount_result['discount'],
                discount_name=discount_result['discount_name'],
                discount_type=discount_result['discount_type'],
                discount_value=discount_result['discount_value'],
                discount_amount=discount_result['discount_amount'],
                status=Subscription.Status.ACTIVE,
            )
            sync_subscription_addons(subscription, addons)
            finance_transaction = None
            if payment_amount > 0:
                finance_transaction = _create_income_transaction(
                    client=trial.client,
                    amount=payment_amount,
                    source=subscription_finance_source(subscription),
                    paid_at=_paid_at_from_date(purchase_date),
                    comment=comment or addons_comment(subscription, 'Оплата абонемента после пробного'),
                    created_by=request.user,
                    manager=trial.manager or (trial.client.manager if trial.client else None),
                    subscription=subscription,
                    payment_method=payment_method,
                    payment_parts=payment_parts,
                    discount=subscription.discount,
                    discount_name=subscription.discount_name,
                    discount_amount=subscription.discount_amount,
                    subtotal_amount=price + addons_sum,
                )
                subscription.finance_transaction = finance_transaction
                subscription.save(update_fields=('finance_transaction', 'updated_at'))

            trial.status = Trial.Status.BOUGHT
            trial.bought_subscription = True
            trial.subscription = subscription
            trial.save(update_fields=('status', 'bought_subscription', 'subscription', 'updated_at'))
            trial.source_leads.update(status=Lead.Status.WON, closed_at=timezone.now())

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


def _parse_master_class_starts_at(value):
    if not value:
        return None
    if isinstance(value, datetime):
        starts_at = value
    else:
        starts_at = parse_datetime(str(value))
    if starts_at and timezone.is_naive(starts_at):
        starts_at = timezone.make_aware(starts_at)
    return starts_at


class MasterClassViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, MasterClassPermission)
    queryset = MasterClass.objects.select_related('branch', 'manager', 'teacher', 'discount', 'finance_transaction').prefetch_related(
        'participants',
        'staff_assignments__employee',
        'payments__accepted_by',
        'payments__finance_transaction__payment_method',
        'payments__finance_transaction__payment_parts__payment_method',
    ).all()
    serializer_class = MasterClassSerializer
    audit_entity_type = 'MasterClass'
    audit_update_description = 'Изменён МК'

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        stage = self.request.query_params.get('stage')
        manager = self.request.query_params.get('manager')
        teacher = self.request.query_params.get('teacher')
        client = self.request.query_params.get('client')
        search = self.request.query_params.get('search')
        event_date = _date_param(self.request, 'event_date')
        event_date_from = _date_param(self.request, 'event_date_from')
        event_date_to = _date_param(self.request, 'event_date_to')
        payment_date_from = _date_param(self.request, 'payment_date_from')
        payment_date_to = _date_param(self.request, 'payment_date_to')
        outside_regular_hours_param = self.request.query_params.get('outside_regular_hours')
        extra_work = self.request.query_params.get('extra_work')

        if stage:
            queryset = queryset.filter(stage=stage)
        if manager:
            queryset = queryset.filter(manager_id=manager)
        if teacher:
            queryset = queryset.filter(Q(teacher_id=teacher) | Q(staff_assignments__employee_id=teacher))
        if client:
            queryset = queryset.filter(participants__id=client)
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search)
                | Q(description__icontains=search)
                | Q(participants__first_name__icontains=search)
                | Q(participants__last_name__icontains=search)
                | Q(participants__parent_name__icontains=search)
                | Q(participants__phone__icontains=search)
            )
        if _my_param(self.request):
            queryset = queryset.filter(
                Q(manager=self.request.user)
                | Q(teacher=self.request.user)
                | Q(staff_assignments__employee=self.request.user)
            )
        if event_date:
            queryset = queryset.filter(starts_at__date=event_date)
        if event_date_from:
            queryset = queryset.filter(starts_at__date__gte=event_date_from)
        if event_date_to:
            queryset = queryset.filter(starts_at__date__lte=event_date_to)
        if payment_date_from:
            queryset = queryset.filter(payment_date__gte=payment_date_from)
        if payment_date_to:
            queryset = queryset.filter(payment_date__lte=payment_date_to)
        if extra_work in ('1', 'true', 'True', 'yes', '0', 'false', 'False', 'no'):
            queryset = queryset.filter(is_extra_work=extra_work in ('1', 'true', 'True', 'yes'))
        if outside_regular_hours_param in ('1', 'true', 'True', 'yes', '0', 'false', 'False', 'no'):
            expected = outside_regular_hours_param in ('1', 'true', 'True', 'yes')
            outside_ids = [item.id for item in queryset if is_master_class_outside_regular_hours(item.starts_at) == expected]
            queryset = queryset.filter(id__in=outside_ids)
        return queryset.distinct().order_by('-starts_at')

    @action(detail=False, methods=['post'], url_path='pay-preview')
    def pay_preview(self, request):
        starts_at = _parse_master_class_starts_at(request.data.get('starts_at'))
        duration = request.data.get('duration_minutes')
        duration = int(duration) if duration not in (None, '') else None
        assignments = request.data.get('staff_assignments') or []
        if not isinstance(assignments, list):
            raise drf_serializers.ValidationError({'staff_assignments': 'Передайте список мастеров.'})

        items = []
        for assignment in assignments:
            employee_id = assignment.get('employee')
            if not employee_id:
                continue
            employee = User.objects.filter(pk=employee_id, is_active=True).first()
            if not employee:
                continue
            assignment_duration = assignment.get('duration_minutes')
            effective_duration = int(assignment_duration) if assignment_duration not in (None, '') else duration
            is_extra_work = bool(assignment.get('is_extra_work'))
            regular_minutes = outside_minutes = 0
            if starts_at and effective_duration and effective_duration > 0:
                split = split_work_interval_by_schedule(employee, starts_at, starts_at + timedelta(minutes=effective_duration))
                regular_minutes = split['regular_minutes']
                outside_minutes = split['outside_minutes']

            profile = EmployeePayrollProfile.objects.filter(employee=employee, is_active=True).first()
            rate_configured = bool(profile and (profile.pay_type == EmployeePayrollProfile.PayType.MONTHLY or profile.regular_hourly_rate or profile.outside_hourly_rate or profile.outside_master_class_bonus))
            regular_rate = _money(profile.regular_hourly_rate if profile else 0)
            outside_rate = _money(profile.outside_hourly_rate if profile else 0)
            bonus_rate = _money(profile.outside_master_class_bonus if profile else 0)
            if profile and profile.pay_type == EmployeePayrollProfile.PayType.MONTHLY:
                regular_amount = Decimal('0.00')
            else:
                regular_amount = _money(Decimal(regular_minutes) / Decimal(60) * regular_rate)
            outside_amount = _money(Decimal(outside_minutes) / Decimal(60) * outside_rate)
            bonus = bonus_rate if is_extra_work else Decimal('0.00')
            items.append({
                'employee': employee.id,
                'employee_name': _person_name(employee),
                'effective_duration_minutes': effective_duration,
                'regular_minutes': regular_minutes,
                'outside_minutes': outside_minutes,
                'is_extra_work': is_extra_work,
                'pay_type': profile.pay_type if profile else '',
                'regular_amount': str(regular_amount),
                'outside_amount': str(outside_amount),
                'extra_master_class_bonus': str(bonus),
                'estimated_total': str(_money(regular_amount + outside_amount + bonus)),
                'rate_configured': rate_configured,
            })
        return Response({'items': items})

    @action(detail=False, methods=['post'], url_path='manager-schedule-preview')
    def manager_schedule_preview(self, request):
        starts_at = _parse_master_class_starts_at(request.data.get('starts_at'))
        manager_id = request.data.get('manager')
        duration = request.data.get('duration_minutes')
        duration = int(duration) if duration not in (None, '') else None
        manager = None
        if manager_id not in (None, ''):
            manager = User.objects.filter(pk=manager_id, is_active=True).first()
            if not manager:
                raise drf_serializers.ValidationError({'manager': 'Выберите активного куратора.'})
        return Response(get_employee_schedule_context(manager, starts_at, duration, schedule_cache={}))

    def _duplicate_payload(self, duplicate):
        client = duplicate.participants.first()
        return {
            'id': duplicate.id,
            'client_name': str(client) if client else '',
            'title': duplicate.title,
            'starts_at': duplicate.starts_at.isoformat() if duplicate.starts_at else None,
        }

    def _staff_audit_snapshot(self, master_class):
        return [
            {
                'employee': assignment.employee_id,
                'employee_name': _person_name(assignment.employee),
                'role': assignment.role,
                'is_extra_work': assignment.is_extra_work,
                'duration_minutes': assignment.duration_minutes,
            }
            for assignment in master_class.staff_assignments.select_related('employee').order_by('role', 'employee_id')
        ]

    def _find_duplicate(self, *, client, starts_at, title, exclude_id=None):
        if not client or not starts_at or not title:
            return None
        selected_date = _local_date(starts_at)
        normalized_title = normalize_master_class_title(title)
        queryset = MasterClass.objects.filter(participants=client).prefetch_related('participants')
        if exclude_id:
            queryset = queryset.exclude(pk=exclude_id)
        for item in queryset:
            if _local_date(item.starts_at) == selected_date and normalize_master_class_title(item.title) == normalized_title:
                return item
        return None

    def _raise_duplicate_if_needed(self, *, client, starts_at, title, exclude_id=None):
        duplicate = self._find_duplicate(client=client, starts_at=starts_at, title=title, exclude_id=exclude_id)
        if duplicate:
            raise drf_serializers.ValidationError({
                'detail': 'Такая запись МК уже существует.',
                'duplicate': self._duplicate_payload(duplicate),
            })

    def perform_create(self, serializer):
        with transaction.atomic():
            client = serializer.validated_data.get('client')
            if client:
                client = Client.objects.select_for_update().get(pk=client.pk)
                serializer.validated_data['client'] = client
            self._raise_duplicate_if_needed(
                client=client,
                starts_at=serializer.validated_data.get('starts_at'),
                title=serializer.validated_data.get('title'),
            )
            master_class = serializer.save()
            initial_payment = getattr(master_class, 'selected_initial_payment', None)
            if initial_payment:
                self._create_payment(
                    master_class,
                    initial_payment,
                    payment_type=initial_payment.get('payment_type') or MasterClassPayment.PaymentType.PREPAYMENT,
                )
            if master_class.payment_amount > 0 and not master_class.payment_date:
                master_class.payment_date = timezone.localdate()
                master_class.save(update_fields=('payment_date', 'updated_at'))
            if master_class.payment_amount > 0 and master_class.payment_date and not master_class.finance_transaction_id:
                selected_payment_method = getattr(master_class, 'selected_payment_method', None)
                payment_method = selected_payment_method
                payment_parts = getattr(master_class, 'selected_payment_parts', None)
                if not payment_method and payment_parts is None:
                    raise drf_serializers.ValidationError({'payment_method': 'Выберите способ оплаты.'})
                client = master_class.participants.first()
                finance_transaction = _create_income_transaction(
                    client=client,
                    amount=master_class.payment_amount,
                    source='master_class',
                    payment_date=master_class.payment_date,
                    comment='Оплата МК',
                    created_by=self.request.user,
                    manager=master_class.manager,
                    payment_method=payment_method,
                    payment_parts=payment_parts,
                    branch=master_class.branch,
                    discount=master_class.discount,
                    discount_name=master_class.discount_name,
                    discount_amount=master_class.discount_amount,
                    subtotal_amount=master_class.price,
                )
                master_class.finance_transaction = finance_transaction
                master_class.save(update_fields=('finance_transaction', 'updated_at'))
            self._log_instance(AuditLog.Action.CREATE, master_class, 'Добавлен МК', self._audit_changes())

    def _assert_payment_amount_allowed(self, master_class, amount, *, exclude_payment_id=None):
        remaining_amount = _master_class_remaining_excluding(master_class, exclude_payment_id)
        if amount > remaining_amount:
            raise drf_serializers.ValidationError({
                'detail': 'Сумма оплаты превышает остаток по мастер-классу.',
                'remaining_amount': str(remaining_amount),
            })

    def _create_payment(self, master_class, payment_data, *, payment_type=None):
        amount = _money(payment_data.get('amount'))
        self._assert_payment_amount_allowed(master_class, amount)
        method = payment_data.get('payment_method')
        payment_parts = payment_data.get('_payment_parts', payment_data.get('payment_parts'))
        if not method and payment_parts is None:
            raise drf_serializers.ValidationError({'payment_method': 'Выберите способ оплаты.'})
        payment_date = payment_data.get('payment_date') or timezone.localdate()
        if isinstance(payment_date, str):
            payment_date = parse_date(payment_date) or timezone.localdate()
        resolved_type = payment_type or payment_data.get('payment_type') or MasterClassPayment.PaymentType.ADDITIONAL
        client = master_class.participants.first()
        comment = payment_data.get('comment') or ''
        finance_transaction = _create_income_transaction(
            client=client,
            amount=amount,
            source='master_class',
            payment_date=payment_date,
            comment=_master_class_payment_comment(master_class, resolved_type, comment),
            created_by=self.request.user,
            manager=master_class.manager,
            payment_method=method,
            payment_parts=payment_parts,
            branch=master_class.branch,
            subtotal_amount=amount,
        )
        payment = MasterClassPayment.objects.create(
            master_class=master_class,
            payment_type=resolved_type,
            amount=amount,
            payment_date=payment_date,
            accepted_by=self.request.user,
            finance_transaction=finance_transaction,
            comment=comment,
        )
        _sync_master_class_payment_summary(master_class)
        self._log_instance(
            AuditLog.Action.PAYMENT,
            master_class,
            'Добавлена оплата МК',
            {'payment_id': payment.id, 'amount': str(payment.amount), 'payment_type': payment.payment_type},
        )
        return payment

    def _update_payment_transaction(self, payment, payment_data):
        transaction_item = payment.finance_transaction
        method = payment_data.get('payment_method', transaction_item.payment_method)
        payment_parts = payment_data.get('_payment_parts', None)
        transaction_item.amount = payment.amount
        transaction_item.subtotal_amount = payment.amount
        transaction_item.client = payment.master_class.participants.first()
        transaction_item.branch = payment.master_class.branch
        transaction_item.manager = payment.master_class.manager
        transaction_item.payment_method = method
        transaction_item.payment_method_name = method.name if method else ''
        transaction_item.paid_at = _paid_at_from_date(payment.payment_date)
        transaction_item.source = 'master_class'
        transaction_item.comment = _master_class_payment_comment(payment.master_class, payment.payment_type, payment.comment)
        transaction_item.save(update_fields=(
            'amount',
            'subtotal_amount',
            'client',
            'branch',
            'manager',
            'payment_method',
            'payment_method_name',
            'paid_at',
            'source',
            'comment',
            'updated_at',
        ))
        if payment_parts is None and ('payment_method' in payment_data or 'amount' in payment_data):
            existing_parts = list(transaction_item.payment_parts.all())
            if len(existing_parts) == 1:
                payment_parts = [{'payment_method': existing_parts[0].payment_method_id, 'amount': payment.amount}]
        sync_finance_payment_parts(transaction_item, payment_parts, legacy_payment_method=method)

    @action(detail=True, methods=['get', 'post'], url_path='payments')
    def payments(self, request, pk=None):
        if request.method == 'GET':
            master_class = self.get_object()
            payments = master_class.payments.select_related('accepted_by', 'finance_transaction__payment_method').prefetch_related('finance_transaction__payment_parts__payment_method')
            return Response(MasterClassPaymentSerializer(payments, many=True, context=self.get_serializer_context()).data)

        with transaction.atomic():
            master_class = MasterClass.objects.select_for_update().prefetch_related('participants').get(pk=pk)
            self.check_object_permissions(request, master_class)
            serializer = MasterClassPaymentSerializer(data=request.data, context=self.get_serializer_context())
            serializer.is_valid(raise_exception=True)
            payment_data = dict(serializer.validated_data)
            payment_data['payment_type'] = payment_data.get('payment_type') or MasterClassPayment.PaymentType.ADDITIONAL
            payment = self._create_payment(master_class, payment_data)
        return Response(MasterClassPaymentSerializer(payment, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch', 'delete'], url_path=r'payments/(?P<payment_id>[^/.]+)')
    def payment_detail(self, request, pk=None, payment_id=None):
        with transaction.atomic():
            master_class = MasterClass.objects.select_for_update().prefetch_related('participants').get(pk=pk)
            self.check_object_permissions(request, master_class)
            payment = get_object_or_404(MasterClassPayment.objects.select_for_update().select_related(
                'master_class',
                'finance_transaction__payment_method',
            ).prefetch_related('finance_transaction__payment_parts__payment_method'), pk=payment_id, master_class=master_class)
            if request.method == 'DELETE':
                if not is_admin(request.user):
                    self.permission_denied(request, message='Удалять оплаты МК может только администратор.')
                finance_transaction = payment.finance_transaction
                snapshot = {'payment_id': payment.id, 'amount': str(payment.amount), 'payment_type': payment.payment_type}
                payment.delete()
                finance_transaction.delete()
                _sync_master_class_payment_summary(master_class)
                self._log_instance(AuditLog.Action.PAYMENT, master_class, 'Удалена оплата МК', snapshot)
                return Response(status=status.HTTP_204_NO_CONTENT)

            serializer = MasterClassPaymentSerializer(payment, data=request.data, partial=True, context=self.get_serializer_context())
            serializer.is_valid(raise_exception=True)
            payment_data = dict(serializer.validated_data)
            if 'amount' in payment_data and _money(payment_data['amount']) != payment.amount:
                self._assert_payment_amount_allowed(master_class, _money(payment_data['amount']), exclude_payment_id=payment.id)
            for field in ('payment_type', 'amount', 'payment_date', 'comment'):
                if field in payment_data:
                    setattr(payment, field, payment_data[field])
            payment.save(update_fields=('payment_type', 'amount', 'payment_date', 'comment', 'updated_at'))
            self._update_payment_transaction(payment, payment_data)
            _sync_master_class_payment_summary(master_class)
            self._log_instance(
                AuditLog.Action.PAYMENT,
                master_class,
                'Изменена оплата МК',
                {'payment_id': payment.id, 'amount': str(payment.amount), 'payment_type': payment.payment_type},
            )
        return Response(MasterClassPaymentSerializer(payment, context=self.get_serializer_context()).data)

    def _master_class_payment_comment(self, master_class):
        return f'Оплата МК: {master_class.title}' if master_class.title else 'Оплата МК'

    def _sync_finance_transaction(self, master_class):
        finance_transaction = master_class.finance_transaction
        if master_class.payment_amount <= 0:
            if finance_transaction:
                master_class.finance_transaction = None
                master_class.save(update_fields=('finance_transaction', 'updated_at'))
                finance_transaction.delete()
            return

        if not master_class.payment_date:
            master_class.payment_date = timezone.localdate()
            master_class.save(update_fields=('payment_date', 'updated_at'))

        selected_payment_method = getattr(master_class, 'selected_payment_method', None)
        payment_method = selected_payment_method
        payment_parts = getattr(master_class, 'selected_payment_parts', None)
        if not payment_method and finance_transaction:
            payment_method = finance_transaction.payment_method
        if not payment_method and payment_parts is None:
            raise drf_serializers.ValidationError({'payment_method': 'Выберите способ оплаты.'})

        client = master_class.participants.first()
        comment = self._master_class_payment_comment(master_class)

        if finance_transaction:
            finance_transaction.amount = master_class.payment_amount
            finance_transaction.subtotal_amount = master_class.price
            finance_transaction.discount = master_class.discount
            finance_transaction.discount_name = master_class.discount_name
            finance_transaction.discount_amount = master_class.discount_amount
            finance_transaction.client = client
            finance_transaction.branch = master_class.branch
            finance_transaction.manager = master_class.manager
            finance_transaction.payment_method = payment_method
            finance_transaction.payment_method_name = payment_method.name if payment_method else ''
            finance_transaction.paid_at = _paid_at_from_date(master_class.payment_date)
            finance_transaction.source = 'master_class'
            finance_transaction.comment = comment
            finance_transaction.save(update_fields=(
                'amount',
                'subtotal_amount',
                'discount',
                'discount_name',
                'discount_amount',
                'client',
                'branch',
                'manager',
                'payment_method',
                'payment_method_name',
                'paid_at',
                'source',
                'comment',
                'updated_at',
            ))
            if payment_parts is None and not selected_payment_method and finance_transaction.payment_parts.exists():
                existing_parts = list(finance_transaction.payment_parts.all())
                if len(existing_parts) == 1:
                    payment_parts = [{'payment_method': existing_parts[0].payment_method_id, 'amount': master_class.payment_amount}]
                else:
                    payment_parts = [
                        {'payment_method': part.payment_method_id, 'amount': part.amount}
                        for part in existing_parts
                    ]
            sync_finance_payment_parts(finance_transaction, payment_parts, legacy_payment_method=payment_method)
            return

        finance_transaction = _create_income_transaction(
            client=client,
            amount=master_class.payment_amount,
            source='master_class',
            payment_date=master_class.payment_date,
            comment=comment,
            created_by=self.request.user,
            manager=master_class.manager,
            payment_method=payment_method,
            payment_parts=payment_parts,
            branch=master_class.branch,
            discount=master_class.discount,
            discount_name=master_class.discount_name,
            discount_amount=master_class.discount_amount,
            subtotal_amount=master_class.price,
        )
        master_class.finance_transaction = finance_transaction
        master_class.save(update_fields=('finance_transaction', 'updated_at'))

    def perform_update(self, serializer):
        previous_stage = serializer.instance.stage
        instance = serializer.instance
        before_staff = self._staff_audit_snapshot(instance)
        client = serializer.validated_data.get('client')
        if 'client' not in serializer.validated_data:
            client = instance.participants.first()
        starts_at = serializer.validated_data.get('starts_at', instance.starts_at)
        title = serializer.validated_data.get('title', instance.title)
        with transaction.atomic():
            self._raise_duplicate_if_needed(
                client=client,
                starts_at=starts_at,
                title=title,
                exclude_id=instance.id,
            )
            master_class = serializer.save()
            _sync_master_class_payment_summary(master_class)
        changes = self._audit_changes()
        if previous_stage != master_class.stage:
            changes['stage'] = {'from': previous_stage, 'to': master_class.stage}
        after_staff = self._staff_audit_snapshot(master_class)
        if before_staff != after_staff:
            changes['staff_assignments'] = {'before': before_staff, 'after': after_staff}
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


MONEY = Decimal('0.01')


def _money(value):
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def _certificate_code():
    year = timezone.localdate().year
    alphabet = string.ascii_uppercase + string.digits
    while True:
        suffix = ''.join(random.choice(alphabet) for _ in range(6))
        code = f'CERT-{year}-{suffix}'
        if not GiftCertificate.objects.filter(code=code).exists():
            return code


def _certificate_audit(certificate):
    return {
        'serial_code': certificate.serial_code,
        'code': certificate.code,
        'template': certificate.template_name,
        'face_value': str(certificate.face_value),
        'sale_price': str(certificate.sale_price),
        'client': _client_name(certificate.purchaser_client),
        'recipient_name': certificate.recipient_name,
        'remaining_amount': str(certificate.remaining_amount),
        'payment_parts': payment_parts_audit(certificate.finance_transaction) if certificate.finance_transaction else [],
    }


def _certificate_design_url(asset, request=None):
    if not asset:
        return ''
    path = f'/api/public/certificate-assets/{asset.public_token}/'
    return request.build_absolute_uri(path) if request else path


def _certificate_batch_comment(certificates, quantity):
    numbers = [certificate.serial_code or certificate.code for certificate in certificates]
    if not numbers:
        return 'Продажа сертификатов'
    label = numbers[0] if len(numbers) == 1 else f'{numbers[0]}–{numbers[-1]}'
    return f'Продажа сертификатов {label}, {quantity} шт.'


def _batch_audit(batch):
    certificates = list(batch.certificates.order_by('serial_number'))
    return {
        'purchaser': batch.purchaser_name,
        'purchaser_phone': batch.purchaser_phone_snapshot or batch.purchaser_phone,
        'quantity': batch.quantity,
        'serial_from': certificates[0].serial_code if certificates else '',
        'serial_to': certificates[-1].serial_code if certificates else '',
        'total_face_value': str(batch.total_face_value),
        'total_sale_price': str(batch.total_sale_price),
        'payment_parts': payment_parts_audit(batch.finance_transaction) if batch.finance_transaction else [],
    }


class CertificateDesignAssetViewSet(viewsets.GenericViewSet):
    permission_classes = (IsAuthenticated, CertificatePermission)
    serializer_class = CertificateDesignAssetSerializer
    parser_classes = (MultiPartParser, FormParser)
    queryset = CertificateDesignAsset.objects.all()

    def create(self, request):
        upload = request.FILES.get('file')
        if not upload:
            raise drf_serializers.ValidationError({'file': 'Загрузите файл изображения.'})
        if upload.content_type not in {'image/png', 'image/jpeg', 'image/webp'}:
            raise drf_serializers.ValidationError({'file': 'Можно загрузить только PNG, JPEG или WebP.'})
        if upload.size > 5 * 1024 * 1024:
            raise drf_serializers.ValidationError({'file': 'Размер изображения не должен превышать 5 МБ.'})
        file_data = upload.read()
        digest = hashlib.sha256(file_data).hexdigest()
        asset, created = CertificateDesignAsset.objects.get_or_create(
            sha256=digest,
            defaults={
                'file_name': upload.name,
                'mime_type': upload.content_type,
                'file_size': upload.size,
                'file_data': file_data,
                'created_by': request.user,
            },
        )
        if created:
            log_action(
                request,
                AuditLog.Action.CERTIFICATE_ASSET_UPLOAD,
                'CertificateDesignAsset',
                entity_id=asset.pk,
                entity_name=asset.file_name,
                description='Загружен фон сертификата',
                changes={
                    'file_name': asset.file_name,
                    'mime_type': asset.mime_type,
                    'file_size': asset.file_size,
                    'sha256': asset.sha256,
                },
            )
        status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(self.get_serializer(asset).data, status=status_code)


class CertificateTemplateViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, CertificatePermission)
    serializer_class = CertificateTemplateSerializer
    queryset = CertificateTemplate.objects.all()
    audit_entity_type = 'CertificateTemplate'

    def perform_create(self, serializer):
        instance = serializer.save()
        self._log_instance(AuditLog.Action.CERTIFICATE_TEMPLATE_CREATE, instance, '?????? ?????? ???????????', self._audit_changes())

    def perform_update(self, serializer):
        instance = serializer.save()
        self._log_instance(AuditLog.Action.CERTIFICATE_TEMPLATE_UPDATE, instance, '??????? ?????? ???????????', self._audit_changes())

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=('is_active', 'updated_at'))
        self._log_instance(AuditLog.Action.CERTIFICATE_TEMPLATE_DISABLE, instance, '?????? ??????????? ????????', {'is_active': False})


class GiftCertificateViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, CertificatePermission)
    serializer_class = GiftCertificateSerializer
    audit_entity_type = 'GiftCertificate'

    def get_queryset(self):
        queryset = GiftCertificate.objects.select_related(
            'template', 'template__background_asset', 'batch', 'background_asset',
            'purchaser_client', 'finance_transaction', 'created_by',
        ).prefetch_related('redemptions__created_by', 'finance_transaction__payment_parts__payment_method')
        search = self.request.query_params.get('search')
        status_value = self.request.query_params.get('status')
        template = self.request.query_params.get('template')
        client = self.request.query_params.get('client')
        date_from = _date_param(self.request, 'date_from')
        date_to = _date_param(self.request, 'date_to')
        valid_from = _date_param(self.request, 'valid_until_from')
        valid_to = _date_param(self.request, 'valid_until_to')
        if search:
            search_clean = search.strip()
            serial_number = None
            serial_match = re.match(r'^n?0*(\d+)$', search_clean, flags=re.IGNORECASE)
            if serial_match:
                serial_number = int(serial_match.group(1))
            search_filter = (
                Q(code__icontains=search)
                | Q(batch__purchaser_name__icontains=search)
                | Q(batch__purchaser_phone__icontains=search)
                | Q(batch__purchaser_phone_snapshot__icontains=search)
                | Q(recipient_name__icontains=search)
                | Q(recipient_phone__icontains=search)
                | Q(template_name__icontains=search)
                | Q(purchaser_client__first_name__icontains=search)
                | Q(purchaser_client__last_name__icontains=search)
                | Q(purchaser_client__parent_name__icontains=search)
                | Q(purchaser_client__phone__icontains=search)
                | Q(redemptions__visitor_name__icontains=search)
                | Q(redemptions__visitor_phone__icontains=search)
            )
            if serial_number is not None:
                search_filter |= Q(serial_number=serial_number)
            queryset = queryset.filter(search_filter)
        if status_value:
            queryset = queryset.filter(status=status_value)
        if template:
            queryset = queryset.filter(template_id=template)
        if client:
            queryset = queryset.filter(purchaser_client_id=client)
        if date_from:
            queryset = queryset.filter(issued_at__gte=date_from)
        if date_to:
            queryset = queryset.filter(issued_at__lte=date_to)
        if valid_from:
            queryset = queryset.filter(valid_until__gte=valid_from)
        if valid_to:
            queryset = queryset.filter(valid_until__lte=valid_to)
        for certificate in queryset.filter(status__in=[GiftCertificate.Status.ACTIVE, GiftCertificate.Status.PARTIALLY_USED], valid_until__lt=timezone.localdate()):
            refresh_certificate_status(certificate)
        return queryset.distinct()

    def _sync_finance(self, certificate, payment_parts):
        if certificate.sale_price <= 0:
            return None
        if certificate.finance_transaction_id:
            finance_transaction = certificate.finance_transaction
            finance_transaction.amount = certificate.sale_price
            finance_transaction.subtotal_amount = certificate.face_value
            finance_transaction.discount_amount = certificate.face_value - certificate.sale_price
            finance_transaction.discount_name = f'?????? ??????????? {certificate.sale_discount_percent}%'
            finance_transaction.client = certificate.purchaser_client
            finance_transaction.source = 'certificate'
            finance_transaction.comment = f'Продажа сертификата {certificate.serial_code or certificate.code}'
            finance_transaction.paid_at = _paid_at_from_date(certificate.issued_at)
            finance_transaction.save(update_fields=(
                'amount', 'subtotal_amount', 'discount_amount', 'discount_name',
                'client', 'source', 'comment', 'paid_at', 'updated_at',
            ))
        else:
            finance_transaction = FinanceTransaction.objects.create(
                transaction_type=FinanceTransaction.Type.INCOME,
                source='certificate',
                amount=certificate.sale_price,
                subtotal_amount=certificate.face_value,
                discount_amount=certificate.face_value - certificate.sale_price,
                discount_name=f'?????? ??????????? {certificate.sale_discount_percent}%',
                client=certificate.purchaser_client,
                created_by=self.request.user,
                paid_at=_paid_at_from_date(certificate.issued_at),
                comment=f'Продажа сертификата {certificate.serial_code or certificate.code}',
            )
            certificate.finance_transaction = finance_transaction
            certificate.save(update_fields=('finance_transaction', 'updated_at'))
        if payment_parts is None and finance_transaction.payment_parts.exists():
            existing_parts = list(finance_transaction.payment_parts.all())
            if len(existing_parts) == 1:
                payment_parts = [{'payment_method': existing_parts[0].payment_method_id, 'amount': certificate.sale_price}]
            else:
                payment_parts = [{'payment_method': part.payment_method_id, 'amount': part.amount} for part in existing_parts]
        sync_finance_payment_parts(finance_transaction, payment_parts)
        return finance_transaction

    def perform_create(self, serializer):
        with transaction.atomic():
            template = serializer.validated_data['template']
            issued_at = serializer.validated_data.get('issued_at') or timezone.localdate()
            sale_price = serializer.validated_data['_calculated_sale_price']
            snapshot = serializer.validated_data['_template_snapshot']
            serial_number = allocate_certificate_numbers(1)[0]
            purchaser_client = serializer.validated_data.get('purchaser_client')
            purchaser_name = _client_name(purchaser_client)
            purchaser_phone = purchaser_client.phone if purchaser_client else ''
            face_value = serializer.validated_data['face_value']
            batch = CertificateBatch.objects.create(
                purchaser_client=purchaser_client,
                purchaser_name=purchaser_name,
                purchaser_phone=purchaser_phone,
                purchaser_phone_snapshot=purchaser_phone,
                template=template,
                template_name=template.name,
                template_snapshot=snapshot,
                quantity=1,
                face_value_per_certificate=face_value,
                sale_price_per_certificate=sale_price,
                total_face_value=face_value,
                total_sale_price=sale_price,
                issued_at=issued_at,
                created_by=self.request.user,
            )
            certificate = serializer.save(
                batch=batch,
                serial_number=serial_number,
                code=_certificate_code(),
                template_name=template.name,
                template_snapshot=snapshot,
                sale_discount_percent=template.sale_discount_percent,
                sale_price=sale_price,
                remaining_amount=serializer.validated_data['face_value'],
                issued_at=issued_at,
                valid_until=issued_at + timedelta(days=template.validity_days),
                status=GiftCertificate.Status.ACTIVE,
                background_asset=template.background_asset,
                created_by=self.request.user,
            )
            finance_transaction = self._sync_finance(certificate, serializer.validated_data.get('_payment_parts'))
            if finance_transaction:
                batch.finance_transaction = finance_transaction
                batch.save(update_fields=('finance_transaction', 'updated_at'))
            self._log_instance(AuditLog.Action.CERTIFICATE_CREATE, certificate, '?????? ??????????', _certificate_audit(certificate))
            self._log_instance(AuditLog.Action.CERTIFICATE_BATCH_CREATE, batch, 'Создана партия сертификатов', _batch_audit(batch))

    def perform_update(self, serializer):
        with transaction.atomic():
            certificate = serializer.save()
            payment_parts = serializer.validated_data.get('_payment_parts', None)
            if certificate.sale_price > 0:
                self._sync_finance(certificate, payment_parts)
            self._log_instance(AuditLog.Action.CERTIFICATE_UPDATE, certificate, '??????? ??????????', _certificate_audit(certificate))

    @action(detail=True, methods=['post'])
    def redeem(self, request, pk=None):
        certificate = refresh_certificate_status(self.get_object())
        amount = _money(request.data.get('amount'))
        if certificate.status not in {GiftCertificate.Status.ACTIVE, GiftCertificate.Status.PARTIALLY_USED}:
            raise drf_serializers.ValidationError({'status': '?????????? ?????? ???????????? ? ??????? ???????.'})
        if amount <= 0:
            raise drf_serializers.ValidationError({'amount': '????? ???????? ?????? ???? ?????? ????.'})
        if amount > certificate.remaining_amount:
            raise drf_serializers.ValidationError({'amount': '????? ???????? ????????? ??????? ???????????.'})
        with transaction.atomic():
            certificate.remaining_amount = _money(certificate.remaining_amount - amount)
            certificate.status = GiftCertificate.Status.USED if certificate.remaining_amount == 0 else GiftCertificate.Status.PARTIALLY_USED
            update_fields = ['remaining_amount', 'status', 'updated_at']
            visitor_name = (request.data.get('visitor_name') or '').strip()
            visitor_phone = (request.data.get('visitor_phone') or '').strip()
            if visitor_name and not certificate.recipient_name:
                certificate.recipient_name = visitor_name
                update_fields.append('recipient_name')
            if visitor_phone and not certificate.recipient_phone:
                certificate.recipient_phone = visitor_phone
                update_fields.append('recipient_phone')
            certificate.save(update_fields=tuple(update_fields))
            redemption = CertificateRedemption.objects.create(
                certificate=certificate,
                amount=amount,
                visitor_name=visitor_name,
                visitor_phone=visitor_phone,
                service_name=(request.data.get('service_name') or '').strip(),
                remaining_amount_after=certificate.remaining_amount,
                comment=request.data.get('comment', ''),
                created_by=request.user,
            )
            self._log_instance(AuditLog.Action.CERTIFICATE_VISIT_CREATE, certificate, 'Зафиксировано посещение по сертификату', {
                **_certificate_audit(certificate),
                'redeemed_amount': str(amount),
                'visitor_name': visitor_name,
                'visitor_phone': visitor_phone,
                'service_name': redemption.service_name,
                'remaining_amount_after': str(certificate.remaining_amount),
            })
        return Response({'certificate': self.get_serializer(certificate).data, 'redemption': CertificateRedemptionSerializer(redemption).data})

    @action(detail=False, methods=['post'], url_path='bulk-create')
    def bulk_create(self, request):
        data = request.data
        quantity = int(data.get('quantity') or 0)
        if quantity < 1 or quantity > 100:
            raise drf_serializers.ValidationError({'quantity': 'Количество должно быть от 1 до 100.'})
        template = CertificateTemplate.objects.filter(pk=data.get('template'), is_active=True).select_related('background_asset').first()
        if not template:
            raise drf_serializers.ValidationError({'template': 'Выберите активный шаблон сертификата.'})
        purchaser_client = Client.objects.filter(pk=data.get('purchaser_client')).first() if data.get('purchaser_client') else None
        purchaser_name = (data.get('purchaser_name') or _client_name(purchaser_client)).strip()
        purchaser_phone = (data.get('purchaser_phone') or (purchaser_client.phone if purchaser_client else '')).strip()
        if not purchaser_client and (not purchaser_name or not purchaser_phone):
            raise drf_serializers.ValidationError({'purchaser': 'Укажите клиента-покупателя или имя и телефон покупателя.'})
        face_value = _money(data.get('face_value'))
        if face_value <= 0:
            raise drf_serializers.ValidationError({'face_value': 'Номинал должен быть больше нуля.'})
        if template.amount_type == CertificateTemplate.AmountType.FIXED and face_value != _money(template.fixed_amount):
            raise drf_serializers.ValidationError({'face_value': 'Номинал должен совпадать с фиксированным номиналом шаблона.'})
        if template.amount_type == CertificateTemplate.AmountType.RANGE:
            if face_value < _money(template.min_amount):
                raise drf_serializers.ValidationError({'face_value': 'Номинал меньше минимального значения шаблона.'})
            if template.max_amount is not None and face_value > _money(template.max_amount):
                raise drf_serializers.ValidationError({'face_value': 'Номинал больше максимального значения шаблона.'})
        issued_at = parse_date(data.get('issued_at') or '') or timezone.localdate()
        discount = Decimal(template.sale_discount_percent or 0)
        sale_price = _money(face_value * (Decimal('100') - discount) / Decimal('100'))
        total_face_value = _money(face_value * quantity)
        total_sale_price = _money(sale_price * quantity)
        payment_parts = validate_payment_parts(data.get('payment_parts'), total_amount=total_sale_price) if total_sale_price > 0 else []
        snapshot = certificate_template_snapshot(template)

        with transaction.atomic():
            numbers = allocate_certificate_numbers(quantity, data.get('start_number'))
            batch = CertificateBatch.objects.create(
                purchaser_client=purchaser_client,
                purchaser_name=purchaser_name,
                purchaser_phone=purchaser_phone,
                purchaser_phone_snapshot=purchaser_phone,
                template=template,
                template_name=template.name,
                template_snapshot=snapshot,
                quantity=quantity,
                face_value_per_certificate=face_value,
                sale_price_per_certificate=sale_price,
                total_face_value=total_face_value,
                total_sale_price=total_sale_price,
                issued_at=issued_at,
                created_by=request.user,
            )
            certificates = []
            for number in numbers:
                certificates.append(GiftCertificate.objects.create(
                    batch=batch,
                    template=template,
                    template_name=template.name,
                    template_snapshot=snapshot,
                    serial_number=number,
                    code=_certificate_code(),
                    public_token=uuid.uuid4(),
                    purchaser_client=purchaser_client,
                    recipient_name='',
                    recipient_phone='',
                    face_value=face_value,
                    sale_discount_percent=template.sale_discount_percent,
                    sale_price=sale_price,
                    remaining_amount=face_value,
                    issued_at=issued_at,
                    valid_until=issued_at + timedelta(days=template.validity_days),
                    status=GiftCertificate.Status.ACTIVE,
                    finance_transaction=None,
                    background_asset=template.background_asset,
                    created_by=request.user,
                ))
            finance_transaction = None
            if total_sale_price > 0:
                finance_transaction = FinanceTransaction.objects.create(
                    transaction_type=FinanceTransaction.Type.INCOME,
                    source='certificate',
                    amount=total_sale_price,
                    subtotal_amount=total_face_value,
                    discount_amount=total_face_value - total_sale_price,
                    discount_name=f'Скидка сертификата {template.sale_discount_percent}%',
                    client=purchaser_client,
                    created_by=request.user,
                    paid_at=_paid_at_from_date(issued_at),
                    comment=_certificate_batch_comment(certificates, quantity),
                )
                sync_finance_payment_parts(finance_transaction, payment_parts)
                batch.finance_transaction = finance_transaction
                batch.save(update_fields=('finance_transaction', 'updated_at'))
                GiftCertificate.objects.filter(pk__in=[certificate.pk for certificate in certificates]).update(finance_transaction=finance_transaction)
                for certificate in certificates:
                    certificate.finance_transaction = finance_transaction
            self._log_instance(AuditLog.Action.CERTIFICATE_BATCH_CREATE, batch, 'Создана партия сертификатов', _batch_audit(batch))
        return Response(
            {
                'batch': CertificateBatchSerializer(batch, context={'request': request}).data,
                'certificates': GiftCertificateSerializer(certificates, many=True, context={'request': request}).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        certificate = self.get_object()
        certificate.status = GiftCertificate.Status.CANCELLED
        certificate.save(update_fields=('status', 'updated_at'))
        self._log_instance(AuditLog.Action.CERTIFICATE_CANCEL, certificate, '?????????? ???????', _certificate_audit(certificate))
        return Response(self.get_serializer(certificate).data)

    @action(detail=True, methods=['post'], url_path='mark-sent')
    def mark_sent(self, request, pk=None):
        certificate = self.get_object()
        phone = request.data.get('phone') or certificate.recipient_phone
        certificate.sent_at = timezone.now()
        certificate.sent_to_phone = phone
        certificate.save(update_fields=('sent_at', 'sent_to_phone', 'updated_at'))
        self._log_instance(AuditLog.Action.CERTIFICATE_WHATSAPP_OPEN, certificate, '??????? ??? ???????? ? WhatsApp', {
            'code': certificate.code,
            'sent_to_phone': phone,
        })
        return Response(self.get_serializer(certificate).data)


class PublicGiftCertificateView(APIView):
    permission_classes = ()
    authentication_classes = ()

    def get(self, request, public_token):
        certificate = GiftCertificate.objects.filter(public_token=public_token).first()
        if not certificate:
            return Response({'detail': '?????????? ?? ??????.'}, status=status.HTTP_404_NOT_FOUND)
        certificate = refresh_certificate_status(certificate)
        return Response(PublicGiftCertificateSerializer(certificate).data)


class MetaWebhookView(APIView):
    permission_classes = ()
    authentication_classes = ()

    def get(self, request):
        if request.query_params.get('hub.mode') == 'subscribe' and request.query_params.get('hub.verify_token') == getattr(settings, 'META_WEBHOOK_VERIFY_TOKEN', ''):
            return HttpResponse(request.query_params.get('hub.challenge', ''), content_type='text/plain')
        return Response({'detail': 'Invalid verify token.'}, status=status.HTTP_403_FORBIDDEN)

    def post(self, request):
        if not verify_meta_signature(request.body, request.META.get('HTTP_X_HUB_SIGNATURE_256', '')):
            return Response({'detail': 'Invalid Meta signature.'}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            payload = request.data if isinstance(request.data, dict) else {}
            leads = process_meta_webhook(request, payload)
            return Response({'ok': True, 'created_or_updated': len(leads)})
        except Exception as exc:
            log_action(request, AuditLog.Action.META_WEBHOOK_ERROR, 'MetaWebhook', description='Meta webhook processing error', changes={'error': str(exc)})
            return Response({'ok': True})


class MetaIntegrationStatusView(APIView):
    permission_classes = (IsAuthenticated, MessagingChannelPermission)

    def get(self, request):
        def provider_payload(provider):
            channels = MessagingChannel.objects.filter(provider=provider)
            last_event = MetaWebhookEvent.objects.filter(provider=provider).order_by('-created_at').first()
            last_error_event = MetaWebhookEvent.objects.filter(provider=provider).exclude(processing_error='').order_by('-created_at').first()
            return {
                'configured': channels.filter(is_active=True).exists(),
                'channel_count': channels.count(),
                'last_event_at': last_event.created_at if last_event else None,
                'last_error': (last_error_event.processing_error if last_error_event else ''),
            }
        return Response({
            'webhook_configured': bool(getattr(settings, 'META_WEBHOOK_VERIFY_TOKEN', '')),
            'app_secret_configured': bool(getattr(settings, 'META_APP_SECRET', '')),
            'app_id_configured': bool(getattr(settings, 'META_APP_ID', '')),
            'embedded_signup_configured': bool(getattr(settings, 'META_WHATSAPP_CONFIG_ID', '')),
            'public_config': {
                'app_id': getattr(settings, 'META_APP_ID', ''),
                'whatsapp_config_id': getattr(settings, 'META_WHATSAPP_CONFIG_ID', ''),
                'graph_api_version': getattr(settings, 'META_GRAPH_API_VERSION', 'v20.0'),
            },
            'whatsapp': provider_payload(MessagingChannel.Provider.WHATSAPP),
            'instagram': provider_payload(MessagingChannel.Provider.INSTAGRAM),
        })


class MetaEmbeddedSignupCompleteView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        if not is_admin(request.user):
            return Response({'detail': 'Нет доступа к подключению WhatsApp Business.'}, status=status.HTTP_403_FORBIDDEN)

        code = str(request.data.get('code') or '').strip()
        waba_id = str(request.data.get('waba_id') or '').strip()
        phone_number_id = str(request.data.get('phone_number_id') or '').strip()
        business_id = str(request.data.get('business_id') or '').strip()
        if not code:
            raise drf_serializers.ValidationError({'code': 'Authorization code обязателен.'})
        if not waba_id:
            raise drf_serializers.ValidationError({'waba_id': 'WABA ID обязателен.'})
        if not getattr(settings, 'META_APP_ID', '') or not getattr(settings, 'META_APP_SECRET', ''):
            return Response({'detail': 'Meta App ID или App Secret не настроены.'}, status=status.HTTP_400_BAD_REQUEST)

        branch = None
        branch_id = request.data.get('branch')
        if branch_id not in (None, '', 'all', 'unassigned'):
            branch = Branch.objects.filter(pk=branch_id).first()
            if not branch:
                raise drf_serializers.ValidationError({'branch': 'Филиал не найден.'})

        default_manager = None
        default_manager_id = request.data.get('default_manager')
        if default_manager_id not in (None, ''):
            default_manager = User.objects.filter(pk=default_manager_id, is_active=True).first()
            if not default_manager or not (is_admin(default_manager) or has_role(default_manager, MANAGER)):
                raise drf_serializers.ValidationError({'default_manager': 'Выберите активного менеджера.'})

        try:
            access_token = exchange_embedded_signup_code(code)
            subscribe_whatsapp_app(waba_id, access_token)
            if phone_number_id:
                phone_number_data = get_whatsapp_phone_number(phone_number_id, access_token)
            else:
                phone_numbers = get_whatsapp_phone_numbers(waba_id, access_token)
                if len(phone_numbers) > 1:
                    return Response(
                        {
                            'detail': 'В аккаунте WhatsApp найдено несколько номеров.',
                            'phone_numbers': phone_numbers,
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
                if not phone_numbers:
                    return Response({'detail': 'В аккаунте WhatsApp не найден номер.'}, status=status.HTTP_400_BAD_REQUEST)
                phone_number_data = phone_numbers[0]
                phone_number_id = str(phone_number_data.get('id') or '').strip()
        except MetaApiError as error:
            response_payload = {'detail': 'Meta не завершила подключение WhatsApp.'}
            if error.code:
                response_payload['meta_error_code'] = error.code
            response_status = status.HTTP_400_BAD_REQUEST if error.status_code == 400 else status.HTTP_502_BAD_GATEWAY
            return Response(response_payload, status=response_status)

        verified_phone_number_id = str(phone_number_data.get('id') or phone_number_id).strip()
        if not verified_phone_number_id:
            return Response({'detail': 'Meta не вернула Phone Number ID.'}, status=status.HTTP_400_BAD_REQUEST)
        display_phone_number = phone_number_data.get('display_phone_number') or ''
        verified_name = phone_number_data.get('verified_name') or ''
        channel_name = f'WhatsApp · {verified_name or display_phone_number or verified_phone_number_id}'

        channel, _created = MessagingChannel.objects.update_or_create(
            provider=MessagingChannel.Provider.WHATSAPP,
            external_account_id=verified_phone_number_id,
            defaults={
                'name': channel_name,
                'phone_number': display_phone_number,
                'branch': branch,
                'default_manager': default_manager,
                'is_active': True,
                'last_error': '',
            },
        )
        log_action(
            request,
            AuditLog.Action.MESSAGING_CHANNEL_CREATE,
            'MessagingChannel',
            entity_id=channel.id,
            entity_name=str(channel),
            description='WhatsApp Business подключён через Embedded Signup',
            changes={
                'provider': channel.provider,
                'waba_id': waba_id,
                'phone_number_id': verified_phone_number_id,
                'business_id': business_id,
                'branch': branch.id if branch else None,
                'default_manager': default_manager.id if default_manager else None,
            },
        )
        return Response({
            'success': True,
            'channel': MessagingChannelSerializer(channel).data,
            'waba_id': waba_id,
            'phone_number_id': verified_phone_number_id,
            'phone_number': display_phone_number,
            'verified_name': verified_name,
        })


class PublicCertificateAssetView(APIView):
    permission_classes = ()
    authentication_classes = ()

    def get(self, request, public_token):
        asset = CertificateDesignAsset.objects.filter(public_token=public_token).first()
        if not asset:
            return Response({'detail': 'Файл не найден.'}, status=status.HTTP_404_NOT_FOUND)
        response = HttpResponse(bytes(asset.file_data), content_type=asset.mime_type)
        response['Cache-Control'] = 'public, max-age=31536000, immutable'
        return response


class MessagingChannelViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, MessagingChannelPermission)
    serializer_class = MessagingChannelSerializer
    queryset = MessagingChannel.objects.select_related('branch', 'default_manager').all()
    audit_entity_type = 'MessagingChannel'

    def perform_create(self, serializer):
        instance = serializer.save()
        self._log_instance(AuditLog.Action.MESSAGING_CHANNEL_CREATE, instance, 'Создан канал мессенджера', self._audit_changes())

    def perform_update(self, serializer):
        instance = serializer.save()
        self._log_instance(AuditLog.Action.MESSAGING_CHANNEL_UPDATE, instance, 'Изменён канал мессенджера', self._audit_changes())


class LeadViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, LeadPermission)
    serializer_class = LeadSerializer
    audit_entity_type = 'Lead'

    def _normalized_phone(self, value):
        return normalize_kz_phone(value).strip()

    def _find_client_by_phone(self, phone):
        normalized = self._normalized_phone(phone)
        if not normalized:
            return None
        client = Client.objects.filter(phone=normalized).first()
        if client:
            return client
        for client in Client.objects.all():
            if self._normalized_phone(client.phone) == normalized:
                return client
        return None

    def _find_active_lead_by_phone(self, phone, client=None):
        normalized = self._normalized_phone(phone)
        if not normalized and not client:
            return None
        queryset = Lead.objects.select_related('client').filter(status__in=Lead.ACTIVE_STATUSES)
        for lead in queryset:
            if normalized and self._normalized_phone(lead.contact_phone) == normalized:
                return lead
            if client and lead.client_id == client.id:
                return lead
            if normalized and lead.client_id and self._normalized_phone(lead.client.phone) == normalized:
                return lead
        return None

    def _lead_duplicate_response(self, lead):
        return Response(
            {
                'detail': 'У этого контакта уже есть активное обращение.',
                'existing_lead': {
                    'id': lead.id,
                    'contact_name': lead.contact_name,
                    'contact_phone': lead.contact_phone,
                    'status': lead.status,
                },
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    def _resolve_manual_manager(self, manager_id):
        if manager_id in (None, ''):
            if has_role(self.request.user, MANAGER):
                return self.request.user
            return None
        manager = User.objects.filter(pk=manager_id, is_active=True).first()
        if not manager or not (is_admin(manager) or has_role(manager, MANAGER)):
            raise drf_serializers.ValidationError({'manager': 'Выберите активного менеджера.'})
        return manager

    def _resolve_branch(self, branch_id):
        if branch_id in (None, '', 'all', 'unassigned'):
            return None
        branch = Branch.objects.filter(pk=branch_id).first()
        if not branch:
            raise drf_serializers.ValidationError({'branch': 'Филиал не найден.'})
        return branch

    def _truthy(self, value):
        return value is True or str(value).lower() in {'1', 'true', 'yes', 'on'}

    def get_queryset(self):
        queryset = (
            Lead.objects
            .select_related('channel', 'contact', 'client', 'manager', 'branch', 'converted_trial')
            .prefetch_related('messages')
            .all()
        )
        if has_role(self.request.user, MANAGER) and not is_admin(self.request.user):
            queryset = queryset.filter(Q(manager=self.request.user) | Q(manager__isnull=True))
        search = self.request.query_params.get('search')
        source = self.request.query_params.get('source')
        status_value = self.request.query_params.get('status')
        manager = self.request.query_params.get('manager')
        branch = self.request.query_params.get('branch')
        client = self.request.query_params.get('client')
        unread = self.request.query_params.get('unread')
        date_from = _date_param(self.request, 'date_from')
        date_to = _date_param(self.request, 'date_to')
        if search:
            queryset = queryset.filter(
                Q(contact_name__icontains=search)
                | Q(contact_phone__icontains=search)
                | Q(contact_username__icontains=search)
                | Q(first_message__icontains=search)
                | Q(last_message__icontains=search)
                | Q(messages__text__icontains=search)
                | Q(client__first_name__icontains=search)
                | Q(client__last_name__icontains=search)
                | Q(client__parent_name__icontains=search)
                | Q(client__phone__icontains=search)
            )
        if source:
            queryset = queryset.filter(source=source)
        if status_value:
            queryset = queryset.filter(status=status_value)
        if manager and manager != 'all':
            queryset = queryset.filter(manager__isnull=True) if manager == 'unassigned' else queryset.filter(manager_id=manager)
        if branch and branch != 'all':
            queryset = queryset.filter(branch__isnull=True) if branch == 'unassigned' else queryset.filter(branch_id=branch)
        if client:
            queryset = queryset.filter(client_id=client)
        if unread in {'1', 'true', 'yes'}:
            queryset = queryset.filter(unread_count__gt=0)
        if date_from:
            queryset = queryset.filter(first_message_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(first_message_at__date__lte=date_to)
        return queryset.distinct()

    @action(detail=False, methods=['post'], url_path='manual-create')
    def manual_create(self, request):
        contact_name = str(request.data.get('contact_name') or '').strip()
        contact_phone = self._normalized_phone(request.data.get('contact_phone') or request.data.get('phone') or '')
        first_message = str(request.data.get('first_message') or request.data.get('comment') or '').strip()
        if not contact_name and not contact_phone:
            raise drf_serializers.ValidationError({'detail': 'Укажите имя или телефон обратившегося.'})

        manager = self._resolve_manual_manager(request.data.get('manager'))
        branch = self._resolve_branch(request.data.get('branch'))
        existing_client = None
        explicit_client_id = request.data.get('existing_client') or request.data.get('client_id')
        raw_client = request.data.get('client')
        if explicit_client_id in (None, '') and not isinstance(raw_client, dict):
            explicit_client_id = raw_client
        if explicit_client_id not in (None, ''):
            existing_client = Client.objects.filter(pk=explicit_client_id).first()
            if not existing_client:
                raise drf_serializers.ValidationError({'client': 'Клиент не найден.'})
        elif contact_phone:
            existing_client = self._find_client_by_phone(contact_phone)

        duplicate = self._find_active_lead_by_phone(contact_phone, client=existing_client)
        if duplicate:
            return self._lead_duplicate_response(duplicate)

        client_payload = raw_client if isinstance(raw_client, dict) else {}
        with transaction.atomic():
            now = timezone.now()
            lead = Lead.objects.create(
                source=Lead.Source.MANUAL,
                channel=None,
                contact=None,
                client=existing_client,
                manager=manager,
                branch=branch,
                status=Lead.Status.NEW,
                title=contact_name or contact_phone or 'Обращение',
                contact_name=contact_name,
                contact_phone=contact_phone,
                first_message=first_message,
                last_message=first_message,
                first_message_at=now,
                last_message_at=now,
                unread_count=0,
                notes=first_message,
            )

            should_create_client = self._truthy(request.data.get('create_client'))
            if should_create_client:
                client_phone = self._normalized_phone(client_payload.get('phone') or contact_phone)
                client = existing_client or self._find_client_by_phone(client_phone)
                if not client:
                    client_branch = self._resolve_branch(client_payload.get('branch')) or branch
                    client_manager = self._resolve_manual_manager(client_payload.get('manager')) or manager
                    client = Client.objects.create(
                        first_name=str(client_payload.get('first_name') or contact_name or contact_phone or 'Клиент').strip(),
                        last_name=str(client_payload.get('last_name') or '').strip(),
                        parent_name=str(client_payload.get('parent_name') or '').strip(),
                        phone=client_phone,
                        branch=client_branch,
                        manager=client_manager,
                        notes=str(client_payload.get('notes') or first_message or 'Создан из ручного обращения').strip(),
                    )
                lead.client = client
                if not lead.branch_id and client.branch_id:
                    lead.branch = client.branch
                lead.save(update_fields=('client', 'branch', 'updated_at'))

            log_action(
                request,
                AuditLog.Action.CREATE,
                'Lead',
                entity_id=lead.id,
                entity_name=str(lead),
                description='Обращение добавлено вручную',
                changes={
                    'source': lead.source,
                    'manager': lead.manager_id,
                    'branch': lead.branch_id,
                    'client': lead.client_id,
                    'contact_phone': lead.contact_phone,
                },
            )

        return Response(self.get_serializer(lead).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='unread-count')
    def unread_count(self, request):
        queryset = self.get_queryset().filter(unread_count__gt=0)
        return Response({
            'total': queryset.aggregate(total=Sum('unread_count'))['total'] or 0,
            'whatsapp': queryset.filter(source=Lead.Source.WHATSAPP).aggregate(total=Sum('unread_count'))['total'] or 0,
            'instagram': queryset.filter(source=Lead.Source.INSTAGRAM).aggregate(total=Sum('unread_count'))['total'] or 0,
        })

    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        lead = self.get_object()
        serializer = LeadMessageSerializer(lead.messages.order_by('sent_at', 'created_at'), many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='mark-read')
    def mark_read(self, request, pk=None):
        lead = self.get_object()
        lead.unread_count = 0
        lead.messages.filter(direction=LeadMessage.Direction.INBOUND, is_read=False).update(is_read=True)
        lead.save(update_fields=('unread_count', 'updated_at'))
        self._log_instance(AuditLog.Action.LEAD_MARK_READ, lead, 'Обращение отмечено прочитанным', {'unread_count': 0})
        return Response(self.get_serializer(lead).data)

    @action(detail=True, methods=['post'], url_path='mark-unread')
    def mark_unread(self, request, pk=None):
        lead = self.get_object()
        lead.unread_count = max(lead.unread_count, 1)
        lead.save(update_fields=('unread_count', 'updated_at'))
        return Response(self.get_serializer(lead).data)

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        lead = self.get_object()
        manager_id = request.data.get('manager') or request.user.id
        manager = User.objects.filter(pk=manager_id, is_active=True).first()
        if not manager or not (is_admin(manager) or has_role(manager, MANAGER)):
            raise drf_serializers.ValidationError({'manager': 'Выберите активного менеджера.'})
        lead.manager = manager
        update_fields = ['manager', 'updated_at']
        changes = {'manager': manager.pk}
        if lead.status == Lead.Status.NEW:
            lead.status = Lead.Status.IN_PROGRESS
            update_fields.append('status')
            changes['status'] = lead.status
        lead.save(update_fields=update_fields)
        self._log_instance(AuditLog.Action.LEAD_ASSIGN, lead, 'Назначен менеджер обращения', changes)
        return Response(self.get_serializer(lead).data)

    @action(detail=True, methods=['post'], url_path='link-client')
    def link_client(self, request, pk=None):
        lead = self.get_object()
        if request.data.get('client') in (None, ''):
            if not is_admin(request.user):
                raise drf_serializers.ValidationError({'client': 'Отвязать клиента может только admin.'})
            client = None
        else:
            client = Client.objects.filter(pk=request.data.get('client')).first()
            if not client:
                raise drf_serializers.ValidationError({'client': 'Клиент не найден.'})
        lead.client = client
        if client and not lead.branch_id:
            lead.branch = client.branch
        lead.save(update_fields=('client', 'branch', 'updated_at'))
        if lead.contact_id:
            lead.contact.client = client
            lead.contact.save(update_fields=('client', 'updated_at'))
        self._log_instance(AuditLog.Action.LEAD_LINK_CLIENT, lead, 'Обращение связано с клиентом', {'client': client.pk if client else None})
        return Response(self.get_serializer(lead).data)

    @action(detail=True, methods=['post'], url_path='create-client')
    def create_client(self, request, pk=None):
        lead = self.get_object()
        if lead.client_id:
            raise drf_serializers.ValidationError({'client': 'Обращение уже связано с клиентом.'})
        phone = normalize_kz_phone(request.data.get('phone') or lead.contact_phone)
        existing_client = self._find_client_by_phone(phone)
        if existing_client:
            lead.client = existing_client
            if not lead.branch_id:
                lead.branch = existing_client.branch
            lead.save(update_fields=('client', 'branch', 'updated_at'))
            if lead.contact_id:
                lead.contact.client = existing_client
                lead.contact.save(update_fields=('client', 'updated_at'))
            self._log_instance(AuditLog.Action.LEAD_LINK_CLIENT, lead, 'Обращение связано с найденным клиентом', {'client': existing_client.pk})
            return Response(self.get_serializer(lead).data)
        client = Client.objects.create(
            first_name=request.data.get('first_name') or lead.contact_name or lead.contact_username or 'Клиент',
            last_name=request.data.get('last_name', ''),
            parent_name=request.data.get('parent_name', ''),
            phone=phone,
            branch_id=request.data.get('branch') or lead.branch_id,
            manager_id=request.data.get('manager') or lead.manager_id,
            notes=request.data.get('notes') or f'Создан из обращения {lead.get_source_display()}',
        )
        lead.client = client
        lead.save(update_fields=('client', 'updated_at'))
        if lead.contact_id:
            lead.contact.client = client
            lead.contact.save(update_fields=('client', 'updated_at'))
        self._log_instance(AuditLog.Action.LEAD_CREATE_CLIENT, lead, 'Создан клиент из обращения', {'client': client.pk})
        return Response(self.get_serializer(lead).data)

    @action(detail=True, methods=['post'], url_path='convert-to-trial')
    def convert_to_trial(self, request, pk=None):
        lead = self.get_object()
        if not lead.client_id:
            raise drf_serializers.ValidationError({'client': 'Сначала свяжите обращение с клиентом.'})
        if lead.converted_trial_id:
            return Response(self.get_serializer(lead).data)
        scheduled_at = request.data.get('scheduled_at')
        if not scheduled_at:
            raise drf_serializers.ValidationError({'scheduled_at': 'Укажите дату и время пробника.'})
        serializer = TrialSerializer(data={
            'client': lead.client_id,
            'branch': request.data.get('branch') or lead.branch_id,
            'manager': request.data.get('manager') or lead.manager_id,
            'teacher': request.data.get('teacher') or None,
            'scheduled_at': scheduled_at,
            'status': Trial.Status.BOOKED,
            'price': request.data.get('price', '0.00'),
            'notes': request.data.get('notes') or f'Запись из обращения {lead.get_source_display()}',
        }, context={'request': request})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            trial = serializer.save()
            lead.converted_trial = trial
            lead.status = Lead.Status.TRIAL_BOOKED
            lead.save(update_fields=('converted_trial', 'status', 'updated_at'))
        self._log_instance(AuditLog.Action.LEAD_CONVERT_TO_TRIAL, lead, 'Обращение переведено в пробник', {'trial': trial.pk})
        return Response(self.get_serializer(lead).data)

    @action(detail=True, methods=['post'], url_path='set-status')
    def set_status(self, request, pk=None):
        lead = self.get_object()
        status_value = request.data.get('status')
        allowed_statuses = {
            Lead.Status.NEW,
            Lead.Status.IN_PROGRESS,
            Lead.Status.QUALIFIED,
            Lead.Status.WON,
            Lead.Status.LOST,
            Lead.Status.SPAM,
        }
        if lead.converted_trial_id:
            allowed_statuses.add(Lead.Status.TRIAL_BOOKED)
        if status_value not in allowed_statuses:
            raise drf_serializers.ValidationError({'status': 'Выберите допустимый статус обращения.'})
        lead.status = status_value
        if status_value in {Lead.Status.WON, Lead.Status.LOST, Lead.Status.SPAM}:
            lead.closed_at = timezone.now()
        else:
            lead.closed_at = None
        lead.save(update_fields=('status', 'closed_at', 'updated_at'))
        self._log_instance(AuditLog.Action.LEAD_STATUS_UPDATE, lead, 'Изменён статус обращения', {'status': lead.status})
        return Response(self.get_serializer(lead).data)

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        lead = self.get_object()
        lead.status = request.data.get('status') if request.data.get('status') in {Lead.Status.WON, Lead.Status.LOST, Lead.Status.SPAM} else Lead.Status.LOST
        lead.closed_at = timezone.now()
        lead.save(update_fields=('status', 'closed_at', 'updated_at'))
        self._log_instance(AuditLog.Action.LEAD_STATUS_UPDATE, lead, 'Обращение закрыто', {'status': lead.status})
        return Response(self.get_serializer(lead).data)

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        lead = self.get_object()
        lead.status = Lead.Status.IN_PROGRESS
        lead.closed_at = None
        lead.save(update_fields=('status', 'closed_at', 'updated_at'))
        self._log_instance(AuditLog.Action.LEAD_STATUS_UPDATE, lead, 'Обращение переоткрыто', {'status': lead.status})
        return Response(self.get_serializer(lead).data)


class AddonSaleViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, AddonSalePermission)
    queryset = (
        AddonSale.objects
        .select_related('client', 'branch', 'created_by', 'payment_method', 'discount', 'finance_transaction')
        .prefetch_related('items__catalog_item')
        .all()
    )
    serializer_class = AddonSaleSerializer
    audit_entity_type = 'AddonSale'

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        client = self.request.query_params.get('client')
        manager = self.request.query_params.get('manager') or self.request.query_params.get('created_by')
        payment_method = self.request.query_params.get('payment_method')
        search = self.request.query_params.get('search')
        date_from = _date_param(self.request, 'date_from')
        date_to = _date_param(self.request, 'date_to')

        if client:
            queryset = queryset.filter(client_id=client)
        if manager and manager != 'all':
            queryset = queryset.filter(created_by__isnull=True) if manager == 'unassigned' else queryset.filter(created_by_id=manager)
        if payment_method and payment_method != 'all':
            queryset = queryset.filter(finance_transaction__payment_parts__isnull=True) if payment_method == 'unassigned' else queryset.filter(finance_transaction__payment_parts__payment_method_id=payment_method)
        if search:
            queryset = queryset.filter(
                Q(client__first_name__icontains=search)
                | Q(client__last_name__icontains=search)
                | Q(client__parent_name__icontains=search)
                | Q(client__phone__icontains=search)
                | Q(items__name__icontains=search)
                | Q(comment__icontains=search)
                | Q(payment_method_name__icontains=search)
            )
        if date_from:
            queryset = queryset.filter(sale_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(sale_date__lte=date_to)
        return queryset.distinct().order_by('-sale_date', '-created_at')

    def _sale_source(self, sale):
        categories = {
            item.catalog_item.category
            for item in sale.items.all()
            if item.catalog_item_id and item.catalog_item
        }
        has_product = CatalogItem.Category.PRODUCT in categories
        has_addon = CatalogItem.Category.ADDON in categories
        if has_product and has_addon:
            return 'retail'
        if has_product:
            return 'product'
        return 'addon'

    def _sale_comment(self, sale):
        names = [f'{item.name} ?{item.quantity}' for item in sale.items.all()]
        details = ', '.join(names)
        source = self._sale_source(sale)
        labels = {
            'product': '\u0422\u043e\u0432\u0430\u0440\u044b',
            'addon': '\u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0435 \u0443\u0441\u043b\u0443\u0433\u0438',
            'retail': '\u0422\u043e\u0432\u0430\u0440\u044b \u0438 \u0443\u0441\u043b\u0443\u0433\u0438',
        }
        base = f'{labels.get(source, "\u041f\u0440\u043e\u0434\u0430\u0436\u0430")}: {details}' if details else labels.get(source, '\u041f\u0440\u043e\u0434\u0430\u0436\u0430')
        return f'{base}. {sale.comment}' if sale.comment else base

    def _audit_changes(self, sale=None):
        if not sale:
            return super()._audit_changes()
        return {
            'client': sale.client_id,
            'branch': sale.branch_id,
            'items': [
                {
                    'name': item.name,
                    'catalog_item': item.catalog_item_id,
                    'quantity': item.quantity,
                    'unit_price': str(item.unit_price),
                    'total_price': str(item.total_price),
                }
                for item in sale.items.all()
            ],
            'total_price': str(sale.total_price),
            'discount_name': sale.discount_name,
            'discount_amount': str(sale.discount_amount),
            'payment_amount': str(sale.payment_amount),
            'payment_method': sale.payment_method_id,
            'payment_method_name': sale.payment_method_name,
            'created_by': sale.created_by_id,
            'comment': sale.comment,
        }

    def perform_create(self, serializer):
        with transaction.atomic():
            sale = serializer.save(created_by=self.request.user)
            if sale.payment_amount and sale.payment_amount > 0:
                finance_transaction = _create_income_transaction(
                    client=sale.client,
                    amount=sale.payment_amount,
                    source=self._sale_source(sale),
                    payment_date=sale.sale_date,
                    comment=self._sale_comment(sale),
                    created_by=self.request.user,
                    manager=sale.client.manager if sale.client else (self.request.user if has_role(self.request.user, MANAGER) else None),
                    payment_method=sale.payment_method,
                    payment_parts=getattr(sale, 'selected_payment_parts', None),
                    branch=sale.branch,
                    discount=sale.discount,
                    discount_name=sale.discount_name,
                    discount_amount=sale.discount_amount,
                    subtotal_amount=sale.total_price + sale.discount_amount,
                )
                sale.finance_transaction = finance_transaction
                sale.save(update_fields=('finance_transaction', 'updated_at'))
            self._log_instance(AuditLog.Action.ADDON_SALE_CREATE, sale, 'Создана продажа доп. услуг', self._audit_changes(sale))

    def perform_update(self, serializer):
        with transaction.atomic():
            sale = serializer.save()
            finance_transaction = sale.finance_transaction
            if sale.payment_amount and sale.payment_amount > 0:
                if finance_transaction:
                    finance_transaction.amount = sale.payment_amount
                    finance_transaction.subtotal_amount = sale.total_price + sale.discount_amount
                    finance_transaction.discount = sale.discount
                    finance_transaction.discount_name = sale.discount_name
                    finance_transaction.discount_amount = sale.discount_amount
                    finance_transaction.client = sale.client
                    finance_transaction.branch = sale.branch
                    finance_transaction.manager = sale.client.manager if sale.client else (self.request.user if has_role(self.request.user, MANAGER) else None)
                    finance_transaction.payment_method = sale.payment_method
                    finance_transaction.payment_method_name = sale.payment_method.name if sale.payment_method else finance_transaction.payment_method_name
                    finance_transaction.paid_at = _paid_at_from_date(sale.sale_date)
                    finance_transaction.source = self._sale_source(sale)
                    finance_transaction.comment = self._sale_comment(sale)
                    finance_transaction.save(update_fields=(
                        'amount',
                        'subtotal_amount',
                        'discount',
                        'discount_name',
                        'discount_amount',
                        'client',
                        'branch',
                        'manager',
                        'payment_method',
                        'payment_method_name',
                        'paid_at',
                        'source',
                        'comment',
                        'updated_at',
                    ))
                    payment_parts = getattr(sale, 'selected_payment_parts', None)
                    if payment_parts is None and finance_transaction.payment_parts.exists():
                        existing_parts = list(finance_transaction.payment_parts.all())
                        if len(existing_parts) == 1:
                            payment_parts = [{'payment_method': existing_parts[0].payment_method_id, 'amount': sale.payment_amount}]
                        else:
                            payment_parts = [
                                {'payment_method': part.payment_method_id, 'amount': part.amount}
                                for part in existing_parts
                            ]
                    sync_finance_payment_parts(finance_transaction, payment_parts, legacy_payment_method=sale.payment_method)
                else:
                    finance_transaction = _create_income_transaction(
                        client=sale.client,
                        amount=sale.payment_amount,
                        source=self._sale_source(sale),
                        payment_date=sale.sale_date,
                        comment=self._sale_comment(sale),
                        created_by=self.request.user,
                        manager=sale.client.manager if sale.client else (self.request.user if has_role(self.request.user, MANAGER) else None),
                        payment_method=sale.payment_method,
                        payment_parts=getattr(sale, 'selected_payment_parts', None),
                        branch=sale.branch,
                        discount=sale.discount,
                        discount_name=sale.discount_name,
                        discount_amount=sale.discount_amount,
                        subtotal_amount=sale.total_price + sale.discount_amount,
                    )
                    sale.finance_transaction = finance_transaction
                    sale.save(update_fields=('finance_transaction', 'updated_at'))
            elif finance_transaction:
                sale.finance_transaction = None
                sale.save(update_fields=('finance_transaction', 'updated_at'))
                finance_transaction.delete()
            self._log_instance(AuditLog.Action.ADDON_SALE_UPDATE, sale, 'Изменена продажа доп. услуг', self._audit_changes(sale))


class EmployeeWorkScheduleViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, EmployeeSchedulePermission)
    queryset = EmployeeWorkSchedule.objects.select_related('employee', 'branch').all()
    serializer_class = EmployeeWorkScheduleSerializer
    audit_entity_type = 'EmployeeWorkSchedule'

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        employee = self.request.query_params.get('employee')
        if employee:
            queryset = queryset.filter(employee_id=employee)
        if has_role(self.request.user, TEACHER) and not has_any_role(self.request.user, {MANAGER, ACCOUNTANT}):
            queryset = queryset.filter(employee=self.request.user)
        return queryset.order_by('employee__first_name', 'employee__username', 'weekday', '-valid_from')

    def perform_create(self, serializer):
        instance = serializer.save()
        self._log_instance(AuditLog.Action.EMPLOYEE_SCHEDULE_CREATE, instance, 'Создан график сотрудника', self._audit_changes())

    def perform_update(self, serializer):
        instance = serializer.save()
        self._log_instance(AuditLog.Action.EMPLOYEE_SCHEDULE_UPDATE, instance, 'Изменён график сотрудника', self._audit_changes())


class EmployeePayrollProfileViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, PayrollPermission)
    queryset = EmployeePayrollProfile.objects.select_related('employee').all()
    serializer_class = EmployeePayrollProfileSerializer
    audit_entity_type = 'EmployeePayrollProfile'

    def get_queryset(self):
        queryset = super().get_queryset()
        employee = self.request.query_params.get('employee')
        if employee:
            queryset = queryset.filter(employee_id=employee)
        return queryset.order_by('employee__first_name', 'employee__username')

    def perform_create(self, serializer):
        instance = serializer.save()
        self._log_instance(AuditLog.Action.PAYROLL_PROFILE_UPDATE, instance, 'Настроены ставки сотрудника', self._audit_changes())

    def perform_update(self, serializer):
        instance = serializer.save()
        self._log_instance(AuditLog.Action.PAYROLL_PROFILE_UPDATE, instance, 'Изменены ставки сотрудника', self._audit_changes())


class EmployeeWorklogView(APIView):
    permission_classes = (IsAuthenticated, EmployeeSchedulePermission)

    def get(self, request):
        today = timezone.localdate()
        date_to = _date_param(request, 'date_to') or today
        date_from = _date_param(request, 'date_from') or (date_to - timedelta(days=6))
        employee = request.query_params.get('employee')
        if has_role(request.user, TEACHER) and not has_any_role(request.user, {MANAGER, ACCOUNTANT}):
            employee = request.user.id
        data = build_employee_worklog(
            date_from=date_from,
            date_to=date_to,
            employee=employee,
            branch=request.query_params.get('branch') or 'all',
            source=request.query_params.get('source') or 'all',
        )
        return Response(data)


class PayrollStatementViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, PayrollPermission)
    queryset = PayrollStatement.objects.select_related('employee', 'branch', 'created_by', 'approved_by', 'finance_transaction').all()
    serializer_class = PayrollStatementSerializer
    audit_entity_type = 'PayrollStatement'

    def _ensure_payroll_access(self, request):
        if not (is_admin(request.user) or has_role(request.user, ACCOUNTANT)):
            raise drf_serializers.ValidationError({'detail': 'Нет доступа к зарплате.'})

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        employee = self.request.query_params.get('employee')
        status_value = self.request.query_params.get('status')
        date_from = _date_param(self.request, 'date_from')
        date_to = _date_param(self.request, 'date_to')
        if employee:
            queryset = queryset.filter(employee_id=employee)
        if status_value:
            queryset = queryset.filter(status=status_value)
        if date_from:
            queryset = queryset.filter(date_to__gte=date_from)
        if date_to:
            queryset = queryset.filter(date_from__lte=date_to)
        return queryset.order_by('-date_to', 'employee__first_name', 'employee__username')

    def list(self, request, *args, **kwargs):
        self._ensure_payroll_access(request)
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        self._ensure_payroll_access(request)
        return super().retrieve(request, *args, **kwargs)

    @action(detail=False, methods=['post'], url_path='generate')
    def generate(self, request):
        self._ensure_payroll_access(request)
        date_from = parse_date(request.data.get('date_from') or '')
        date_to = parse_date(request.data.get('date_to') or '')
        if not date_from or not date_to or date_to < date_from:
            return Response({'detail': 'Укажите корректный период.'}, status=status.HTTP_400_BAD_REQUEST)
        employee_id = request.data.get('employee')
        branch = request.data.get('branch') or 'all'
        employees = User.objects.filter(is_active=True)
        if employee_id:
            employees = employees.filter(id=employee_id)
        statements = generate_payroll_statements(
            employees=employees,
            date_from=date_from,
            date_to=date_to,
            branch=branch,
            created_by=request.user,
        )
        log_action(request, AuditLog.Action.PAYROLL_GENERATE, 'PayrollStatement', description='Сформирован расчёт зарплаты', changes={'date_from': str(date_from), 'date_to': str(date_to)})
        return Response(PayrollStatementSerializer(statements, many=True).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='recalculate')
    def recalculate(self, request, pk=None):
        self._ensure_payroll_access(request)
        statement = self.get_object()
        if statement.status != PayrollStatement.Status.DRAFT:
            return Response({'detail': 'Пересчитать можно только черновик.'}, status=status.HTTP_400_BAD_REQUEST)
        apply_payroll_calculation(statement)
        statement.save()
        self._log_instance(AuditLog.Action.PAYROLL_RECALCULATE, statement, 'Пересчитана зарплата', self._audit_changes())
        return Response(self.get_serializer(statement).data)

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        self._ensure_payroll_access(request)
        statement = self.get_object()
        statement.status = PayrollStatement.Status.APPROVED
        statement.approved_by = request.user
        statement.approved_at = timezone.now()
        statement.save(update_fields=('status', 'approved_by', 'approved_at', 'updated_at'))
        self._log_instance(AuditLog.Action.PAYROLL_APPROVE, statement, 'Зарплата утверждена', self._audit_changes())
        return Response(self.get_serializer(statement).data)

    @action(detail=True, methods=['post'], url_path='mark-paid')
    def mark_paid(self, request, pk=None):
        self._ensure_payroll_access(request)
        statement = self.get_object()
        if statement.status not in (PayrollStatement.Status.APPROVED, PayrollStatement.Status.PAID):
            return Response({'detail': 'Выплатить можно только утверждённую зарплату.'}, status=status.HTTP_400_BAD_REQUEST)
        payment_method = _resolve_payment_method(request.data.get('payment_method'), required=statement.total_amount > 0 and request.data.get('payment_parts') is None)
        payment_parts = validate_payment_parts(request.data.get('payment_parts'), total_amount=statement.total_amount, legacy_payment_method=payment_method)
        if not statement.finance_transaction_id:
            transaction_item = FinanceTransaction.objects.create(
                transaction_type=FinanceTransaction.Type.EXPENSE,
                source='salary',
                amount=statement.total_amount,
                subtotal_amount=statement.total_amount,
                branch=statement.branch,
                manager=None,
                client=None,
                created_by=request.user,
                paid_at=timezone.now(),
                comment=f'Зарплата: {statement.employee} · {statement.date_from}–{statement.date_to}',
            )
            sync_finance_payment_parts(transaction_item, payment_parts)
            statement.finance_transaction = transaction_item
        statement.status = PayrollStatement.Status.PAID
        statement.paid_at = timezone.now()
        statement.save(update_fields=('status', 'paid_at', 'finance_transaction', 'updated_at'))
        self._log_instance(AuditLog.Action.PAYROLL_PAID, statement, 'Зарплата выплачена', self._audit_changes())
        return Response(self.get_serializer(statement).data)

    def perform_update(self, serializer):
        statement = serializer.save()
        self._log_instance(AuditLog.Action.PAYROLL_ADJUST, statement, 'Изменена корректировка зарплаты', self._audit_changes())


class FinanceTransactionViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, FinancePermission)
    queryset = FinanceTransaction.objects.select_related(
        'client',
        'subscription',
        'created_by',
        'manager',
        'payment_method',
        'discount',
        'addon_sale',
        'master_class_payment',
        'master_class_payment__teacher',
        'master_class_payment_entry',
        'master_class_payment_entry__master_class',
        'master_class_payment_entry__master_class__teacher',
    ).prefetch_related(
        'payment_parts__payment_method',
        'addon_sale__items__catalog_item',
        'master_class_payment__staff_assignments__employee',
        'master_class_payment_entry__master_class__staff_assignments__employee',
    ).all()
    serializer_class = FinanceTransactionSerializer
    audit_entity_type = 'FinanceTransaction'
    audit_update_description = 'Изменена финансовая операция'
    audit_delete_description = 'Удалена финансовая операция'

    def _finance_audit_changes(self, instance):
        return {
            'transaction_type': instance.transaction_type,
            'amount': str(instance.amount),
            'payment_method_name': instance.payment_method_name,
            'client': instance.client_id,
            'branch': instance.branch_id,
            'created_by': instance.created_by_id,
            'manager': instance.manager_id,
            'description': instance.comment,
            'payment_parts': payment_parts_audit(instance),
        }

    def get_queryset(self):
        queryset = _filter_branch(super().get_queryset(), self.request)
        transaction_type = self.request.query_params.get('transaction_type') or self.request.query_params.get('type')
        source = self.request.query_params.get('source')
        payment_method = self.request.query_params.get('payment_method')
        discount = self.request.query_params.get('discount')
        client = self.request.query_params.get('client')
        manager = self.request.query_params.get('manager')
        teacher = self.request.query_params.get('teacher')
        outside_master_class = self.request.query_params.get('outside_master_class')
        extra_master_class = self.request.query_params.get('extra_master_class')
        search = self.request.query_params.get('search')
        date_from = _date_param(self.request, 'date_from')
        date_to = _date_param(self.request, 'date_to')

        if transaction_type:
            queryset = queryset.filter(transaction_type=transaction_type)
        if source:
            queryset = queryset.filter(source=source)
        if payment_method and payment_method != 'all':
            if payment_method == 'unassigned':
                queryset = queryset.filter(payment_method__isnull=True, payment_parts__isnull=True)
            else:
                queryset = queryset.filter(Q(payment_method_id=payment_method) | Q(payment_parts__payment_method_id=payment_method))
        if discount and discount != 'all':
            queryset = queryset.filter(discount__isnull=True) if discount == 'unassigned' else queryset.filter(discount_id=discount)
        if manager and manager != 'all':
            queryset = queryset.filter(manager__isnull=True) if manager == 'unassigned' else queryset.filter(manager_id=manager)
        if teacher and teacher != 'all':
            queryset = queryset.filter(
                Q(master_class_payment__teacher_id=teacher)
                | Q(master_class_payment__staff_assignments__employee_id=teacher)
                | Q(master_class_payment_entry__master_class__teacher_id=teacher)
                | Q(master_class_payment_entry__master_class__staff_assignments__employee_id=teacher)
            )
        if outside_master_class in ('true', 'false', '1', '0'):
            is_outside = outside_master_class in ('true', '1')
            ids = [
                item.id for item in queryset.filter(source='master_class').filter(Q(master_class_payment__isnull=False) | Q(master_class_payment_entry__isnull=False))
                if is_master_class_outside_regular_hours(
                    item.master_class_payment_entry.master_class.starts_at
                    if getattr(item, 'master_class_payment_entry', None)
                    else item.master_class_payment.starts_at
                ) == is_outside
            ]
            queryset = queryset.filter(id__in=ids)
        if extra_master_class in ('true', 'false', '1', '0'):
            is_extra = extra_master_class in ('true', '1')
            queryset = queryset.filter(
                Q(source='master_class'),
                Q(master_class_payment__is_extra_work=is_extra)
                | Q(master_class_payment_entry__master_class__is_extra_work=is_extra),
            )
        if client:
            queryset = queryset.filter(client_id=client)
        if search:
            queryset = queryset.filter(
                Q(client__first_name__icontains=search) | Q(client__last_name__icontains=search)
                | Q(client__phone__icontains=search) | Q(source__icontains=search)
                | Q(comment__icontains=search) | Q(payment_method_name__icontains=search)
            )
        if date_from:
            queryset = queryset.filter(paid_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(paid_at__date__lte=date_to)
        return queryset.distinct().order_by('-paid_at', '-created_at')

    def perform_create(self, serializer):
        extra = {}
        if not serializer.validated_data.get('manager') and has_role(self.request.user, MANAGER):
            extra['manager'] = self.request.user
        finance_transaction = serializer.save(created_by=self.request.user, **extra)
        self._log_instance(
            AuditLog.Action.PAYMENT,
            finance_transaction,
            'Добавлена финансовая операция',
            self._finance_audit_changes(finance_transaction),
        )

    def perform_update(self, serializer):
        if getattr(serializer.instance, 'master_class_payment_entry', None):
            raise drf_serializers.ValidationError({'detail': 'Оплаты мастер-класса редактируются в карточке МК.'})
        old_manager = serializer.instance.manager_id
        instance = serializer.save()
        action_value = AuditLog.Action.FINANCE_MANAGER_UPDATE if old_manager != instance.manager_id else AuditLog.Action.UPDATE
        self._log_instance(action_value, instance, self.audit_update_description, self._finance_audit_changes(instance))

    def perform_destroy(self, instance):
        if getattr(instance, 'master_class_payment_entry', None):
            raise drf_serializers.ValidationError({'detail': 'Оплаты мастер-класса удаляются в карточке МК.'})
        super().perform_destroy(instance)

    def _cash_scope(self, queryset, branch):
        if branch and branch != 'all':
            if branch == 'unassigned':
                return queryset.filter(branch__isnull=True)
            return queryset.filter(branch_id=branch)
        return queryset

    def _cash_balance_for_scope(self, branch):
        snapshots = self._cash_scope(
            CashRegisterSnapshot.objects.select_related('branch', 'created_by').all(),
            branch,
        )
        last_snapshot = snapshots.order_by('-recorded_at', '-created_at').first()
        opening_balance = last_snapshot.amount if last_snapshot else Decimal('0.00')

        transactions = self._cash_scope(
            FinanceTransaction.objects.filter(payment_parts__payment_method__is_cash=True),
            branch,
        )
        if last_snapshot:
            transactions = transactions.filter(paid_at__gt=last_snapshot.recorded_at)

        cash_income = _decimal(
            transactions.filter(transaction_type=FinanceTransaction.Type.INCOME).aggregate(total=Sum('payment_parts__amount'))['total']
        )
        cash_expense = _decimal(
            transactions.filter(transaction_type=FinanceTransaction.Type.EXPENSE).aggregate(total=Sum('payment_parts__amount'))['total']
        )
        expected_balance = opening_balance + cash_income - cash_expense

        return {
            'opening_balance': opening_balance,
            'cash_income': cash_income,
            'cash_expense': cash_expense,
            'expected_balance': expected_balance,
            'last_reconciliation': {
                'id': last_snapshot.id,
                'branch': last_snapshot.branch_id,
                'branch_name': last_snapshot.branch.name if last_snapshot.branch else None,
                'amount': last_snapshot.amount,
                'recorded_at': last_snapshot.recorded_at,
                'comment': last_snapshot.comment,
                'created_by': last_snapshot.created_by_id,
                'created_by_name': _person_name(last_snapshot.created_by),
            } if last_snapshot else None,
        }

    def _cash_balance_payload(self, branch):
        if branch == 'all':
            branch_ids = set(
                CashRegisterSnapshot.objects.values_list('branch_id', flat=True)
            ) | set(
                FinanceTransaction.objects.filter(payment_parts__payment_method__is_cash=True).values_list('branch_id', flat=True)
            )
            payload = {
                'opening_balance': Decimal('0.00'),
                'cash_income': Decimal('0.00'),
                'cash_expense': Decimal('0.00'),
                'expected_balance': Decimal('0.00'),
                'last_reconciliation': None,
            }
            for branch_id in branch_ids:
                scoped = self._cash_balance_for_scope(str(branch_id) if branch_id else 'unassigned')
                payload['opening_balance'] += scoped['opening_balance']
                payload['cash_income'] += scoped['cash_income']
                payload['cash_expense'] += scoped['cash_expense']
                payload['expected_balance'] += scoped['expected_balance']

            last_snapshot = CashRegisterSnapshot.objects.select_related('branch', 'created_by').order_by('-recorded_at', '-created_at').first()
            if last_snapshot:
                payload['last_reconciliation'] = {
                    'id': last_snapshot.id,
                    'branch': last_snapshot.branch_id,
                    'branch_name': last_snapshot.branch.name if last_snapshot.branch else None,
                    'amount': last_snapshot.amount,
                    'recorded_at': last_snapshot.recorded_at,
                    'comment': last_snapshot.comment,
                    'created_by': last_snapshot.created_by_id,
                    'created_by_name': _person_name(last_snapshot.created_by),
                }
            return payload
        return self._cash_balance_for_scope(branch)

    @action(detail=False, methods=['get'], url_path='cash-balance')
    def cash_balance(self, request):
        branch = request.query_params.get('branch') or 'all'
        return Response(self._cash_balance_payload(branch))

    @action(detail=False, methods=['post'], url_path='cash-balance/reconcile')
    def reconcile_cash_balance(self, request):
        if not (is_admin(request.user) or has_any_role(request.user, {MANAGER, ACCOUNTANT})):
            return Response({'detail': 'Нет доступа к сверке кассы.'}, status=status.HTTP_403_FORBIDDEN)

        amount = request.data.get('amount')
        if amount in (None, ''):
            return Response({'amount': 'Укажите фактическую сумму.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            amount = Decimal(str(amount)).quantize(Decimal('0.01'))
        except Exception:
            return Response({'amount': 'Укажите корректную сумму.'}, status=status.HTTP_400_BAD_REQUEST)
        if amount < 0:
            return Response({'amount': 'Сумма не может быть отрицательной.'}, status=status.HTTP_400_BAD_REQUEST)

        branch_value = request.data.get('branch')
        branch = None
        if branch_value not in (None, '', 'all', 'unassigned'):
            try:
                branch = Branch.objects.get(pk=branch_value)
            except (Branch.DoesNotExist, TypeError, ValueError):
                return Response({'branch': 'Филиал не найден.'}, status=status.HTTP_400_BAD_REQUEST)

        branch_param = str(branch.id) if branch else 'unassigned'
        expected_before = self._cash_balance_payload(branch_param)['expected_balance']
        snapshot = CashRegisterSnapshot.objects.create(
            branch=branch,
            amount=amount,
            comment=request.data.get('comment', ''),
            created_by=request.user,
        )
        difference = amount - expected_before
        log_action(
            request,
            AuditLog.Action.CASH_RECONCILIATION,
            'CashRegisterSnapshot',
            entity_id=snapshot.id,
            entity_name=str(snapshot),
            description='Сверка кассы',
            changes={
                'branch': snapshot.branch_id,
                'amount': str(snapshot.amount),
                'expected_balance': str(expected_before),
                'difference': str(difference),
                'comment': snapshot.comment,
            },
        )
        payload = self._cash_balance_payload(branch_param)
        payload['difference'] = difference
        return Response(payload, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        income = _decimal(queryset.filter(transaction_type=FinanceTransaction.Type.INCOME).aggregate(total=Sum('amount'))['total'])
        expense = _decimal(queryset.filter(transaction_type=FinanceTransaction.Type.EXPENSE).aggregate(total=Sum('amount'))['total'])
        income_count = queryset.filter(transaction_type=FinanceTransaction.Type.INCOME).count()
        return Response({
            'income': income, 'expense': expense, 'balance': income - expense,
            'transactions_count': queryset.count(),
            'average_income': income / income_count if income_count else Decimal('0'),
        })


class DiscountViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, DiscountPermission)
    queryset = Discount.objects.select_related('branch').all()
    serializer_class = DiscountSerializer
    audit_entity_type = 'Discount'

    def get_queryset(self):
        queryset = super().get_queryset()
        branch = self.request.query_params.get('branch')
        active = self.request.query_params.get('is_active')
        available = self.request.query_params.get('available')
        search = self.request.query_params.get('search')
        today = timezone.localdate()
        if branch and branch != 'all':
            if branch == 'unassigned':
                queryset = queryset.filter(branch__isnull=True)
            else:
                queryset = queryset.filter(Q(branch__isnull=True) | Q(branch_id=branch))
        if active in ('1', 'true', 'True', 'yes'):
            queryset = queryset.filter(is_active=True)
        elif active in ('0', 'false', 'False', 'no'):
            queryset = queryset.filter(is_active=False)
        if available in ('1', 'true', 'True', 'yes'):
            queryset = queryset.filter(is_active=True).filter(
                Q(valid_from__isnull=True) | Q(valid_from__lte=today),
                Q(valid_until__isnull=True) | Q(valid_until__gte=today),
            )
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(description__icontains=search))
        return queryset.order_by('name')

    def perform_create(self, serializer):
        instance = serializer.save()
        self._log_instance(AuditLog.Action.DISCOUNT_CREATE, instance, 'Создана скидка', self._audit_changes())

    def perform_update(self, serializer):
        was_active = serializer.instance.is_active
        instance = serializer.save()
        action_value, description = AuditLog.Action.DISCOUNT_UPDATE, 'Изменена скидка'
        if was_active and not instance.is_active:
            action_value, description = AuditLog.Action.DISCOUNT_DISABLE, 'Отключена скидка'
        elif not was_active and instance.is_active:
            action_value, description = AuditLog.Action.DISCOUNT_ENABLE, 'Восстановлена скидка'
        self._log_instance(action_value, instance, description, self._audit_changes())

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=('is_active', 'updated_at'))
        self._log_instance(AuditLog.Action.DISCOUNT_DISABLE, instance, 'Отключена скидка', {'is_active': False})


class PaymentMethodViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, PaymentMethodPermission)
    queryset = PaymentMethod.objects.all()
    serializer_class = PaymentMethodSerializer
    audit_entity_type = 'PaymentMethod'

    def get_queryset(self):
        queryset = super().get_queryset()
        active = self.request.query_params.get('is_active')
        search = self.request.query_params.get('search')
        if active in ('1', 'true', 'True', 'yes'):
            queryset = queryset.filter(is_active=True)
        elif active in ('0', 'false', 'False', 'no'):
            queryset = queryset.filter(is_active=False)
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(code__icontains=search) | Q(description__icontains=search))
        return queryset.order_by('sort_order', 'name')

    def perform_create(self, serializer):
        instance = serializer.save()
        self._log_instance(AuditLog.Action.PAYMENT_METHOD_CREATE, instance, 'Создан способ оплаты', self._audit_changes())

    def perform_update(self, serializer):
        was_active = serializer.instance.is_active
        instance = serializer.save()
        action_value, description = AuditLog.Action.PAYMENT_METHOD_UPDATE, 'Изменён способ оплаты'
        if was_active and not instance.is_active:
            action_value, description = AuditLog.Action.PAYMENT_METHOD_DISABLE, 'Отключён способ оплаты'
        elif not was_active and instance.is_active:
            action_value, description = AuditLog.Action.PAYMENT_METHOD_ENABLE, 'Включён способ оплаты'
        self._log_instance(action_value, instance, description, self._audit_changes())

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=('is_active', 'updated_at'))
        self._log_instance(AuditLog.Action.PAYMENT_METHOD_DISABLE, instance, 'Отключён способ оплаты', {'is_active': False})


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
        service_type = self.request.query_params.get('service_type')
        is_active = self.request.query_params.get('is_active')
        if category:
            queryset = queryset.filter(category=category)
        if service_type:
            queryset = queryset.filter(service_type=service_type)
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
            'service_type': instance.service_type,
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
        queryset = FinanceTransaction.objects.select_related('client', 'created_by', 'payment_method').prefetch_related('payment_parts__payment_method').all()
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


class CertificatesExportView(BaseExportView):
    export_type = 'certificates'
    filename_prefix = 'certificates'
    description = 'Экспорт сертификатов'

    def get(self, request):
        queryset = (
            GiftCertificate.objects
            .select_related('template', 'batch', 'purchaser_client', 'created_by')
            .prefetch_related('redemptions__created_by')
            .all()
        )
        queryset = _filter_period(queryset, 'issued_at', request)
        search = request.query_params.get('search')
        status_value = request.query_params.get('status')
        if status_value:
            queryset = queryset.filter(status=status_value)
        if search:
            search_clean = search.strip()
            search_filter = (
                Q(code__icontains=search)
                | Q(recipient_name__icontains=search)
                | Q(recipient_phone__icontains=search)
                | Q(batch__purchaser_name__icontains=search)
                | Q(batch__purchaser_phone__icontains=search)
                | Q(batch__purchaser_phone_snapshot__icontains=search)
                | Q(purchaser_client__first_name__icontains=search)
                | Q(purchaser_client__last_name__icontains=search)
                | Q(purchaser_client__parent_name__icontains=search)
                | Q(purchaser_client__phone__icontains=search)
                | Q(redemptions__visitor_name__icontains=search)
                | Q(redemptions__visitor_phone__icontains=search)
            )
            serial_match = re.match(r'^n?0*(\d+)$', search_clean, flags=re.IGNORECASE)
            if serial_match:
                search_filter |= Q(serial_number=int(serial_match.group(1)))
            queryset = queryset.filter(search_filter)
        self._log_export(request, queryset.distinct().count())
        return _xlsx_response(export_certificates(queryset.distinct().order_by('serial_number', 'id')), self._filename())


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
            'trial_conversion_by_teacher',
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

        transactions = apply_branch_filter(transactions, branch)
        clients = apply_branch_filter(clients, branch)
        subscriptions = apply_branch_filter(subscriptions, branch)
        trials = apply_branch_filter(trials, branch)
        master_classes = apply_branch_filter(master_classes, branch)
        groups = apply_branch_filter(groups, branch)
        lessons = apply_branch_filter(lessons, branch)
        visits = apply_branch_filter(visits, branch)
        tasks = apply_branch_filter(tasks, branch)

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
            all_income = apply_branch_filter(all_income, branch)
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
            cash = _decimal(
                transactions.filter(
                    transaction_type=FinanceTransaction.Type.INCOME,
                    payment_parts__payment_method__is_cash=True,
                ).aggregate(total=Sum('payment_parts__amount'))['total']
            )
            card = _decimal(
                transactions.filter(
                    transaction_type=FinanceTransaction.Type.INCOME,
                    payment_parts__payment_method__is_cash=False,
                ).aggregate(total=Sum('payment_parts__amount'))['total']
            )
            payment_count = transactions.filter(transaction_type=FinanceTransaction.Type.INCOME).count()
            avg_check = round(float(income_total) / payment_count, 2) if payment_count else 0

        trials_total = trials.count()
        trials_bought = trials.filter(Q(bought_subscription=True) | Q(status__in=['bought'])).count()
        trials_lost = trials.filter(status='lost').count()
        trials_income = _decimal(trials.aggregate(total=Sum('price'))['total'])

        mk_total = master_classes.count()
        mk_bought = master_classes.filter(stage='bought').count()
        mk_paid = master_classes.filter(
            Q(payment_amount__gt=0)
            | Q(finance_transaction__amount__gt=0)
        ).distinct().count()
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
            'branch_filter': branch or 'all',
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
                'conversion': round(mk_paid / mk_total * 100, 2) if mk_total and not is_teacher else 0,
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

        branches_summary = []
        real_branches = Branch.objects.filter(is_active=True).exclude(
            name__iregex=r'^\s*(все филиалы|все|all branches|без филиала|не распределено)\s*$'
        ).order_by('name')
        summary_branches = [(str(item.id), item.id, item.name) for item in real_branches]
        summary_branches.append(('unassigned', None, 'Не распределено'))
        for branch_key, branch_id, branch_name in summary_branches:
            branch_clients = Client.objects.filter(branch_id=branch_id)
            branch_subscriptions = Subscription.objects.filter(branch_id=branch_id)
            branch_transactions = FinanceTransaction.objects.filter(
                branch_id=branch_id,
                paid_at__date__gte=date_from,
                paid_at__date__lte=date_to,
            )
            branch_groups = StudyGroup.objects.filter(branch_id=branch_id)
            branch_lessons = Lesson.objects.filter(
                branch_id=branch_id,
                lesson_date__gte=date_from,
                lesson_date__lte=date_to,
            )
            if is_teacher:
                branch_groups = branch_groups.filter(teacher=request.user)
                branch_lessons = branch_lessons.filter(teacher=request.user)
            branches_summary.append({
                'id': branch_id,
                'key': branch_key,
                'name': branch_name,
                'clients': branch_clients.count() if not is_teacher else 0,
                'subscriptions': branch_subscriptions.filter(status=Subscription.Status.ACTIVE).count() if not is_teacher else 0,
                'income': _decimal(branch_transactions.filter(transaction_type=FinanceTransaction.Type.INCOME).aggregate(total=Sum('amount'))['total']) if can_view_finance else 0,
                'finance_transactions': branch_transactions.count() if can_view_finance else 0,
                'groups': branch_groups.count(),
                'lessons': branch_lessons.count(),
            })
        dashboard['branches_summary'] = branches_summary

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


class DailyPaymentsReportView(APIView):
    permission_classes = (IsAuthenticated, ReportsPermission)

    def _bucket(self, transaction_item):
        branch = transaction_item.branch
        return {
            'branch_id': branch.id if branch else None,
            'branch_name': branch.name if branch else 'Не распределено',
            'cash_income': Decimal('0.00'),
            'card_income': Decimal('0.00'),
            'unassigned_income': Decimal('0.00'),
            'total_income': Decimal('0.00'),
            'expense_total': Decimal('0.00'),
        }

    def get(self, request):
        selected_date = _date_param(request, 'date') or timezone.localdate()
        queryset = FinanceTransaction.objects.select_related('branch', 'payment_method').prefetch_related(
            'payment_parts__payment_method'
        ).filter(paid_at__date=selected_date)
        queryset = apply_branch_filter(queryset, request.query_params.get('branch') or 'all')

        branches = {}
        totals = {
            'cash_income': Decimal('0.00'),
            'card_income': Decimal('0.00'),
            'unassigned_income': Decimal('0.00'),
            'income_total': Decimal('0.00'),
            'expense_total': Decimal('0.00'),
            'net_total': Decimal('0.00'),
        }

        for transaction_item in queryset:
            branch_key = transaction_item.branch_id or 'unassigned'
            bucket = branches.setdefault(branch_key, self._bucket(transaction_item))
            amount = _money(transaction_item.amount)

            if transaction_item.transaction_type == FinanceTransaction.Type.EXPENSE:
                bucket['expense_total'] += amount
                totals['expense_total'] += amount
                continue

            if transaction_item.transaction_type != FinanceTransaction.Type.INCOME:
                continue

            payment_parts = list(transaction_item.payment_parts.all())
            if payment_parts:
                for part in payment_parts:
                    part_amount = _money(part.amount)
                    key = 'cash_income' if part.payment_method and part.payment_method.is_cash else 'card_income'
                    bucket[key] += part_amount
                    totals[key] += part_amount
            elif transaction_item.payment_method:
                key = 'cash_income' if transaction_item.payment_method.is_cash else 'card_income'
                bucket[key] += amount
                totals[key] += amount
            else:
                bucket['unassigned_income'] += amount
                totals['unassigned_income'] += amount

        branch_rows = []
        for bucket in branches.values():
            bucket['total_income'] = bucket['cash_income'] + bucket['card_income'] + bucket['unassigned_income']
            if bucket['total_income'] == 0 and bucket['expense_total'] == 0:
                continue
            branch_rows.append({
                'branch_id': bucket['branch_id'],
                'branch_name': bucket['branch_name'],
                'cash_income': _money_str(bucket['cash_income']),
                'card_income': _money_str(bucket['card_income']),
                'unassigned_income': _money_str(bucket['unassigned_income']),
                'total_income': _money_str(bucket['total_income']),
                'expense_total': _money_str(bucket['expense_total']),
            })

        branch_rows.sort(key=lambda item: (item['branch_id'] is None, item['branch_name']))
        totals['income_total'] = totals['cash_income'] + totals['card_income'] + totals['unassigned_income']
        totals['net_total'] = totals['income_total'] - totals['expense_total']

        return Response({
            'date': selected_date.isoformat(),
            'branches': branch_rows,
            'totals': {
                'cash_income': _money_str(totals['cash_income']),
                'card_income': _money_str(totals['card_income']),
                'unassigned_income': _money_str(totals['unassigned_income']),
                'income_total': _money_str(totals['income_total']),
                'expense_total': _money_str(totals['expense_total']),
                'net_total': _money_str(totals['net_total']),
            },
        })


def _lead_sales_queryset(queryset):
    return queryset.filter(
        Q(status=Lead.Status.WON)
        | Q(converted_trial__bought_subscription=True)
        | Q(converted_trial__status=Trial.Status.BOUGHT)
        | Q(converted_trial__subscription_id__isnull=False)
    ).distinct()


def _lead_funnel_summary(queryset):
    leads_total = queryset.count()
    trials_booked = queryset.filter(converted_trial__isnull=False).distinct().count()
    sales = _lead_sales_queryset(queryset).count()
    sales_from_trial = _lead_sales_queryset(queryset.filter(converted_trial__isnull=False)).count()
    return {
        'leads_total': leads_total,
        'in_progress': queryset.filter(status=Lead.Status.IN_PROGRESS).count(),
        'qualified': queryset.filter(status=Lead.Status.QUALIFIED).count(),
        'trials_booked': trials_booked,
        'sales': sales,
        'lost': queryset.filter(status=Lead.Status.LOST).count(),
        'lead_to_trial_conversion': _percent_str(trials_booked, leads_total),
        'lead_to_sale_conversion': _percent_str(sales, leads_total),
        'trial_to_sale_conversion': _percent_str(sales_from_trial, trials_booked),
    }


def _lead_conversion_row(queryset, *, manager=None, source=None):
    leads_total = queryset.count()
    trials_booked = queryset.filter(converted_trial__isnull=False).distinct().count()
    sales = _lead_sales_queryset(queryset).count()
    row = {
        'leads_total': leads_total,
        'trials_booked': trials_booked,
        'sales': sales,
        'lead_to_trial_conversion': _percent_str(trials_booked, leads_total),
        'lead_to_sale_conversion': _percent_str(sales, leads_total),
    }
    if manager is not None:
        row.update({
            'manager': manager.id,
            'manager_id': manager.id,
            'manager_name': manager.get_full_name() or manager.username,
        })
    if source is not None:
        row.update({
            'source': source,
            'source_display': dict(Lead.Source.choices).get(source, source),
        })
    return row


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
        leads = Lead.objects.select_related('manager', 'branch', 'converted_trial')
        visits = Visit.objects.select_related('client', 'lesson', 'lesson__group', 'teacher')
        branch = request.query_params.get('branch')
        transactions = apply_branch_filter(transactions, branch)
        trials = apply_branch_filter(trials, branch)
        master_classes = apply_branch_filter(master_classes, branch)
        lessons = apply_branch_filter(lessons, branch)
        leads = apply_branch_filter(leads, branch)
        visits = apply_branch_filter(visits, branch)

        if date_from:
            transactions = transactions.filter(paid_at__date__gte=date_from)
            trials = trials.filter(scheduled_at__date__gte=date_from)
            master_classes = master_classes.filter(starts_at__date__gte=date_from)
            lessons = lessons.filter(lesson_date__gte=date_from)
            leads = leads.filter(first_message_at__date__gte=date_from)
            visits = visits.filter(visited_at__date__gte=date_from)
        if date_to:
            transactions = transactions.filter(paid_at__date__lte=date_to)
            trials = trials.filter(scheduled_at__date__lte=date_to)
            master_classes = master_classes.filter(starts_at__date__lte=date_to)
            lessons = lessons.filter(lesson_date__lte=date_to)
            leads = leads.filter(first_message_at__date__lte=date_to)
            visits = visits.filter(visited_at__date__lte=date_to)
        leads_for_funnel = leads.exclude(status=Lead.Status.SPAM)

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
            'camp': '\u041b\u0430\u0433\u0435\u0440\u044c',
            'certificate': '\u0421\u0435\u0440\u0442\u0438\u0444\u0438\u043a\u0430\u0442',
            'addon': 'Дополнительные услуги',
            'product': '\u0422\u043e\u0432\u0430\u0440\u044b',
            'retail': '\u0422\u043e\u0432\u0430\u0440\u044b \u0438 \u0443\u0441\u043b\u0443\u0433\u0438',
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
            mm_paid = manager_mk.filter(
                Q(payment_amount__gt=0)
                | Q(finance_transaction__amount__gt=0)
            ).distinct().count()
            sales_by_manager.append(
                {
                    'manager_id': manager_id,
                    'manager_name': manager_name,
                    'trials_total': mt_total,
                    'trials_bought': mt_bought,
                    'trials_conversion': round(mt_bought / mt_total * 100, 2) if mt_total else 0,
                    'mk_total': mm_total,
                    'mk_paid': mm_paid,
                    'mk_conversion': round(mm_paid / mm_total * 100, 2) if mm_total else 0,
                    'income': manager_income,
                }
            )

        trial_conversion_by_teacher = []
        trial_teacher_ids = set(filter(None, trials.values_list('teacher_id', flat=True)))
        for teacher_id in trial_teacher_ids:
            teacher_trials = trials.filter(teacher_id=teacher_id)
            tt_total = teacher_trials.count()
            subscriptions_bought = teacher_trials.filter(
                Q(subscription_id__isnull=False)
                | Q(bought_subscription=True)
                | Q(status=Trial.Status.BOUGHT)
            ).distinct().count()
            teacher = teacher_trials.first().teacher
            trial_conversion_by_teacher.append(
                {
                    'teacher_id': teacher_id,
                    'teacher_name': teacher.get_full_name() or teacher.username if teacher else f'ID {teacher_id}',
                    'trials_total': tt_total,
                    'subscriptions_bought': subscriptions_bought,
                    'conversion': round(subscriptions_bought / tt_total * 100, 2) if tt_total else 0,
                }
            )
        trial_conversion_by_teacher = sorted(
            trial_conversion_by_teacher,
            key=lambda item: (-item['conversion'], -item['trials_total'], item['teacher_name']),
        )

        lead_funnel = _lead_funnel_summary(leads_for_funnel)
        lead_conversion_by_manager = []
        lead_manager_ids = set(leads_for_funnel.values_list('manager_id', flat=True))
        for manager_id in lead_manager_ids:
            manager_leads = leads_for_funnel.filter(manager_id=manager_id)
            if manager_id:
                manager = manager_leads.first().manager
                lead_conversion_by_manager.append(_lead_conversion_row(manager_leads, manager=manager))
            else:
                row = _lead_conversion_row(manager_leads)
                row.update({'manager': None, 'manager_id': None, 'manager_name': 'Не назначен'})
                lead_conversion_by_manager.append(row)
        lead_conversion_by_manager = sorted(
            lead_conversion_by_manager,
            key=lambda item: (-item['leads_total'], item['manager_name']),
        )

        lead_conversion_by_source = []
        for source in sorted(set(leads_for_funnel.values_list('source', flat=True))):
            lead_conversion_by_source.append(_lead_conversion_row(leads_for_funnel.filter(source=source), source=source))

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
                'lead_funnel': lead_funnel,
                'lead_conversion_by_manager': lead_conversion_by_manager,
                'lead_conversion_by_source': lead_conversion_by_source,
                'trial_conversion_by_teacher': trial_conversion_by_teacher,
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
