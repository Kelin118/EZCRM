from datetime import datetime, time
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
    AddonSale,
    AddonSaleItem,
    AuditLog,
    Branch,
    CatalogItem,
    ChatMessage,
    Client,
    Discount,
    FinanceTransaction,
    FinancePaymentPart,
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
from .payment_parts import payment_parts_representation, sync_finance_payment_parts, validate_payment_parts
from .discounts import calculate_discount, validate_discount_for_sale
from .subscription_addons import addons_total, sync_subscription_addons, total_price, validate_addons_payload, validate_retail_sale_items_payload
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


class MasterClassSerializer(BranchNameMixin, serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    client_display_name = serializers.SerializerMethodField()
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
    payment_parts = serializers.JSONField(required=False, write_only=True)

    class Meta:
        model = MasterClass
        fields = '__all__'

    def _primary_client(self, obj):
        return obj.participants.first()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        client = self._primary_client(instance)
        data['client'] = client.id if client else None
        finance_transaction = instance.finance_transaction
        payment_method = finance_transaction.payment_method if finance_transaction else None
        data['payment_method'] = payment_method.id if payment_method else None
        data['payment_method_name'] = (
            finance_transaction.payment_method_name
            if finance_transaction and finance_transaction.payment_method_name
            else (payment_method.name if payment_method else '')
        )
        data['payment_parts'] = payment_parts_representation(finance_transaction) if finance_transaction else []
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

    def validate(self, attrs):
        attrs = super().validate(attrs)
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
        payment_parts = validated_data.pop('_payment_parts', None)
        validated_data.pop('payment_parts', None)
        payment_method = validated_data.pop('payment_method', None)
        if client and not validated_data.get('branch'):
            validated_data['branch'] = client.branch
        master_class = super().create(validated_data)
        if client:
            master_class.participants.add(client)
        master_class.selected_payment_method = payment_method
        master_class.selected_payment_parts = payment_parts
        return master_class

    def update(self, instance, validated_data):
        missing = object()
        client = validated_data.pop('client', missing)
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
        if payment_method is not missing:
            master_class.selected_payment_method = payment_method
        elif instance.finance_transaction_id:
            master_class.selected_payment_method = instance.finance_transaction.payment_method
        if payment_parts is not None:
            master_class.selected_payment_parts = payment_parts
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
    addon_sale_summary = serializers.SerializerMethodField()
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

    def get_addon_sale_summary(self, obj):
        sale = getattr(obj, 'addon_sale', None)
        if not sale:
            return ''
        return ', '.join(f'{item.name} ×{item.quantity}' for item in sale.items.all())

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
