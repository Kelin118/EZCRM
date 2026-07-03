from datetime import datetime, time, timedelta

from django.db import transaction
from django.db.models import Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .audit import log_action
from .excel_import import import_excel
from .models import (
    AuditLog,
    ChatMessage,
    Client,
    FinanceTransaction,
    MasterClass,
    StudioSettings,
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
    ChatPermission,
    ClientPermission,
    DashboardPermission,
    ExcelImportPermission,
    FinancePermission,
    MasterClassPermission,
    ReportsPermission,
    SettingsPermission,
    SubscriptionPermission,
    TaskPermission,
    TrialPermission,
    VisitPermission,
    role,
)
from .serializers import (
    AuditLogSerializer,
    ChatMessageSerializer,
    ClientSerializer,
    FinanceTransactionSerializer,
    MasterClassSerializer,
    StudioSettingsSerializer,
    SubscriptionSerializer,
    TaskSerializer,
    TrialSerializer,
    VisitSerializer,
)


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


class BaseAuthenticatedViewSet(viewsets.ModelViewSet):
    permission_classes = (IsAuthenticated,)

    audit_entity_type = None
    audit_create_description = ''
    audit_update_description = ''
    audit_delete_description = ''

    def _audit_entity_type(self):
        return self.audit_entity_type or self.get_queryset().model.__name__

    def _audit_changes(self):
        return {key: value for key, value in self.request.data.items() if key not in {'password', 'password_confirm'}}

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
            queryset = queryset.filter(description__icontains=search) | queryset.filter(
                entity_name__icontains=search
            ) | queryset.filter(entity_type__icontains=search)
        return queryset


class ClientViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, ClientPermission)
    queryset = Client.objects.select_related('manager').all()
    serializer_class = ClientSerializer
    audit_entity_type = 'Client'
    audit_create_description = 'Создан клиент'
    audit_update_description = 'Изменён клиент'
    audit_delete_description = 'Удалён клиент'

    def get_queryset(self):
        queryset = super().get_queryset()
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
        queryset = super().get_queryset()
        status_value = self.request.query_params.get('status')
        client = self.request.query_params.get('client')
        date_from = _date_param(self.request, 'date_from')
        date_to = _date_param(self.request, 'date_to')

        if status_value:
            queryset = queryset.filter(status=status_value)
        if client:
            queryset = queryset.filter(client_id=client)
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
    queryset = Visit.objects.select_related('client', 'subscription', 'teacher').all()
    serializer_class = VisitSerializer
    audit_entity_type = 'Visit'

    def get_queryset(self):
        queryset = super().get_queryset()
        client = self.request.query_params.get('client')
        date = _date_param(self.request, 'date')

        if client:
            queryset = queryset.filter(client_id=client)
        if date:
            queryset = queryset.filter(visited_at__date=date)
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
            self._log_instance(AuditLog.Action.VISIT, visit, 'Добавлено посещение', self._audit_changes())

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
            self._log_instance(AuditLog.Action.UPDATE, visit, 'Изменено посещение', self._audit_changes())


class TrialViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, TrialPermission)
    queryset = Trial.objects.select_related('client', 'manager', 'teacher').all()
    serializer_class = TrialSerializer
    audit_entity_type = 'Trial'
    audit_update_description = 'Изменён пробник'

    def get_queryset(self):
        queryset = super().get_queryset()
        stage = self.request.query_params.get('stage')
        manager = self.request.query_params.get('manager')
        client = self.request.query_params.get('client')
        payment_date_from = _date_param(self.request, 'payment_date_from')
        payment_date_to = _date_param(self.request, 'payment_date_to')

        if stage:
            queryset = queryset.filter(status=stage)
        if manager:
            queryset = queryset.filter(manager_id=manager)
        if client:
            queryset = queryset.filter(client_id=client)
        if _my_param(self.request):
            queryset = queryset.filter(manager=self.request.user) | queryset.filter(teacher=self.request.user)
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


class MasterClassViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, MasterClassPermission)
    queryset = MasterClass.objects.select_related('manager', 'teacher').prefetch_related('participants').all()
    serializer_class = MasterClassSerializer
    audit_entity_type = 'MasterClass'
    audit_update_description = 'Изменён МК'

    def get_queryset(self):
        queryset = super().get_queryset()
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


class TaskViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, TaskPermission)
    queryset = Task.objects.select_related('assigned_to', 'client').all()
    serializer_class = TaskSerializer
    audit_entity_type = 'Task'
    audit_create_description = 'Создана задача'
    audit_update_description = 'Изменена задача'

    def get_queryset(self):
        queryset = super().get_queryset()
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
        if role(self.request.user) == TEACHER or _my_param(self.request):
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
        self._log_instance(AuditLog.Action.UPDATE, task, 'Задача выполнена', {'status': Task.Status.DONE})
        return Response(self.get_serializer(task).data)


class FinanceTransactionViewSet(BaseAuthenticatedViewSet):
    permission_classes = (IsAuthenticated, FinancePermission)
    queryset = FinanceTransaction.objects.select_related('client', 'subscription', 'created_by').all()
    serializer_class = FinanceTransactionSerializer
    audit_entity_type = 'FinanceTransaction'
    audit_update_description = 'Изменена финансовая операция'
    audit_delete_description = 'Удалена финансовая операция'

    def get_queryset(self):
        queryset = super().get_queryset()
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
        if role(self.request.user) == MANAGER:
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
        if role(request.user) == ACCOUNTANT:
            instance = self.get_object()
            data = {field: request.data[field] for field in self.price_fields if field in request.data}
            serializer = self.get_serializer(instance, data=data, partial=True)
            serializer.is_valid(raise_exception=True)
            self.perform_update(serializer)
            return Response(serializer.data)
        return super().update(request, *args, **kwargs)


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


class DashboardStatsView(APIView):
    permission_classes = (IsAuthenticated, DashboardPermission)

    def get(self, request):
        today = timezone.localdate()
        ending_date = today + timedelta(days=7)
        can_view_finance = role(request.user) != TEACHER
        income_total = 0
        expense_total = 0
        income_today = 0
        income_month = 0
        if can_view_finance:
            income_total = _decimal(
                FinanceTransaction.objects.filter(transaction_type=FinanceTransaction.Type.INCOME).aggregate(
                    total=Sum('amount')
                )['total']
            )
            expense_total = _decimal(
                FinanceTransaction.objects.filter(transaction_type=FinanceTransaction.Type.EXPENSE).aggregate(
                    total=Sum('amount')
                )['total']
            )
            income_today = _decimal(
                FinanceTransaction.objects.filter(
                    transaction_type=FinanceTransaction.Type.INCOME,
                    paid_at__date=today,
                ).aggregate(total=Sum('amount'))['total']
            )
            income_month = _decimal(
                FinanceTransaction.objects.filter(
                    transaction_type=FinanceTransaction.Type.INCOME,
                    paid_at__year=today.year,
                    paid_at__month=today.month,
                ).aggregate(total=Sum('amount'))['total']
            )
        trials_total = Trial.objects.count()
        trials_bought = Trial.objects.filter(bought_subscription=True).count()

        return Response(
            {
                'clients_total': Client.objects.count(),
                'active_subscriptions': Subscription.objects.filter(status=Subscription.Status.ACTIVE).count(),
                'ending_subscriptions': Subscription.objects.filter(
                    status=Subscription.Status.ACTIVE,
                    end_date__isnull=False,
                    end_date__gte=today,
                    end_date__lte=ending_date,
                ).count(),
                'trials_total': trials_total,
                'trials_bought': trials_bought,
                'trials_conversion': round((trials_bought / trials_total) * 100, 2) if trials_total else 0,
                'master_classes_total': MasterClass.objects.count(),
                'income_total': income_total,
                'expense_total': expense_total,
                'balance': income_total - expense_total,
                'tasks_today': Task.objects.filter(due_at__date=today).exclude(status=Task.Status.DONE).count(),
                'tasks_overdue': Task.objects.filter(due_at__date__lt=today).exclude(status=Task.Status.DONE).count(),
                'visits_today': Visit.objects.filter(visited_at__date=today).count(),
                'subscriptions_ending': Subscription.objects.filter(
                    status=Subscription.Status.ACTIVE,
                    end_date__isnull=False,
                    end_date__gte=today,
                    end_date__lte=ending_date,
                ).count(),
                'trials_today': Trial.objects.filter(scheduled_at__date=today).count(),
                'master_classes_today': MasterClass.objects.filter(starts_at__date=today).count(),
                'income_today': income_today,
                'income_month': income_month,
            }
        )


class ReportsSummaryView(APIView):
    permission_classes = (IsAuthenticated, ReportsPermission)

    def get(self, request):
        date_from = _date_param(request, 'date_from')
        date_to = _date_param(request, 'date_to')
        transactions = FinanceTransaction.objects.all()
        trials = Trial.objects.all()
        master_classes = MasterClass.objects.all()

        if date_from:
            transactions = transactions.filter(paid_at__date__gte=date_from)
            trials = trials.filter(scheduled_at__date__gte=date_from)
            master_classes = master_classes.filter(starts_at__date__gte=date_from)
        if date_to:
            transactions = transactions.filter(paid_at__date__lte=date_to)
            trials = trials.filter(scheduled_at__date__lte=date_to)
            master_classes = master_classes.filter(starts_at__date__lte=date_to)

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
        trials_bought = trials.filter(bought_subscription=True).count()
        income_transactions = transactions.filter(transaction_type=FinanceTransaction.Type.INCOME)

        income_by_source = list(
            income_transactions.values('source').annotate(total=Sum('amount')).order_by('source')
        )
        income_by_manager = list(
            income_transactions.values('created_by', 'created_by__username')
            .annotate(total=Sum('amount'))
            .order_by('created_by__username')
        )
        payments_by_day = list(
            income_transactions.annotate(day=TruncDate('paid_at'))
            .values('day')
            .annotate(total=Sum('amount'))
            .order_by('day')
        )

        return Response(
            {
                'income_total': income_total,
                'expense_total': expense_total,
                'balance': income_total - expense_total,
                'income_by_source': income_by_source,
                'income_by_managers': income_by_manager,
                'trials_total': trials_total,
                'trials_bought': trials_bought,
                'trials_conversion': round((trials_bought / trials_total) * 100, 2) if trials_total else 0,
                'master_classes_total': master_classes.count(),
                'payments_by_day': payments_by_day,
            },
            status=status.HTTP_200_OK,
        )
