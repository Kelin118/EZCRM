from datetime import datetime, time
from decimal import Decimal, ROUND_HALF_UP

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
    AddonSale,
    AddonSaleItem,
    AuditLog,
    Branch,
    CatalogItem,
    CertificateBatch,
    CertificateDesignAsset,
    CertificateRedemption,
    CertificateTemplate,
    ChatMessage,
    Client,
    Discount,
    FinanceTransaction,
    FinancePaymentPart,
    GiftCertificate,
    GroupMembership,
    Lesson,
    Lead,
    LeadMessage,
    MasterClass,
    MasterClassStaffAssignment,
    MessagingChannel,
    MessagingContact,
    MetaWebhookEvent,
    EmployeePayrollProfile,
    EmployeeWorkSchedule,
    PaymentMethod,
    PayrollStatement,
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
from .payment_parts import payment_parts_representation, sync_finance_payment_parts, validate_payment_parts
from .discounts import calculate_discount, validate_discount_for_sale
from .employee_worklog import get_employee_schedule_context
from .subscription_addons import addons_total, sync_subscription_addons, total_price, validate_addons_payload, validate_retail_sale_items_payload
from .subscription_dates import calculate_subscription_end_date


def user_display_name(user):
    return user.get_full_name() or user.username if user else ''


def lead_first(assignments):
    return sorted(assignments, key=lambda assignment: (0 if assignment.role == MasterClassStaffAssignment.Role.LEAD else 1, user_display_name(assignment.employee)))


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


class DiscountSerializer(BranchNameMixin, serializers.ModelSerializer):
    class Meta:
        model = Discount
        fields = '__all__'
        read_only_fields = ('created_at', 'updated_at')

    def to_internal_value(self, data):
        if isinstance(data, dict) and isinstance(data.get('value'), str):
            data = {**data, 'value': data.get('value').replace(',', '.')}
        return super().to_internal_value(data)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        discount_type = attrs.get('discount_type', self.instance.discount_type if self.instance else None)
        value = attrs.get('value', self.instance.value if self.instance else None)
        valid_from = attrs.get('valid_from', self.instance.valid_from if self.instance else None)
        valid_until = attrs.get('valid_until', self.instance.valid_until if self.instance else None)
        if value is not None:
            if value <= 0:
                raise serializers.ValidationError({'value': 'Значение скидки должно быть больше 0.'})
            if discount_type == Discount.Type.PERCENTAGE and value > 100:
                raise serializers.ValidationError({'value': 'Процентная скидка не может быть больше 100.'})
        if valid_from and valid_until and valid_until < valid_from:
            raise serializers.ValidationError({'valid_until': 'Дата окончания не может быть раньше даты начала.'})
        return attrs


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

    def validate(self, attrs):
        room = attrs.get('room', getattr(self.instance, 'room', None))
        branch = attrs.get('branch', getattr(self.instance, 'branch', None))
        if room and branch and room.branch_id and room.branch_id != branch.id:
            raise serializers.ValidationError({'room': 'Кабинет относится к другому филиалу.'})
        return attrs

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
    membership_id = serializers.IntegerField(source='id', read_only=True)
    parent_name = serializers.SerializerMethodField()
    phone = serializers.SerializerMethodField()
    client_branch = serializers.SerializerMethodField()
    client_branch_name = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()
    active_subscription = serializers.SerializerMethodField()

    class Meta:
        model = GroupMembership
        fields = '__all__'

    def get_group_name(self, obj):
        return obj.group.name if obj.group else ''

    def get_client_name(self, obj):
        return str(obj.client) if obj.client else ''

    def get_client_phone(self, obj):
        return obj.client.phone if obj.client else ''

    def get_parent_name(self, obj):
        return obj.client.parent_name if obj.client else ''

    def get_phone(self, obj):
        return obj.client.phone if obj.client else ''

    def get_client_branch(self, obj):
        return obj.client.branch_id if obj.client else None

    def get_client_branch_name(self, obj):
        return obj.client.branch.name if obj.client and obj.client.branch else ''

    def get_is_active(self, obj):
        return obj.status == GroupMembership.Status.ACTIVE

    def get_active_subscription(self, obj):
        subscription = (
            Subscription.objects.filter(client=obj.client, status=Subscription.Status.ACTIVE)
            .order_by('-start_date', '-created_at')
            .first()
        )
        if not subscription:
            return None
        return {
            'id': subscription.id,
            'name': subscription.title,
            'remaining_visits': subscription.remaining_visits,
            'end_date': subscription.end_date,
        }


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


class AddonSaleItemSerializer(serializers.ModelSerializer):
    category = serializers.SerializerMethodField()
    category_display = serializers.SerializerMethodField()

    class Meta:
        model = AddonSaleItem
        fields = ('id', 'catalog_item', 'category', 'category_display', 'name', 'unit_price', 'quantity', 'total_price')
        read_only_fields = fields

    def get_category(self, obj):
        return obj.catalog_item.category if obj.catalog_item_id and obj.catalog_item else ''

    def get_category_display(self, obj):
        category = self.get_category(obj)
        if category == CatalogItem.Category.PRODUCT:
            return 'Товар'
        if category == CatalogItem.Category.ADDON:
            return 'Дополнительная услуга'
        return category


class AddonSaleSerializer(BranchNameMixin, serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    items = serializers.JSONField()
    payment_parts = serializers.JSONField(required=False, write_only=True)
    subtotal = serializers.SerializerMethodField()
    discount = serializers.PrimaryKeyRelatedField(
        queryset=Discount.objects.all(),
        required=False,
        allow_null=True,
    )
    payment_method = serializers.PrimaryKeyRelatedField(
        queryset=PaymentMethod.objects.filter(is_active=True),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = AddonSale
        fields = (
            'id',
            'client',
            'client_name',
            'branch',
            'branch_name',
            'created_by',
            'created_by_name',
            'payment_method',
            'payment_parts',
            'payment_method_name',
            'items',
            'subtotal',
            'discount',
            'discount_name',
            'discount_type',
            'discount_value',
            'discount_amount',
            'total_price',
            'payment_amount',
            'sale_date',
            'comment',
            'finance_transaction',
            'created_at',
            'updated_at',
        )
        read_only_fields = (
            'created_by',
            'payment_method_name',
            'discount_name',
            'discount_type',
            'discount_value',
            'discount_amount',
            'total_price',
            'finance_transaction',
            'created_at',
            'updated_at',
        )

    def get_client_name(self, obj):
        return str(obj.client) if obj.client else None

    def get_created_by_name(self, obj):
        return (obj.created_by.get_full_name() or obj.created_by.username) if obj.created_by else None

    def get_subtotal(self, obj):
        return sum((item.total_price for item in obj.items.all()), Decimal('0'))

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['items'] = AddonSaleItemSerializer(instance.items.all(), many=True).data
        data['payment_parts'] = payment_parts_representation(instance.finance_transaction) if instance.finance_transaction_id else []
        return data

    def validate_items(self, value):
        items = validate_retail_sale_items_payload(value)
        if not items:
            raise serializers.ValidationError('\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0445\u043e\u0442\u044f \u0431\u044b \u043e\u0434\u0438\u043d \u0442\u043e\u0432\u0430\u0440 \u0438\u043b\u0438 \u0434\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u0443\u044e \u0443\u0441\u043b\u0443\u0433\u0443.')
        return items

    def validate_payment_method(self, value):
        if value and not value.is_active:
            raise serializers.ValidationError('Выберите активный способ оплаты.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        addons = attrs.get('items')
        if addons is None and self.instance:
            addons = [
                {'catalog_item': item.catalog_item, 'quantity': item.quantity}
                for item in self.instance.items.all()
                if item.catalog_item_id
            ]

        total = sum(
            (item['catalog_item'].price * Decimal(item['quantity']) for item in (addons or [])),
            Decimal('0'),
        )
        client = attrs.get('client', self.instance.client if self.instance else None)
        branch = attrs.get('branch', self.instance.branch if self.instance else None) or (client.branch if client else None)
        discount = attrs.get('discount', self.instance.discount if self.instance else None)
        calculation = calculate_discount(total, discount, branch=branch, calculation_date=attrs.get('sale_date'))
        attrs['discount_name'] = calculation['discount_name']
        attrs['discount_type'] = calculation['discount_type']
        attrs['discount_value'] = calculation['discount_value']
        attrs['discount_amount'] = calculation['discount_amount']
        attrs['total_price'] = calculation['total_price']

        initial_data = getattr(self, 'initial_data', {})
        if 'payment_amount' not in initial_data or initial_data.get('payment_amount') in (None, ''):
            attrs['payment_amount'] = calculation['total_price']

        payment_amount = attrs.get('payment_amount', self.instance.payment_amount if self.instance else Decimal('0'))
        if payment_amount < 0:
            raise serializers.ValidationError({'payment_amount': 'Сумма оплаты не может быть отрицательной.'})
        payment_method = attrs.get('payment_method', self.instance.payment_method if self.instance else None)
        payment_parts = initial_data.get('payment_parts')
        if payment_amount and payment_amount > 0 and not payment_method and payment_parts is None:
            raise serializers.ValidationError({'payment_method': 'Выберите способ оплаты.'})
        if payment_parts is not None:
            attrs['_payment_parts'] = validate_payment_parts(payment_parts, total_amount=payment_amount)
        return attrs

    def create(self, validated_data):
        addons = validated_data.pop('items', [])
        payment_parts = validated_data.pop('_payment_parts', None)
        validated_data.pop('payment_parts', None)
        payment_method = validated_data.get('payment_method')
        validated_data['payment_method_name'] = payment_method.name if payment_method else ''
        sale = super().create(validated_data)
        self._sync_items(sale, addons)
        sale.selected_payment_parts = payment_parts
        return sale

    def update(self, instance, validated_data):
        has_items = 'items' in validated_data
        addons = validated_data.pop('items', [])
        payment_parts = validated_data.pop('_payment_parts', None)
        validated_data.pop('payment_parts', None)
        if 'payment_method' in validated_data:
            payment_method = validated_data.get('payment_method')
            validated_data['payment_method_name'] = payment_method.name if payment_method else instance.payment_method_name
        sale = super().update(instance, validated_data)
        if has_items:
            sale.items.all().delete()
            self._sync_items(sale, addons)
        if payment_parts is not None:
            sale.selected_payment_parts = payment_parts
        return sale

    def _sync_items(self, sale, addons):
        for item in addons:
            catalog_item = item['catalog_item']
            quantity = item['quantity']
            AddonSaleItem.objects.create(
                sale=sale,
                catalog_item=catalog_item,
                name=catalog_item.name,
                unit_price=catalog_item.price,
                quantity=quantity,
                total_price=catalog_item.price * Decimal(quantity),
            )


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
    service_type = serializers.SerializerMethodField()
    service_type_display = serializers.SerializerMethodField()
    addons = serializers.JSONField(required=False)
    payment_parts = serializers.JSONField(required=False, write_only=True)
    addons_total = serializers.SerializerMethodField()
    subtotal = serializers.SerializerMethodField()
    total_price = serializers.SerializerMethodField()
    discount = serializers.PrimaryKeyRelatedField(
        queryset=Discount.objects.all(),
        required=False,
        allow_null=True,
    )
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

    def get_subtotal(self, obj):
        return Decimal(obj.price or 0) + addons_total(obj)

    def get_total_price(self, obj):
        return total_price(obj)

    def get_service_type(self, obj):
        return obj.service.service_type if obj.service_id and obj.service else CatalogItem.ServiceType.COURSE

    def get_service_type_display(self, obj):
        service_type = self.get_service_type(obj)
        return 'Лагерь' if service_type == CatalogItem.ServiceType.CAMP else 'Учебный курс'

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['addons'] = SubscriptionAddonSerializer(instance.subscription_addons.all(), many=True).data
        data['payment_parts'] = payment_parts_representation(instance.finance_transaction) if instance.finance_transaction_id else []
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
        service_changed = self.instance is None or 'service' in initial_data
        if service:
            if service_changed:
                attrs['title'] = service.name
            if service_changed and 'price' not in initial_data:
                attrs['price'] = service.price
            if service_changed and service.lessons_count and ('total_visits' not in initial_data or initial_data.get('total_visits') in (None, '')):
                attrs['total_visits'] = service.lessons_count
            if service.lessons_count:
                if self.instance is None:
                    attrs['remaining_visits'] = service.lessons_count
                elif service_changed and ('remaining_visits' not in initial_data or initial_data.get('remaining_visits') in (None, '')):
                    used_lessons = subscription_used_lessons(self.instance)
                    attrs['remaining_visits'] = max(service.lessons_count - used_lessons, 0)

            if self.instance is None and not attrs.get('start_date'):
                attrs['start_date'] = timezone.localdate()

            should_calculate_end_date = self.instance is None and 'end_date' not in initial_data
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
        effective_addons = addons
        if effective_addons is None and self.instance:
            effective_addons = [
                {'catalog_item': item.catalog_item, 'quantity': item.quantity}
                for item in self.instance.subscription_addons.all()
                if item.catalog_item_id
            ]
        effective_price = attrs.get('price', self.instance.price if self.instance else Decimal('0'))
        addons_sum = sum((item['catalog_item'].price * item['quantity'] for item in (effective_addons or [])), Decimal('0'))
        client = attrs.get('client', self.instance.client if self.instance else None)
        branch = attrs.get('branch', self.instance.branch if self.instance else None) or (client.branch if client else None)
        discount = attrs.get('discount', self.instance.discount if self.instance else None)
        calculation = calculate_discount(Decimal(effective_price or 0) + addons_sum, discount, branch=branch, calculation_date=attrs.get('purchase_date'))
        attrs['discount_name'] = calculation['discount_name']
        attrs['discount_type'] = calculation['discount_type']
        attrs['discount_value'] = calculation['discount_value']
        attrs['discount_amount'] = calculation['discount_amount']
        if 'paid_amount' not in initial_data and self.instance is None and (attrs.get('payment_method') or initial_data.get('payment_parts') is not None):
            attrs['paid_amount'] = calculation['total_price']
        paid_amount = attrs.get('paid_amount', self.instance.paid_amount if self.instance else Decimal('0'))
        if paid_amount < 0:
            raise serializers.ValidationError({'paid_amount': 'Сумма оплаты не может быть отрицательной.'})
        if self.instance is None and paid_amount > 0 and not attrs.get('purchase_date'):
            attrs['purchase_date'] = timezone.localdate()
        payment_parts = initial_data.get('payment_parts')
        if payment_parts is not None:
            attrs['_payment_parts'] = validate_payment_parts(payment_parts, total_amount=paid_amount)
        return attrs

    def create(self, validated_data):
        addons = validated_data.pop('addons', [])
        payment_parts = validated_data.pop('_payment_parts', None)
        validated_data.pop('payment_parts', None)
        payment_method = validated_data.pop('payment_method', None)
        subscription = super().create(validated_data)
        subscription.selected_payment_method = payment_method
        subscription.selected_payment_parts = payment_parts
        sync_subscription_addons(subscription, addons)
        return subscription

    def update(self, instance, validated_data):
        has_addons = 'addons' in validated_data
        addons = validated_data.pop('addons', [])
        payment_parts = validated_data.pop('_payment_parts', None)
        validated_data.pop('payment_parts', None)
        payment_method = validated_data.pop('payment_method', None)
        subscription = super().update(instance, validated_data)
        subscription.selected_payment_method = payment_method
        if payment_parts is not None:
            subscription.selected_payment_parts = payment_parts
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
    payment_parts = serializers.JSONField(required=False, write_only=True)

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

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['payment_parts'] = payment_parts_representation(instance.finance_transaction) if instance.finance_transaction_id else []
        data['payment_method'] = instance.finance_transaction.payment_method_id if instance.finance_transaction_id and instance.finance_transaction.payment_method_id else None
        data['payment_method_name'] = instance.finance_transaction.payment_method_name if instance.finance_transaction_id else ''
        return data

    def create(self, validated_data):
        payment_parts = validated_data.pop('payment_parts', None)
        payment_method = validated_data.pop('payment_method', None)
        normalized_payment_parts = None
        if payment_parts is not None:
            normalized_payment_parts = validate_payment_parts(payment_parts, total_amount=validated_data.get('price') or 0)
        instance = super().create(validated_data)
        instance.selected_payment_method = payment_method
        instance.selected_payment_parts = normalized_payment_parts
        return instance

    def update(self, instance, validated_data):
        payment_parts = validated_data.pop('payment_parts', None)
        if payment_parts is not None:
            instance.selected_payment_parts = validate_payment_parts(payment_parts, total_amount=validated_data.get('price', instance.price))
        payment_method = validated_data.pop('payment_method', None)
        instance = super().update(instance, validated_data)
        instance.selected_payment_method = payment_method
        return instance


class MasterClassStaffAssignmentSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    role_display = serializers.SerializerMethodField()
    effective_duration_minutes = serializers.SerializerMethodField()

    class Meta:
        model = MasterClassStaffAssignment
        fields = (
            'id',
            'employee',
            'employee_name',
            'role',
            'role_display',
            'is_extra_work',
            'duration_minutes',
            'effective_duration_minutes',
        )
        read_only_fields = ('id', 'employee_name', 'role_display', 'effective_duration_minutes')

    def get_employee_name(self, obj):
        return user_display_name(obj.employee)

    def get_role_display(self, obj):
        return obj.get_role_display()

    def get_effective_duration_minutes(self, obj):
        return obj.duration_minutes if obj.duration_minutes is not None else obj.master_class.duration_minutes

    def validate_employee(self, value):
        if not value or not value.is_active:
            raise serializers.ValidationError('Выберите активного сотрудника.')
        if not (getattr(value, 'is_superuser', False) or (hasattr(value, 'has_role') and value.has_role('teacher'))):
            raise serializers.ValidationError('Сотрудник должен иметь роль преподавателя.')
        return value

    def validate_duration_minutes(self, value):
        if value is not None and (value <= 0 or value > 720):
            raise serializers.ValidationError('Длительность работы мастера должна быть от 1 до 720 минут.')
        return value


class MasterClassSerializer(BranchNameMixin, serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    client_display_name = serializers.SerializerMethodField()
    client_phone = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()
    outside_regular_hours = serializers.SerializerMethodField()
    is_outside_regular_hours = serializers.SerializerMethodField()
    time_outside_regular_hours = serializers.SerializerMethodField()
    outside_regular_hours_reason = serializers.SerializerMethodField()
    staff_assignments = MasterClassStaffAssignmentSerializer(many=True, required=False)
    client = serializers.PrimaryKeyRelatedField(
        queryset=Client.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    payment_method = serializers.PrimaryKeyRelatedField(queryset=PaymentMethod.objects.filter(is_active=True), write_only=True, required=False, allow_null=True)
    payment_parts = serializers.JSONField(required=False, write_only=True)

    class Meta:
        model = MasterClass
        fields = '__all__'

    def _sync_staff_assignments(self, master_class, assignments, explicit):
        if explicit:
            master_class.staff_assignments.all().delete()
            for assignment in assignments:
                MasterClassStaffAssignment.objects.create(master_class=master_class, **assignment)
        else:
            teacher = master_class.teacher
            if teacher:
                lead = master_class.staff_assignments.filter(role=MasterClassStaffAssignment.Role.LEAD).first()
                duplicate = master_class.staff_assignments.filter(employee=teacher).exclude(role=MasterClassStaffAssignment.Role.LEAD).first()
                if duplicate and not lead:
                    duplicate.role = MasterClassStaffAssignment.Role.LEAD
                    duplicate.is_extra_work = master_class.is_extra_work
                    duplicate.duration_minutes = None
                    duplicate.save(update_fields=('role', 'is_extra_work', 'duration_minutes', 'updated_at'))
                    lead = duplicate
                elif duplicate and lead and duplicate.pk != lead.pk:
                    duplicate.delete()
                if lead:
                    lead.employee = teacher
                    lead.is_extra_work = master_class.is_extra_work
                    lead.duration_minutes = None
                    lead.save(update_fields=('employee', 'is_extra_work', 'duration_minutes', 'updated_at'))
                else:
                    MasterClassStaffAssignment.objects.create(
                        master_class=master_class,
                        employee=teacher,
                        role=MasterClassStaffAssignment.Role.LEAD,
                        is_extra_work=master_class.is_extra_work,
                        duration_minutes=None,
                    )
                master_class.staff_assignments.filter(role=MasterClassStaffAssignment.Role.LEAD).exclude(employee=teacher).delete()
            else:
                master_class.staff_assignments.filter(role=MasterClassStaffAssignment.Role.LEAD).delete()

        lead = master_class.staff_assignments.filter(role=MasterClassStaffAssignment.Role.LEAD).select_related('employee').first()
        next_teacher = lead.employee if lead else None
        next_is_extra_work = master_class.staff_assignments.filter(is_extra_work=True).exists()
        update_fields = []
        if master_class.teacher_id != (next_teacher.id if next_teacher else None):
            master_class.teacher = next_teacher
            update_fields.append('teacher')
        if master_class.is_extra_work != next_is_extra_work:
            master_class.is_extra_work = next_is_extra_work
            update_fields.append('is_extra_work')
        if update_fields:
            update_fields.append('updated_at')
            master_class.save(update_fields=update_fields)

    def _validate_staff_assignments(self, attrs, assignments, explicit):
        duration = attrs.get('duration_minutes', self.instance.duration_minutes if self.instance else None)
        if explicit:
            employee_ids = []
            lead_count = 0
            for assignment in assignments:
                employee = assignment.get('employee')
                if employee:
                    employee_ids.append(employee.id)
                if assignment.get('role') == MasterClassStaffAssignment.Role.LEAD:
                    lead_count += 1
                assignment_duration = assignment.get('duration_minutes')
                effective_duration = assignment_duration if assignment_duration is not None else duration
                if assignment.get('is_extra_work') and not effective_duration:
                    raise serializers.ValidationError({'staff_assignments': 'Для дополнительного выхода укажите длительность работы мастера.'})
            if len(employee_ids) != len(set(employee_ids)):
                raise serializers.ValidationError({'staff_assignments': 'Один сотрудник не может быть добавлен дважды.'})
            if lead_count > 1:
                raise serializers.ValidationError({'staff_assignments': 'На одном МК может быть только один основной мастер.'})
        else:
            teacher = attrs.get('teacher', self.instance.teacher if self.instance else None)
            is_extra_work = attrs.get('is_extra_work', self.instance.is_extra_work if self.instance else False)
            if is_extra_work and not teacher:
                raise serializers.ValidationError({'teacher': 'Для дополнительного выхода выберите мастера.'})
            if is_extra_work and (duration is None or duration <= 0):
                raise serializers.ValidationError({'duration_minutes': 'Для дополнительного выхода укажите длительность МК.'})

    def _primary_client(self, obj):
        return obj.participants.first()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        client = self._primary_client(instance)
        data['client'] = client.id if client else None
        data['manager_work_schedule'] = get_employee_schedule_context(
            instance.manager,
            instance.starts_at,
            instance.duration_minutes,
            schedule_cache=self.context.setdefault('employee_schedule_cache', {}),
        )
        finance_transaction = instance.finance_transaction
        payment_method = finance_transaction.payment_method if finance_transaction else None
        data['payment_method'] = payment_method.id if payment_method else None
        data['payment_method_name'] = (
            finance_transaction.payment_method_name
            if finance_transaction and finance_transaction.payment_method_name
            else (payment_method.name if payment_method else '')
        )
        data['payment_parts'] = payment_parts_representation(finance_transaction) if finance_transaction else []
        assignments = list(instance.staff_assignments.all())
        if assignments:
            data['staff_assignments'] = MasterClassStaffAssignmentSerializer(lead_first(assignments), many=True).data
        elif instance.teacher:
            data['staff_assignments'] = [{
                'id': None,
                'employee': instance.teacher_id,
                'employee_name': user_display_name(instance.teacher),
                'role': MasterClassStaffAssignment.Role.LEAD,
                'role_display': 'Основной мастер',
                'is_extra_work': instance.is_extra_work,
                'duration_minutes': None,
                'effective_duration_minutes': instance.duration_minutes,
            }]
        return data

    def get_client_name(self, obj):
        client = self._primary_client(obj)
        return str(client) if client else None

    def get_client_display_name(self, obj):
        client = self._primary_client(obj)
        if not client:
            return None
        return ' · '.join(filter(None, [str(client), client.parent_name, client.phone]))

    def get_client_phone(self, obj):
        client = self._primary_client(obj)
        return client.phone if client else ''

    def get_manager_name(self, obj):
        return obj.manager.get_full_name() or obj.manager.username if obj.manager else ''

    def get_teacher_name(self, obj):
        return obj.teacher.get_full_name() or obj.teacher.username if obj.teacher else ''

    def _local_time(self, obj):
        if not obj.starts_at:
            return None
        return timezone.localtime(obj.starts_at).time() if timezone.is_aware(obj.starts_at) else obj.starts_at.time()

    def get_outside_regular_hours(self, obj):
        local_time = self._local_time(obj)
        return bool(local_time and (local_time < time(16, 0) or local_time >= time(21, 0)))

    def get_is_outside_regular_hours(self, obj):
        return self.get_outside_regular_hours(obj)

    def get_time_outside_regular_hours(self, obj):
        return self.get_outside_regular_hours(obj)

    def get_outside_regular_hours_reason(self, obj):
        local_time = self._local_time(obj)
        if not local_time:
            return ''
        if local_time < time(16, 0):
            return 'До рабочего времени'
        if local_time >= time(21, 0):
            return 'После рабочего времени'
        return ''

    def validate(self, attrs):
        attrs = super().validate(attrs)
        staff_assignments = attrs.get('staff_assignments')
        staff_assignments_explicit = 'staff_assignments' in getattr(self, 'initial_data', {})
        duration = attrs.get('duration_minutes', self.instance.duration_minutes if self.instance else None)
        self._validate_staff_assignments(attrs, staff_assignments or [], staff_assignments_explicit)
        if duration is not None and (duration <= 0 or duration > 720):
            raise serializers.ValidationError({'duration_minutes': 'Длительность должна быть от 1 до 720 минут.'})
        price = attrs.get('price', self.instance.price if self.instance else Decimal('0'))
        branch = attrs.get('branch', self.instance.branch if self.instance else None)
        discount = attrs.get('discount', self.instance.discount if self.instance else None)
        calculation = calculate_discount(price, discount, branch=branch, calculation_date=attrs.get('payment_date'))
        attrs['discount_name'] = calculation['discount_name']
        attrs['discount_type'] = calculation['discount_type']
        attrs['discount_value'] = calculation['discount_value']
        attrs['discount_amount'] = calculation['discount_amount']
        initial_data = getattr(self, 'initial_data', {})
        if self.instance is None and 'payment_amount' not in initial_data:
            attrs['payment_amount'] = calculation['total_price']
        payment_amount = attrs.get('payment_amount', self.instance.payment_amount if self.instance else Decimal('0'))
        if payment_amount < 0:
            raise serializers.ValidationError({'payment_amount': 'Сумма оплаты не может быть отрицательной.'})
        payment_method = attrs.get('payment_method')
        payment_parts = initial_data.get('payment_parts')
        payment_method_was_sent = 'payment_method' in initial_data
        if (
            payment_amount > 0
            and not payment_method
            and payment_parts is None
            and not payment_method_was_sent
            and self.instance
            and self.instance.finance_transaction_id
        ):
            payment_method = self.instance.finance_transaction.payment_method
        if payment_amount > 0 and not payment_method and payment_parts is None:
            raise serializers.ValidationError({'payment_method': 'Payment method is required.'})
        if payment_parts is not None:
            attrs['_payment_parts'] = validate_payment_parts(payment_parts, total_amount=payment_amount)
        return attrs

    def create(self, validated_data):
        client = validated_data.pop('client', None)
        staff_assignments = validated_data.pop('staff_assignments', None)
        staff_assignments_explicit = 'staff_assignments' in getattr(self, 'initial_data', {})
        payment_parts = validated_data.pop('_payment_parts', None)
        validated_data.pop('payment_parts', None)
        payment_method = validated_data.pop('payment_method', None)
        if client and not validated_data.get('branch'):
            validated_data['branch'] = client.branch
        master_class = super().create(validated_data)
        if client:
            master_class.participants.add(client)
        self._sync_staff_assignments(master_class, staff_assignments or [], staff_assignments_explicit)
        master_class.selected_payment_method = payment_method
        master_class.selected_payment_parts = payment_parts
        return master_class

    def update(self, instance, validated_data):
        missing = object()
        client = validated_data.pop('client', missing)
        staff_assignments = validated_data.pop('staff_assignments', None)
        staff_assignments_explicit = 'staff_assignments' in getattr(self, 'initial_data', {})
        payment_parts = validated_data.pop('_payment_parts', None)
        validated_data.pop('payment_parts', None)
        payment_method = validated_data.pop('payment_method', missing)
        if client is not missing and client and not validated_data.get('branch') and not instance.branch_id:
            validated_data['branch'] = client.branch
        master_class = super().update(instance, validated_data)
        if client is not missing:
            if client:
                master_class.participants.set([client])
            else:
                master_class.participants.clear()
        self._sync_staff_assignments(master_class, staff_assignments or [], staff_assignments_explicit)
        if payment_method is not missing:
            master_class.selected_payment_method = payment_method
        elif instance.finance_transaction_id:
            master_class.selected_payment_method = instance.finance_transaction.payment_method
        if payment_parts is not None:
            master_class.selected_payment_parts = payment_parts
        return master_class


MONEY = Decimal('0.01')


def money(value):
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def certificate_template_snapshot(template):
    if not template:
        return {}
    request = None
    asset_url = ''
    if template.background_asset_id:
        asset_url = f'/api/public/certificate-assets/{template.background_asset.public_token}/'
    return {
        'name': template.name,
        'title': template.title,
        'subtitle': template.subtitle,
        'description': template.description,
        'amount_type': template.amount_type,
        'fixed_amount': str(template.fixed_amount or ''),
        'min_amount': str(template.min_amount or ''),
        'max_amount': str(template.max_amount or ''),
        'validity_days': template.validity_days,
        'sale_discount_percent': str(template.sale_discount_percent or 0),
        'background_from': template.background_from,
        'background_to': template.background_to,
        'accent_color': template.accent_color,
        'text_color': template.text_color,
        'badge_text': template.badge_text,
        'terms': template.terms,
        'background_image_url': template.background_image_url,
        'background_asset': template.background_asset_id,
        'background_asset_url': asset_url,
    }


class CertificateDesignAssetSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = CertificateDesignAsset
        fields = (
            'id', 'public_token', 'file_name', 'mime_type', 'file_size', 'width', 'height',
            'sha256', 'url', 'created_at',
        )
        read_only_fields = fields

    def get_url(self, obj):
        request = self.context.get('request')
        path = f'/api/public/certificate-assets/{obj.public_token}/'
        return request.build_absolute_uri(path) if request else path


class CertificateTemplateSerializer(serializers.ModelSerializer):
    background_asset_url = serializers.SerializerMethodField()

    class Meta:
        model = CertificateTemplate
        fields = '__all__'
        read_only_fields = ('created_at', 'updated_at')

    def get_background_asset_url(self, obj):
        if not obj.background_asset_id:
            return ''
        request = self.context.get('request')
        path = f'/api/public/certificate-assets/{obj.background_asset.public_token}/'
        return request.build_absolute_uri(path) if request else path

    def validate(self, attrs):
        attrs = super().validate(attrs)
        amount_type = attrs.get('amount_type', self.instance.amount_type if self.instance else CertificateTemplate.AmountType.FIXED)
        fixed_amount = attrs.get('fixed_amount', self.instance.fixed_amount if self.instance else None)
        min_amount = attrs.get('min_amount', self.instance.min_amount if self.instance else None)
        max_amount = attrs.get('max_amount', self.instance.max_amount if self.instance else None)
        validity_days = attrs.get('validity_days', self.instance.validity_days if self.instance else None)
        discount = attrs.get('sale_discount_percent', self.instance.sale_discount_percent if self.instance else 0)
        if amount_type == CertificateTemplate.AmountType.FIXED and money(fixed_amount) <= 0:
            raise serializers.ValidationError({'fixed_amount': '??????? ????????????? ??????? ?????? ????.'})
        if amount_type == CertificateTemplate.AmountType.RANGE:
            if money(min_amount) <= 0:
                raise serializers.ValidationError({'min_amount': '??????????? ??????? ?????? ???? ?????? ????.'})
            if max_amount is not None and money(max_amount) < money(min_amount):
                raise serializers.ValidationError({'max_amount': '???????????? ??????? ?? ????? ???? ?????? ????????????.'})
        if not validity_days or int(validity_days) <= 0:
            raise serializers.ValidationError({'validity_days': '???? ???????? ?????? ???? ?????? ????.'})
        discount_decimal = Decimal(discount or 0)
        if discount_decimal < 0 or discount_decimal > 100:
            raise serializers.ValidationError({'sale_discount_percent': '?????? ?????? ???? ?? 0 ?? 100%.'})
        return attrs


class CertificateRedemptionSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CertificateRedemption
        fields = (
            'id', 'certificate', 'amount', 'visitor_name', 'visitor_phone', 'service_name',
            'remaining_amount_after', 'comment', 'redeemed_at', 'created_by', 'created_by_name',
            'created_at',
        )
        read_only_fields = ('certificate', 'redeemed_at', 'created_by', 'created_at')

    def get_created_by_name(self, obj):
        return (obj.created_by.get_full_name() or obj.created_by.username) if obj.created_by else ''


class GiftCertificateSerializer(serializers.ModelSerializer):
    payment_parts = serializers.JSONField(required=False, write_only=True)
    redemptions = CertificateRedemptionSerializer(many=True, read_only=True)
    purchaser_client_name = serializers.SerializerMethodField()
    template_title = serializers.SerializerMethodField()
    public_url = serializers.SerializerMethodField()
    status_display = serializers.SerializerMethodField()
    design = serializers.SerializerMethodField()
    serial_code = serializers.CharField(read_only=True)
    purchaser_name = serializers.SerializerMethodField()
    purchaser_phone = serializers.SerializerMethodField()
    visits_count = serializers.SerializerMethodField()
    last_visit = serializers.SerializerMethodField()
    background_asset_url = serializers.SerializerMethodField()

    class Meta:
        model = GiftCertificate
        fields = '__all__'
        read_only_fields = (
            'batch', 'template_name', 'template_snapshot', 'serial_number', 'code', 'public_token', 'sale_discount_percent',
            'sale_price', 'remaining_amount', 'valid_until', 'finance_transaction', 'created_by',
            'background_asset', 'sent_at', 'sent_to_phone', 'created_at', 'updated_at',
        )

    def get_purchaser_client_name(self, obj):
        return str(obj.purchaser_client) if obj.purchaser_client else ''

    def get_template_title(self, obj):
        return obj.template_snapshot.get('title') or obj.template_name

    def get_public_url(self, obj):
        request = self.context.get('request')
        path = f'/certificate/{obj.public_token}'
        return request.build_absolute_uri(path) if request else path

    def get_status_display(self, obj):
        return obj.get_status_display()

    def get_design(self, obj):
        return obj.template_snapshot or certificate_template_snapshot(obj.template)

    def get_purchaser_name(self, obj):
        if obj.batch and obj.batch.purchaser_name:
            return obj.batch.purchaser_name
        return str(obj.purchaser_client) if obj.purchaser_client else ''

    def get_purchaser_phone(self, obj):
        if obj.batch and (obj.batch.purchaser_phone_snapshot or obj.batch.purchaser_phone):
            return obj.batch.purchaser_phone_snapshot or obj.batch.purchaser_phone
        return obj.purchaser_client.phone if obj.purchaser_client else ''

    def get_visits_count(self, obj):
        return obj.redemptions.count() if hasattr(obj, 'redemptions') else 0

    def get_last_visit(self, obj):
        redemption = obj.redemptions.first()
        return redemption.redeemed_at if redemption else None

    def get_background_asset_url(self, obj):
        if not obj.background_asset_id:
            return ''
        request = self.context.get('request')
        path = f'/api/public/certificate-assets/{obj.background_asset.public_token}/'
        return request.build_absolute_uri(path) if request else path

    def to_representation(self, instance):
        instance = refresh_certificate_status(instance)
        data = super().to_representation(instance)
        transaction = instance.finance_transaction
        data['payment_parts'] = payment_parts_representation(transaction) if transaction else []
        return data

    def validate(self, attrs):
        attrs = super().validate(attrs)
        template = attrs.get('template', self.instance.template if self.instance else None)
        face_value = attrs.get('face_value', self.instance.face_value if self.instance else None)
        initial_data = getattr(self, 'initial_data', {})
        if self.instance is None:
            if not template:
                raise serializers.ValidationError({'template': '???????? ??????.'})
            if not template.is_active:
                raise serializers.ValidationError({'template': '?????? ???????????? ?????????? ??????.'})
        if money(face_value) <= 0:
            raise serializers.ValidationError({'face_value': '??????? ?????? ???? ?????? ????.'})
        if template:
            if template.amount_type == CertificateTemplate.AmountType.FIXED and money(face_value) != money(template.fixed_amount):
                raise serializers.ValidationError({'face_value': '??????? ?????? ????????? ? ????????????? ????????? ???????.'})
            if template.amount_type == CertificateTemplate.AmountType.RANGE:
                if money(face_value) < money(template.min_amount):
                    raise serializers.ValidationError({'face_value': '??????? ?????? ???????????? ???????? ???????.'})
                if template.max_amount is not None and money(face_value) > money(template.max_amount):
                    raise serializers.ValidationError({'face_value': '??????? ?????? ????????????? ???????? ???????.'})
        discount = template.sale_discount_percent if template and self.instance is None else attrs.get('sale_discount_percent', self.instance.sale_discount_percent if self.instance else 0)
        sale_price = money(money(face_value) * (Decimal('100') - Decimal(discount or 0)) / Decimal('100'))
        payment_parts = initial_data.get('payment_parts', None)
        if payment_parts is not None:
            attrs['_payment_parts'] = validate_payment_parts(payment_parts, total_amount=sale_price)
        elif self.instance is None and sale_price > 0:
            raise serializers.ValidationError({'payment_parts': '??????? ???????? ??????.'})
        attrs['_calculated_sale_price'] = sale_price
        attrs['_template_snapshot'] = certificate_template_snapshot(template)
        return attrs

    def create(self, validated_data):
        validated_data.pop('payment_parts', None)
        validated_data.pop('_payment_parts', None)
        validated_data.pop('_calculated_sale_price', None)
        validated_data.pop('_template_snapshot', None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop('payment_parts', None)
        validated_data.pop('_payment_parts', None)
        validated_data.pop('_calculated_sale_price', None)
        validated_data.pop('_template_snapshot', None)
        return super().update(instance, validated_data)


class PublicGiftCertificateSerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()
    subtitle = serializers.SerializerMethodField()
    terms = serializers.SerializerMethodField()
    design = serializers.SerializerMethodField()
    status_display = serializers.SerializerMethodField()
    serial_code = serializers.CharField(read_only=True)
    background_asset_url = serializers.SerializerMethodField()

    class Meta:
        model = GiftCertificate
        fields = (
            'serial_code', 'code', 'title', 'subtitle', 'recipient_name', 'face_value', 'remaining_amount',
            'issued_at', 'valid_until', 'status', 'status_display', 'terms', 'design', 'background_asset_url',
        )

    def get_title(self, obj):
        return obj.template_snapshot.get('title') or obj.template_name

    def get_subtitle(self, obj):
        return obj.template_snapshot.get('subtitle', '')

    def get_terms(self, obj):
        return obj.template_snapshot.get('terms', '')

    def get_design(self, obj):
        return obj.template_snapshot

    def get_status_display(self, obj):
        return obj.get_status_display()

    def get_background_asset_url(self, obj):
        if not obj.background_asset_id:
            return ''
        request = self.context.get('request')
        path = f'/api/public/certificate-assets/{obj.background_asset.public_token}/'
        return request.build_absolute_uri(path) if request else path


class CertificateBatchSerializer(serializers.ModelSerializer):
    serial_from = serializers.SerializerMethodField()
    serial_to = serializers.SerializerMethodField()

    class Meta:
        model = CertificateBatch
        fields = '__all__'

    def get_serial_from(self, obj):
        first = obj.certificates.order_by('serial_number').first()
        return first.serial_code if first else ''

    def get_serial_to(self, obj):
        last = obj.certificates.order_by('-serial_number').first()
        return last.serial_code if last else ''


def refresh_certificate_status(certificate):
    if certificate.status in {GiftCertificate.Status.ACTIVE, GiftCertificate.Status.PARTIALLY_USED} and certificate.valid_until < timezone.localdate():
        certificate.status = GiftCertificate.Status.EXPIRED
        certificate.save(update_fields=('status', 'updated_at'))
    return certificate


class MessagingChannelSerializer(serializers.ModelSerializer):
    provider_display = serializers.CharField(source='get_provider_display', read_only=True)
    branch_name = serializers.CharField(source='branch.name', read_only=True, default='')
    default_manager_name = serializers.SerializerMethodField()

    class Meta:
        model = MessagingChannel
        fields = '__all__'
        read_only_fields = ('created_at', 'updated_at', 'last_webhook_at', 'last_message_at', 'last_error')

    def get_default_manager_name(self, obj):
        return obj.default_manager.get_full_name() or obj.default_manager.username if obj.default_manager else ''


class MessagingContactSerializer(serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()

    class Meta:
        model = MessagingContact
        fields = '__all__'

    def get_client_name(self, obj):
        return str(obj.client) if obj.client else ''


class LeadMessageSerializer(serializers.ModelSerializer):
    source = serializers.CharField(source='lead.source', read_only=True)
    message_type_display = serializers.CharField(source='get_message_type_display', read_only=True)
    direction_display = serializers.CharField(source='get_direction_display', read_only=True)

    class Meta:
        model = LeadMessage
        fields = (
            'id', 'lead', 'contact', 'source', 'direction', 'direction_display', 'message_type',
            'message_type_display', 'external_message_id', 'text', 'media_id', 'media_url',
            'mime_type', 'file_name', 'sent_at', 'is_read', 'created_at',
        )
        read_only_fields = fields


class LeadSerializer(BranchNameMixin, serializers.ModelSerializer):
    source_display = serializers.CharField(source='get_source_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    manager_name = serializers.SerializerMethodField()
    client_name = serializers.SerializerMethodField()
    channel_name = serializers.SerializerMethodField()
    messages_count = serializers.SerializerMethodField()
    latest_messages = serializers.SerializerMethodField()

    class Meta:
        model = Lead
        fields = '__all__'
        read_only_fields = ('first_message_at', 'last_message_at', 'unread_count', 'converted_trial', 'closed_at', 'created_at', 'updated_at')

    def get_manager_name(self, obj):
        return obj.manager.get_full_name() or obj.manager.username if obj.manager else ''

    def get_client_name(self, obj):
        return str(obj.client) if obj.client else ''

    def get_channel_name(self, obj):
        return obj.channel.name if obj.channel else ''

    def get_messages_count(self, obj):
        return obj.messages.count()

    def get_latest_messages(self, obj):
        messages = list(obj.messages.order_by('-sent_at')[:3])
        return LeadMessageSerializer(reversed(messages), many=True).data

    def create(self, validated_data):
        now = timezone.now()
        validated_data.setdefault('source', Lead.Source.MANUAL)
        validated_data.setdefault('first_message_at', now)
        validated_data.setdefault('last_message_at', now)
        validated_data.setdefault('first_message', validated_data.get('first_message', ''))
        validated_data.setdefault('last_message', validated_data.get('last_message', validated_data.get('first_message', '')))
        if not validated_data.get('title'):
            validated_data['title'] = validated_data.get('contact_name') or validated_data.get('contact_phone') or 'Обращение'
        return super().create(validated_data)


class MetaWebhookEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = MetaWebhookEvent
        fields = '__all__'
        read_only_fields = fields


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


class FinancePaymentPartSerializer(serializers.ModelSerializer):
    is_cash = serializers.BooleanField(source='payment_method.is_cash', read_only=True)

    class Meta:
        model = FinancePaymentPart
        fields = ('id', 'payment_method', 'payment_method_name', 'is_cash', 'amount')
        read_only_fields = ('id', 'payment_method_name', 'is_cash')


class FinanceTransactionSerializer(BranchNameMixin, serializers.ModelSerializer):
    type = serializers.CharField(source='transaction_type', read_only=True)
    client_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    created_by_roles = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()
    addon_sale_summary = serializers.SerializerMethodField()
    master_class_id = serializers.SerializerMethodField()
    master_class_title = serializers.SerializerMethodField()
    master_class_teacher = serializers.SerializerMethodField()
    master_class_teacher_name = serializers.SerializerMethodField()
    master_class_starts_at = serializers.SerializerMethodField()
    master_class_duration_minutes = serializers.SerializerMethodField()
    master_class_is_extra_work = serializers.SerializerMethodField()
    master_class_staff = serializers.SerializerMethodField()
    master_class_time_outside_regular_hours = serializers.SerializerMethodField()
    master_class_outside_regular_hours = serializers.SerializerMethodField()
    master_class_outside_reason = serializers.SerializerMethodField()
    payment_parts = serializers.JSONField(required=False)

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

    def get_manager_name(self, obj):
        return (obj.manager.get_full_name() or obj.manager.username) if obj.manager else None

    def get_addon_sale_summary(self, obj):
        sale = getattr(obj, 'addon_sale', None)
        if not sale:
            return ''
        return ', '.join(f'{item.name} ×{item.quantity}' for item in sale.items.all())

    def _master_class(self, obj):
        return getattr(obj, 'master_class_payment', None)

    def get_master_class_id(self, obj):
        item = self._master_class(obj)
        return item.id if item else None

    def get_master_class_title(self, obj):
        item = self._master_class(obj)
        return item.title if item else ''

    def get_master_class_teacher(self, obj):
        item = self._master_class(obj)
        return item.teacher_id if item else None

    def get_master_class_teacher_name(self, obj):
        item = self._master_class(obj)
        if not item or not item.teacher:
            return ''
        return item.teacher.get_full_name() or item.teacher.username

    def get_master_class_starts_at(self, obj):
        item = self._master_class(obj)
        return item.starts_at if item else None

    def get_master_class_duration_minutes(self, obj):
        item = self._master_class(obj)
        return item.duration_minutes if item else None

    def get_master_class_is_extra_work(self, obj):
        item = self._master_class(obj)
        return bool(item and item.is_extra_work)

    def get_master_class_staff(self, obj):
        item = self._master_class(obj)
        if not item:
            return []
        assignments = lead_first(list(item.staff_assignments.all()))
        if not assignments and item.teacher:
            return [{
                'id': None,
                'employee': item.teacher_id,
                'employee_name': user_display_name(item.teacher),
                'role': MasterClassStaffAssignment.Role.LEAD,
                'role_display': 'Основной мастер',
                'is_extra_work': item.is_extra_work,
                'duration_minutes': None,
                'effective_duration_minutes': item.duration_minutes,
            }]
        return [
            {
                'id': assignment.id,
                'employee': assignment.employee_id,
                'employee_name': user_display_name(assignment.employee),
                'role': assignment.role,
                'role_display': assignment.get_role_display(),
                'is_extra_work': assignment.is_extra_work,
                'duration_minutes': assignment.duration_minutes,
                'effective_duration_minutes': assignment.duration_minutes if assignment.duration_minutes is not None else item.duration_minutes,
            }
            for assignment in assignments
        ]

    def get_master_class_time_outside_regular_hours(self, obj):
        return self.get_master_class_outside_regular_hours(obj)

    def _master_class_local_time(self, item):
        if not item or not item.starts_at:
            return None
        return timezone.localtime(item.starts_at).time() if timezone.is_aware(item.starts_at) else item.starts_at.time()

    def get_master_class_outside_regular_hours(self, obj):
        local_time = self._master_class_local_time(self._master_class(obj))
        return bool(local_time and (local_time < time(16, 0) or local_time >= time(21, 0)))

    def get_master_class_outside_reason(self, obj):
        local_time = self._master_class_local_time(self._master_class(obj))
        if not local_time:
            return ''
        if local_time < time(16, 0):
            return 'До рабочего времени'
        if local_time >= time(21, 0):
            return 'После рабочего времени'
        return ''

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['payment_parts'] = payment_parts_representation(instance)
        return data

    def validate_payment_method(self, value):
        if value and not value.is_active:
            raise serializers.ValidationError('Выберите активный способ оплаты.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        amount = attrs.get('amount', self.instance.amount if self.instance else 0)
        method = attrs.get('payment_method', self.instance.payment_method if self.instance else None)
        transaction_type = attrs.get('transaction_type', self.instance.transaction_type if self.instance else None)
        discount = attrs.get('discount', self.instance.discount if self.instance else None)
        initial_data = getattr(self, 'initial_data', {})
        payment_parts = initial_data.get('payment_parts', None)
        if transaction_type == FinanceTransaction.Type.EXPENSE and discount:
            raise serializers.ValidationError({'discount': 'Скидка не применяется к расходам.'})
        if amount is not None and amount < 0:
            raise serializers.ValidationError({'amount': 'Сумма операции не может быть отрицательной.'})
        if amount and amount > 0 and payment_parts is None and not method and self.instance is None:
            raise serializers.ValidationError({'payment_method': 'Выберите способ оплаты.'})
        if payment_parts is not None:
            attrs['_payment_parts'] = validate_payment_parts(payment_parts, total_amount=amount)
        return attrs

    def create(self, validated_data):
        payment_parts = validated_data.pop('_payment_parts', None)
        validated_data.pop('payment_parts', None)
        payment_method = validated_data.get('payment_method')
        validated_data['payment_method_name'] = payment_method.name if payment_method else ''
        if not validated_data.get('paid_at'):
            validated_data['paid_at'] = timezone.make_aware(datetime.combine(timezone.localdate(), time.min))
        if not validated_data.get('subtotal_amount'):
            validated_data['subtotal_amount'] = validated_data.get('amount') or 0
        discount = validated_data.get('discount')
        if discount and not validated_data.get('discount_name'):
            validated_data['discount_name'] = discount.name
        instance = super().create(validated_data)
        sync_finance_payment_parts(instance, payment_parts, legacy_payment_method=payment_method)
        return instance

    def update(self, instance, validated_data):
        payment_parts = validated_data.pop('_payment_parts', None)
        validated_data.pop('payment_parts', None)
        should_sync_parts = payment_parts is not None or 'payment_method' in validated_data or 'amount' in validated_data
        if 'payment_method' in validated_data:
            payment_method = validated_data.get('payment_method')
            validated_data['payment_method_name'] = payment_method.name if payment_method else instance.payment_method_name
        instance = super().update(instance, validated_data)
        if should_sync_parts:
            legacy_method = validated_data.get('payment_method', instance.payment_method)
            if payment_parts is None and instance.payment_parts.exists() and 'payment_method' not in validated_data:
                existing_parts = list(instance.payment_parts.all())
                if len(existing_parts) == 1 and 'amount' in validated_data:
                    payment_parts = [{'payment_method': existing_parts[0].payment_method_id, 'amount': instance.amount}]
                else:
                    payment_parts = [
                        {'payment_method': part.payment_method_id, 'amount': part.amount}
                        for part in existing_parts
                    ]
            sync_finance_payment_parts(instance, payment_parts, legacy_payment_method=legacy_method)
        return instance


class EmployeeWorkScheduleSerializer(BranchNameMixin, serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeWorkSchedule
        fields = '__all__'
        read_only_fields = ('created_at', 'updated_at')

    def get_employee_name(self, obj):
        return (obj.employee.get_full_name() or obj.employee.username) if obj.employee else ''

    def validate(self, attrs):
        attrs = super().validate(attrs)
        employee = attrs.get('employee', self.instance.employee if self.instance else None)
        weekday = attrs.get('weekday', self.instance.weekday if self.instance else None)
        start_time = attrs.get('start_time', self.instance.start_time if self.instance else None)
        end_time = attrs.get('end_time', self.instance.end_time if self.instance else None)
        valid_from = attrs.get('valid_from', self.instance.valid_from if self.instance else None)
        valid_until = attrs.get('valid_until', self.instance.valid_until if self.instance else None)
        if start_time and end_time and start_time >= end_time:
            raise serializers.ValidationError({'end_time': 'Время окончания должно быть позже начала.'})
        if valid_until and valid_from and valid_until < valid_from:
            raise serializers.ValidationError({'valid_until': 'Дата окончания должна быть позже даты начала.'})
        if employee and weekday is not None and valid_from:
            from datetime import date
            queryset = EmployeeWorkSchedule.objects.filter(employee=employee, weekday=weekday)
            if self.instance:
                queryset = queryset.exclude(pk=self.instance.pk)
            left_end = valid_until or date.max
            for item in queryset:
                right_end = item.valid_until or date.max
                if valid_from <= right_end and item.valid_from <= left_end:
                    raise serializers.ValidationError('Для сотрудника уже есть правило графика на этот день и период.')
        return attrs


class EmployeePayrollProfileSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()

    class Meta:
        model = EmployeePayrollProfile
        fields = '__all__'
        read_only_fields = ('created_at', 'updated_at')

    def get_employee_name(self, obj):
        return (obj.employee.get_full_name() or obj.employee.username) if obj.employee else ''


class PayrollStatementSerializer(BranchNameMixin, serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = PayrollStatement
        fields = '__all__'
        read_only_fields = (
            'employee',
            'branch',
            'date_from',
            'date_to',
            'pay_type_snapshot',
            'monthly_salary_snapshot',
            'regular_hourly_rate_snapshot',
            'outside_hourly_rate_snapshot',
            'outside_master_class_bonus_snapshot',
            'regular_minutes',
            'outside_minutes',
            'outside_master_class_count',
            'base_amount',
            'regular_amount',
            'outside_amount',
            'master_class_bonus_amount',
            'total_amount',
            'status',
            'finance_transaction',
            'created_by',
            'approved_by',
            'approved_at',
            'paid_at',
            'created_at',
            'updated_at',
        )

    def get_employee_name(self, obj):
        return obj.employee.get_full_name() or obj.employee.username if obj.employee else ''

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username if obj.created_by else ''

    def get_approved_by_name(self, obj):
        return obj.approved_by.get_full_name() or obj.approved_by.username if obj.approved_by else ''

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if self.instance and self.instance.status != PayrollStatement.Status.DRAFT and attrs:
            raise serializers.ValidationError('Изменять можно только черновик зарплаты.')
        return attrs


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
    service_type_display = serializers.SerializerMethodField()

    class Meta:
        model = CatalogItem
        fields = '__all__'
        read_only_fields = ('created_at', 'updated_at')

    def validate_price(self, value):
        if value < 0:
            raise serializers.ValidationError('Цена не может быть отрицательной.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        category = attrs.get('category', self.instance.category if self.instance else None)
        if category != CatalogItem.Category.SERVICE:
            attrs['service_type'] = CatalogItem.ServiceType.COURSE
        return attrs

    def get_service_type_display(self, obj):
        return 'Лагерь' if obj.service_type == CatalogItem.ServiceType.CAMP else 'Учебный курс'

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
