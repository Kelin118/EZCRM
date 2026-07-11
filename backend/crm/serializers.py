from decimal import Decimal

from rest_framework import serializers
from django.utils import timezone

from .group_schedule import (
    DAY_TO_WEEKDAY,
    group_future_dates,
    normalize_schedule_days,
    schedule_display,
    subscription_expected_end_date,
    subscription_group,
    subscription_planned_lessons_left,
    subscription_remaining_lessons,
    subscription_used_lessons,
)
from .branch_filters import PSEUDO_BRANCH_NAMES
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
    PaymentMethod,
    Room,
    ScheduleSlot,
    StudioSettings,
    StudyGroup,
    SubscriptionAddon,
    Subject,
    Subscription,
    Task,
    Trial,
    Visit,
)
from .subscription_addons import addons_total, sync_subscription_addons, total_price, validate_addons_payload
from .subscription_dates import calculate_subscription_end_date

class BranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = '__all__'

    def validate_name(self, value):
        if value.strip().casefold() in PSEUDO_BRANCH_NAMES:
            raise serializers.ValidationError('Это служебное значение фильтра, а не реальный филиал.')
        return value


class BranchNameMixin(serializers.Serializer):
    branch_name = serializers.CharField(source='branch.name', read_only=True, default=None, allow_null=True)


class AuditLogSerializer(serializers.ModelSerializer):
    user_display = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = (
            'id',
            'user',
            'user_display',
            'action',
            'entity_type',
            'entity_id',
            'entity_name',
            'description',
            'changes',
            'ip_address',
            'user_agent',
            'created_at',
        )

    def get_user_display(self, obj):
        if not obj.user:
            return 'Система'
        return obj.user.get_full_name() or obj.user.username


class ClientSerializer(BranchNameMixin, serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = '__all__'

    def get_full_name(self, obj):
        return str(obj)

    def get_display_name(self, obj):
        return ' · '.join(filter(None, [str(obj), obj.parent_name, obj.phone]))

    def get_manager_name(self, obj):
        return obj.manager.get_full_name() or obj.manager.username if obj.manager else ''


class SubjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = '__all__'


class RoomSerializer(BranchNameMixin, serializers.ModelSerializer):
    class Meta:
        model = Room
        fields = '__all__'


class StudyGroupSerializer(BranchNameMixin, serializers.ModelSerializer):
    subject_name = serializers.SerializerMethodField()
    room_name = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()
    students_count = serializers.SerializerMethodField()
    schedule_display = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()
    upcoming_lessons = serializers.SerializerMethodField()
    student_summaries = serializers.SerializerMethodField()

    class Meta:
        model = StudyGroup
        fields = '__all__'

    def get_subject_name(self, obj):
        return obj.subject.name if obj.subject else ''

    def get_room_name(self, obj):
        return obj.room.name if obj.room else ''

    def get_teacher_name(self, obj):
        return obj.teacher.get_full_name() or obj.teacher.username if obj.teacher else ''

    def get_manager_name(self, obj):
        return obj.manager.get_full_name() or obj.manager.username if obj.manager else ''

    def get_students_count(self, obj):
        return obj.memberships.filter(status=GroupMembership.Status.ACTIVE).count()

    def get_schedule_display(self, obj):
        return schedule_display(obj) or 'Не указано'

    def get_is_active(self, obj):
        return obj.status == StudyGroup.Status.ACTIVE

    def get_upcoming_lessons(self, obj):
        return [
            {
                'date': item.isoformat(),
                'weekday': item.weekday(),
                'start_time': obj.start_time.strftime('%H:%M') if obj.start_time else '',
                'end_time': obj.end_time.strftime('%H:%M') if obj.end_time else '',
            }
            for item in group_future_dates(obj, 5)
        ]

    def get_student_summaries(self, obj):
        summaries = []
        memberships = obj.memberships.select_related('client').filter(status=GroupMembership.Status.ACTIVE)
        for membership in memberships:
            subscription = (
                Subscription.objects.filter(client=membership.client, status=Subscription.Status.ACTIVE)
                .order_by('-start_date', '-created_at')
                .first()
            )
            summaries.append(
                {
                    'client': membership.client_id,
                    'client_name': str(membership.client),
                    'subscription': subscription.id if subscription else None,
                    'subscription_title': subscription.title if subscription else '',
                    'remaining_lessons': subscription_remaining_lessons(subscription) if subscription else None,
                    'expected_end_date': subscription_expected_end_date(subscription) if subscription else None,
                }
            )
        return summaries


class GroupMembershipSerializer(serializers.ModelSerializer):
    group_name = serializers.SerializerMethodField()
    client_name = serializers.SerializerMethodField()
    client_phone = serializers.SerializerMethodField()

    class Meta:
        model = GroupMembership
        fields = '__all__'

    def get_group_name(self, obj):
        return obj.group.name if obj.group else ''

    def get_client_name(self, obj):
        return str(obj.client) if obj.client else ''

    def get_client_phone(self, obj):
        return obj.client.phone if obj.client else ''


class ScheduleSlotSerializer(BranchNameMixin, serializers.ModelSerializer):
    group_name = serializers.SerializerMethodField()
    subject_name = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()
    room_name = serializers.SerializerMethodField()
    weekday_display = serializers.SerializerMethodField()

    class Meta:
        model = ScheduleSlot
        fields = '__all__'

    def get_group_name(self, obj):
        return obj.group.name if obj.group else ''

    def get_subject_name(self, obj):
        return obj.subject.name if obj.subject else ''

    def get_teacher_name(self, obj):
        return obj.teacher.get_full_name() or obj.teacher.username if obj.teacher else ''

    def get_room_name(self, obj):
        return obj.room.name if obj.room else ''

    def get_weekday_display(self, obj):
        return obj.get_weekday_display()


class LessonSerializer(BranchNameMixin, serializers.ModelSerializer):
    group_name = serializers.SerializerMethodField()
    subject_name = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()
    room_name = serializers.SerializerMethodField()
    status_display = serializers.SerializerMethodField()
    visits_count = serializers.SerializerMethodField()
    attended_count = serializers.SerializerMethodField()
    missed_count = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = '__all__'

    def get_group_name(self, obj):
        return obj.group.name if obj.group else ''

    def get_subject_name(self, obj):
        return obj.subject.name if obj.subject else ''

    def get_teacher_name(self, obj):
        return obj.teacher.get_full_name() or obj.teacher.username if obj.teacher else ''

    def get_room_name(self, obj):
        return obj.room.name if obj.room else ''

    def get_status_display(self, obj):
        return obj.get_status_display()

    def get_visits_count(self, obj):
        return obj.visits.count()

    def get_attended_count(self, obj):
        return obj.visits.filter(status=Visit.Status.ATTENDED).count()

    def get_missed_count(self, obj):
        return obj.visits.filter(status=Visit.Status.MISSED).count()


class SubscriptionAddonSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionAddon
        fields = ('id', 'catalog_item', 'name', 'unit_price', 'quantity', 'total_price')
        read_only_fields = fields


class SubscriptionSerializer(BranchNameMixin, serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    client_phone = serializers.SerializerMethodField()
    lessons_total = serializers.IntegerField(source='total_visits', read_only=True)
    lessons_left = serializers.IntegerField(source='remaining_visits', read_only=True)
    used_lessons = serializers.SerializerMethodField()
    remaining_lessons = serializers.SerializerMethodField()
    planned_lessons_left = serializers.SerializerMethodField()
    expected_end_date = serializers.SerializerMethodField()
    service_name = serializers.CharField(source='service.name', read_only=True, default='')
    service_price = serializers.DecimalField(source='service.price', max_digits=10, decimal_places=2, read_only=True)
    addons = serializers.JSONField(required=False)
    addons_total = serializers.SerializerMethodField()
    total_price = serializers.SerializerMethodField()
    payment_method = serializers.PrimaryKeyRelatedField(
        queryset=PaymentMethod.objects.filter(is_active=True), write_only=True, required=False, allow_null=True,
    )

    class Meta:
        model = Subscription
        fields = '__all__'
        extra_kwargs = {'title': {'required': False}, 'start_date': {'required': False}}

    def get_client_name(self, obj):
        return str(obj.client)

    def get_client_phone(self, obj):
        return obj.client.phone if obj.client else ''

    def get_used_lessons(self, obj):
        return subscription_used_lessons(obj)

    def get_remaining_lessons(self, obj):
        return subscription_remaining_lessons(obj)

    def get_planned_lessons_left(self, obj):
        return subscription_planned_lessons_left(obj)

    def get_expected_end_date(self, obj):
        return subscription_expected_end_date(obj)

    def get_addons_total(self, obj):
        return addons_total(obj)

    def get_total_price(self, obj):
        return total_price(obj)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['addons'] = SubscriptionAddonSerializer(instance.subscription_addons.all(), many=True).data
        return data

    def validate_service(self, service):
        if service and (service.category != CatalogItem.Category.SERVICE or not service.is_active):
            raise serializers.ValidationError('Выберите активную услугу.')
        return service

    def validate_addons(self, value):
        return validate_addons_payload(value)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        initial_data = getattr(self, 'initial_data', {})
        addons = attrs.get('addons')
        service = attrs.get('service', self.instance.service if self.instance else None)
        if service:
            attrs['title'] = service.name
            if 'price' not in initial_data:
                attrs['price'] = service.price
            if 'paid_amount' not in initial_data and self.instance is None and attrs.get('payment_method'):
                addons_sum = sum((item['catalog_item'].price * item['quantity'] for item in (addons or [])), Decimal('0'))
                attrs['paid_amount'] = service.price + addons_sum
            if service.lessons_count and ('total_visits' not in initial_data or initial_data.get('total_visits') in (None, '')):
                attrs['total_visits'] = service.lessons_count
            if service.lessons_count:
                service_changed = self.instance is None or attrs.get('service') is not None
                if self.instance is None:
                    attrs['remaining_visits'] = service.lessons_count
                elif service_changed and ('remaining_visits' not in initial_data or initial_data.get('remaining_visits') in (None, '')):
                    used_lessons = subscription_used_lessons(self.instance)
                    attrs['remaining_visits'] = max(service.lessons_count - used_lessons, 0)

            if self.instance is None and not attrs.get('start_date'):
                attrs['start_date'] = timezone.localdate()

            should_calculate_end_date = 'end_date' not in initial_data
            if should_calculate_end_date:
                start_date = attrs.get('start_date') or (self.instance.start_date if self.instance else None)
                lessons_count = attrs.get('total_visits') or getattr(service, 'lessons_count', None)
                group = self._subscription_group(attrs)
                calculated_end_date = calculate_subscription_end_date(
                    start_date,
                    lessons_count=lessons_count,
                    validity_days=service.validity_days,
                    group=group,
                    service_schedule_days=service.schedule_days,
                )
                if calculated_end_date:
                    attrs['end_date'] = calculated_end_date
        elif self.instance is None and not attrs.get('start_date'):
            raise serializers.ValidationError({'start_date': 'Укажите дату начала.'})
        return attrs

    def create(self, validated_data):
        addons = validated_data.pop('addons', [])
        payment_method = validated_data.pop('payment_method', None)
        subscription = super().create(validated_data)
        subscription.selected_payment_method = payment_method
        sync_subscription_addons(subscription, addons)
        return subscription

    def update(self, instance, validated_data):
        has_addons = 'addons' in validated_data
        addons = validated_data.pop('addons', [])
        validated_data.pop('payment_method', None)
        subscription = super().update(instance, validated_data)
        if has_addons:
            sync_subscription_addons(subscription, addons)
        return subscription

    def _subscription_group(self, attrs):
        if self.instance:
            return subscription_group(self.instance)
        client = attrs.get('client')
        if not client:
            return None
        membership = (
            GroupMembership.objects.select_related('group')
            .filter(client=client, status=GroupMembership.Status.ACTIVE)
            .order_by('joined_at', 'id')
            .first()
        )
        return membership.group if membership else None


class VisitSerializer(BranchNameMixin, serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    client_phone = serializers.SerializerMethodField()
    group_name = serializers.SerializerMethodField()
    subscription_title = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()
    lesson_title = serializers.SerializerMethodField()
    lesson_display = serializers.SerializerMethodField()
    date = serializers.SerializerMethodField()

    class Meta:
        model = Visit
        fields = '__all__'

    def get_client_name(self, obj):
        return str(obj.client)

    def get_client_phone(self, obj):
        return obj.client.phone if obj.client else ''

    def get_group_name(self, obj):
        return obj.lesson.group.name if obj.lesson and obj.lesson.group else ''

    def get_subscription_title(self, obj):
        return obj.subscription.title if obj.subscription else ''

    def get_teacher_name(self, obj):
        teacher = obj.teacher or (obj.lesson.teacher if obj.lesson else None)
        return teacher.get_full_name() or teacher.username if teacher else ''

    def get_lesson_title(self, obj):
        return str(obj.lesson) if obj.lesson else ''

    def get_lesson_display(self, obj):
        if not obj.lesson:
            return ''
        parts = [
            obj.lesson.subject.name if obj.lesson.subject else '',
            obj.lesson.topic,
            obj.lesson.start_time.strftime('%H:%M') if obj.lesson.start_time else '',
        ]
        return ' · '.join(filter(None, parts)) or str(obj.lesson)

    def get_date(self, obj):
        return obj.visited_at.date() if obj.visited_at else None


class TrialSerializer(BranchNameMixin, serializers.ModelSerializer):
    stage = serializers.CharField(source='status', required=False)
    client_name = serializers.SerializerMethodField()
    client_parent_name = serializers.SerializerMethodField()
    client_phone = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()
    subscription_title = serializers.SerializerMethodField()
    payment_method = serializers.PrimaryKeyRelatedField(queryset=PaymentMethod.objects.filter(is_active=True), write_only=True, required=False, allow_null=True)

    class Meta:
        model = Trial
        fields = '__all__'

    def get_client_name(self, obj):
        return str(obj.client)

    def get_client_parent_name(self, obj):
        return obj.client.parent_name if obj.client else ''

    def get_client_phone(self, obj):
        return obj.client.phone if obj.client else ''

    def get_manager_name(self, obj):
        return obj.manager.get_full_name() or obj.manager.username if obj.manager else ''

    def get_teacher_name(self, obj):
        return obj.teacher.get_full_name() or obj.teacher.username if obj.teacher else ''

    def get_subscription_title(self, obj):
        return obj.subscription.title if obj.subscription else ''

    def create(self, validated_data):
        payment_method = validated_data.pop('payment_method', None)
        instance = super().create(validated_data)
        instance.selected_payment_method = payment_method
        return instance

    def update(self, instance, validated_data):
        validated_data.pop('payment_method', None)
        return super().update(instance, validated_data)


class MasterClassSerializer(BranchNameMixin, serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    client_phone = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()
    client = serializers.PrimaryKeyRelatedField(
        queryset=Client.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    payment_method = serializers.PrimaryKeyRelatedField(queryset=PaymentMethod.objects.filter(is_active=True), write_only=True, required=False, allow_null=True)

    class Meta:
        model = MasterClass
        fields = '__all__'

    def get_client_name(self, obj):
        client = obj.participants.first()
        return str(client) if client else ''

    def get_client_phone(self, obj):
        client = obj.participants.first()
        return client.phone if client else ''

    def get_manager_name(self, obj):
        return obj.manager.get_full_name() or obj.manager.username if obj.manager else ''

    def get_teacher_name(self, obj):
        return obj.teacher.get_full_name() or obj.teacher.username if obj.teacher else ''

    def create(self, validated_data):
        client = validated_data.pop('client', None)
        payment_method = validated_data.pop('payment_method', None)
        if client and not validated_data.get('branch'):
            validated_data['branch'] = client.branch
        master_class = super().create(validated_data)
        if client:
            master_class.participants.add(client)
        master_class.selected_payment_method = payment_method
        return master_class

    def update(self, instance, validated_data):
        client = validated_data.pop('client', None)
        validated_data.pop('payment_method', None)
        if client and not validated_data.get('branch') and not instance.branch_id:
            validated_data['branch'] = client.branch
        master_class = super().update(instance, validated_data)
        if client:
            master_class.participants.add(client)
        return master_class


class TaskSerializer(BranchNameMixin, serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    assigned_to_name = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = '__all__'

    def get_client_name(self, obj):
        return str(obj.client) if obj.client else ''

    def get_assigned_to_name(self, obj):
        return obj.assigned_to.get_full_name() or obj.assigned_to.username if obj.assigned_to else ''


class FinanceTransactionSerializer(BranchNameMixin, serializers.ModelSerializer):
    type = serializers.CharField(source='transaction_type', read_only=True)
    client_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    created_by_roles = serializers.SerializerMethodField()

    class Meta:
        model = FinanceTransaction
        fields = '__all__'
        read_only_fields = ('created_by', 'payment_method_name')

    def get_client_name(self, obj):
        return str(obj.client) if obj.client else ''

    def get_created_by_name(self, obj):
        return (obj.created_by.get_full_name() or obj.created_by.username) if obj.created_by else None

    def get_created_by_roles(self, obj):
        return obj.created_by.get_roles() if obj.created_by and hasattr(obj.created_by, 'get_roles') else []

    def validate_payment_method(self, value):
        if value and not value.is_active:
            raise serializers.ValidationError('Выберите активный способ оплаты.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        amount = attrs.get('amount', self.instance.amount if self.instance else 0)
        method = attrs.get('payment_method', self.instance.payment_method if self.instance else None)
        if amount and amount > 0 and not method and self.instance is None:
            raise serializers.ValidationError({'payment_method': 'Выберите способ оплаты.'})
        return attrs

    def create(self, validated_data):
        payment_method = validated_data.get('payment_method')
        validated_data['payment_method_name'] = payment_method.name if payment_method else ''
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if 'payment_method' in validated_data:
            payment_method = validated_data.get('payment_method')
            validated_data['payment_method_name'] = payment_method.name if payment_method else instance.payment_method_name
        return super().update(instance, validated_data)


class PaymentMethodSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentMethod
        fields = '__all__'
        read_only_fields = ('created_at', 'updated_at')

    def validate_name(self, value):
        queryset = PaymentMethod.objects.filter(name__iexact=value.strip())
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError('Способ оплаты с таким названием уже существует.')
        return value.strip()


class ChatMessageSerializer(serializers.ModelSerializer):
    sender = serializers.PrimaryKeyRelatedField(read_only=True)
    sender_name = serializers.SerializerMethodField()

    class Meta:
        model = ChatMessage
        fields = '__all__'
        read_only_fields = ('sender',)

    def get_sender_name(self, obj):
        return obj.sender.get_full_name() or obj.sender.username


class StudioSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudioSettings
        fields = '__all__'


class CatalogItemSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source='get_category_display', read_only=True)

    class Meta:
        model = CatalogItem
        fields = '__all__'
        read_only_fields = ('created_at', 'updated_at')

    def validate_price(self, value):
        if value < 0:
            raise serializers.ValidationError('Цена не может быть отрицательной.')
        return value

    def validate_schedule_days(self, value):
        if value in (None, ''):
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError('Дни недели должны быть списком.')
        normalized = normalize_schedule_days(value)
        if len(normalized) != len(value):
            allowed = ', '.join(DAY_TO_WEEKDAY.keys())
            raise serializers.ValidationError(f'Дни недели должны быть из списка: {allowed}.')
        return normalized
