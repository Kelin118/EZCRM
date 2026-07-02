from datetime import datetime, time, timedelta

from django.db import transaction
from django.db.models import Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .excel_import import import_excel
from .models import (
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
from .serializers import (
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


class ClientViewSet(BaseAuthenticatedViewSet):
    queryset = Client.objects.select_related('manager').all()
    serializer_class = ClientSerializer

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
        return queryset.order_by('-created_at')


class SubscriptionViewSet(BaseAuthenticatedViewSet):
    queryset = Subscription.objects.select_related('client').all()
    serializer_class = SubscriptionSerializer

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


class VisitViewSet(BaseAuthenticatedViewSet):
    queryset = Visit.objects.select_related('client', 'subscription', 'teacher').all()
    serializer_class = VisitSerializer

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


class TrialViewSet(BaseAuthenticatedViewSet):
    queryset = Trial.objects.select_related('client', 'manager', 'teacher').all()
    serializer_class = TrialSerializer

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


class MasterClassViewSet(BaseAuthenticatedViewSet):
    queryset = MasterClass.objects.select_related('manager', 'teacher').prefetch_related('participants').all()
    serializer_class = MasterClassSerializer

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


class TaskViewSet(BaseAuthenticatedViewSet):
    queryset = Task.objects.select_related('assigned_to', 'client').all()
    serializer_class = TaskSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        status_value = self.request.query_params.get('status')
        assigned_to = self.request.query_params.get('assigned_to')
        client = self.request.query_params.get('client')
        due_date = _date_param(self.request, 'due_date')

        if status_value:
            queryset = queryset.filter(status=status_value)
        if assigned_to:
            queryset = queryset.filter(assigned_to_id=assigned_to)
        if client:
            queryset = queryset.filter(client_id=client)
        if due_date:
            queryset = queryset.filter(due_at__date=due_date)
        return queryset.order_by('due_at', '-created_at')

    @action(detail=True, methods=['patch'], url_path='mark-done')
    def mark_done(self, request, pk=None):
        task = self.get_object()
        task.status = Task.Status.DONE
        task.save(update_fields=('status', 'updated_at'))
        return Response(self.get_serializer(task).data)


class FinanceTransactionViewSet(BaseAuthenticatedViewSet):
    queryset = FinanceTransaction.objects.select_related('client', 'subscription', 'created_by').all()
    serializer_class = FinanceTransactionSerializer

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
        if date_from:
            queryset = queryset.filter(paid_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(paid_at__date__lte=date_to)
        return queryset.order_by('-paid_at', '-created_at')

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class ChatMessageViewSet(BaseAuthenticatedViewSet):
    queryset = ChatMessage.objects.select_related('sender', 'client').filter(is_deleted=False)
    serializer_class = ChatMessageSerializer

    def get_queryset(self):
        return super().get_queryset().order_by('-created_at')

    def perform_create(self, serializer):
        serializer.save(sender=self.request.user)


class StudioSettingsViewSet(BaseAuthenticatedViewSet):
    queryset = StudioSettings.objects.all()
    serializer_class = StudioSettingsSerializer


class ExcelImportView(APIView):
    permission_classes = (IsAuthenticated,)
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
        return Response(result, status=status.HTTP_200_OK)


class DashboardStatsView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        today = timezone.localdate()
        ending_date = today + timedelta(days=7)
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
                'income_today': _decimal(
                    FinanceTransaction.objects.filter(
                        transaction_type=FinanceTransaction.Type.INCOME,
                        paid_at__date=today,
                    ).aggregate(total=Sum('amount'))['total']
                ),
                'income_month': _decimal(
                    FinanceTransaction.objects.filter(
                        transaction_type=FinanceTransaction.Type.INCOME,
                        paid_at__year=today.year,
                        paid_at__month=today.month,
                    ).aggregate(total=Sum('amount'))['total']
                ),
            }
        )


class ReportsSummaryView(APIView):
    permission_classes = (IsAuthenticated,)

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
