from django.contrib import admin

from .models import (
    AddonSale,
    AddonSaleItem,
    AuditLog,
    Branch,
    CashRegisterSnapshot,
    CatalogItem,
    CertificateBatch,
    CertificateDesignAsset,
    CertificateNumberSequence,
    CertificateRedemption,
    CertificateTemplate,
    ChatMessage,
    Client,
    Discount,
    FinancePaymentPart,
    FinanceTransaction,
    GiftCertificate,
    GroupMembership,
    Lesson,
    Lead,
    LeadMessage,
    MasterClass,
    MessagingChannel,
    MessagingContact,
    MetaWebhookEvent,
    PaymentMethod,
    Room,
    ScheduleSlot,
    StudioSettings,
    StudyGroup,
    Subject,
    Subscription,
    SubscriptionAddon,
    Task,
    Trial,
    Visit,
)


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ('name', 'address', 'phone', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('name', 'address', 'phone')


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ('first_name', 'last_name', 'phone', 'email', 'is_active')
    search_fields = ('first_name', 'last_name', 'phone', 'email')
    list_filter = ('is_active',)


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ('client', 'title', 'status', 'start_date', 'end_date', 'remaining_visits', 'price')
    list_filter = ('status',)
    search_fields = ('client__first_name', 'client__last_name', 'title')


@admin.register(SubscriptionAddon)
class SubscriptionAddonAdmin(admin.ModelAdmin):
    list_display = ('subscription', 'name', 'unit_price', 'quantity', 'total_price')
    search_fields = ('subscription__title', 'subscription__client__first_name', 'subscription__client__last_name', 'name')


@admin.register(AddonSale)
class AddonSaleAdmin(admin.ModelAdmin):
    list_display = ('id', 'client', 'branch', 'total_price', 'payment_amount', 'payment_method_name', 'sale_date', 'created_by')
    list_filter = ('sale_date', 'branch', 'payment_method')
    search_fields = ('client__first_name', 'client__last_name', 'client__phone', 'items__name', 'comment')


@admin.register(AddonSaleItem)
class AddonSaleItemAdmin(admin.ModelAdmin):
    list_display = ('sale', 'name', 'unit_price', 'quantity', 'total_price')
    search_fields = ('sale__client__first_name', 'sale__client__last_name', 'name')


@admin.register(Discount)
class DiscountAdmin(admin.ModelAdmin):
    list_display = ('name', 'discount_type', 'value', 'branch', 'valid_from', 'valid_until', 'is_active')
    list_filter = ('discount_type', 'is_active', 'branch')
    search_fields = ('name', 'description')


@admin.register(Subject)
class SubjectAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_active', 'created_at')
    list_filter = ('is_active',)
    search_fields = ('name', 'description')


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ('name', 'capacity', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('name', 'description')


@admin.register(StudyGroup)
class StudyGroupAdmin(admin.ModelAdmin):
    list_display = ('name', 'subject', 'teacher', 'manager', 'status', 'start_date', 'end_date')
    list_filter = ('status', 'subject')
    search_fields = ('name', 'subject__name', 'teacher__username', 'manager__username')


@admin.register(GroupMembership)
class GroupMembershipAdmin(admin.ModelAdmin):
    list_display = ('group', 'client', 'status', 'joined_at', 'left_at')
    list_filter = ('status', 'group')
    search_fields = ('group__name', 'client__first_name', 'client__last_name', 'client__phone')


@admin.register(ScheduleSlot)
class ScheduleSlotAdmin(admin.ModelAdmin):
    list_display = ('group', 'subject', 'teacher', 'room', 'weekday', 'start_time', 'end_time', 'is_active')
    list_filter = ('weekday', 'is_active', 'room')
    search_fields = ('group__name', 'subject__name', 'teacher__username', 'room__name')


@admin.register(Lesson)
class LessonAdmin(admin.ModelAdmin):
    list_display = ('lesson_date', 'start_time', 'group', 'subject', 'teacher', 'room', 'status')
    list_filter = ('status', 'lesson_date', 'room')
    search_fields = ('group__name', 'subject__name', 'teacher__username', 'topic')


@admin.register(Visit)
class VisitAdmin(admin.ModelAdmin):
    list_display = ('client', 'teacher', 'visited_at', 'status')
    list_filter = ('status', 'visited_at')
    search_fields = ('client__first_name', 'client__last_name')


@admin.register(Trial)
class TrialAdmin(admin.ModelAdmin):
    list_display = ('client', 'teacher', 'scheduled_at', 'status', 'price')
    list_filter = ('status', 'scheduled_at')
    search_fields = ('client__first_name', 'client__last_name')


@admin.register(MasterClass)
class MasterClassAdmin(admin.ModelAdmin):
    list_display = ('title', 'teacher', 'starts_at', 'capacity', 'price')
    list_filter = ('starts_at',)
    search_fields = ('title',)


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ('title', 'assigned_to', 'client', 'due_at', 'status')
    list_filter = ('status', 'due_at')
    search_fields = ('title', 'client__first_name', 'client__last_name')


@admin.register(FinanceTransaction)
class FinanceTransactionAdmin(admin.ModelAdmin):
    list_display = ('transaction_type', 'amount', 'client', 'subscription', 'paid_at')
    list_filter = ('transaction_type', 'paid_at')
    search_fields = ('client__first_name', 'client__last_name', 'comment')


@admin.register(FinancePaymentPart)
class FinancePaymentPartAdmin(admin.ModelAdmin):
    list_display = ('transaction', 'payment_method_name', 'amount')
    list_filter = ('payment_method',)
    search_fields = ('transaction__comment', 'payment_method_name')


@admin.register(CertificateTemplate)
class CertificateTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'amount_type', 'fixed_amount', 'min_amount', 'max_amount', 'validity_days', 'sale_discount_percent', 'background_asset', 'is_active')
    list_filter = ('amount_type', 'is_active')
    search_fields = ('name', 'title', 'subtitle', 'description')


@admin.register(CertificateBatch)
class CertificateBatchAdmin(admin.ModelAdmin):
    list_display = ('id', 'purchaser_name', 'purchaser_phone_snapshot', 'quantity', 'total_sale_price', 'issued_at', 'created_by')
    list_filter = ('issued_at',)
    search_fields = ('purchaser_name', 'purchaser_phone', 'purchaser_phone_snapshot', 'certificates__code')


@admin.register(CertificateDesignAsset)
class CertificateDesignAssetAdmin(admin.ModelAdmin):
    list_display = ('file_name', 'mime_type', 'file_size', 'sha256', 'created_by', 'created_at')
    search_fields = ('file_name', 'sha256')
    readonly_fields = ('public_token', 'sha256', 'file_size', 'mime_type', 'created_at', 'updated_at')


@admin.register(CertificateNumberSequence)
class CertificateNumberSequenceAdmin(admin.ModelAdmin):
    list_display = ('id', 'last_number', 'updated_at')
    readonly_fields = ('updated_at',)


@admin.register(GiftCertificate)
class GiftCertificateAdmin(admin.ModelAdmin):
    list_display = ('serial_code', 'code', 'template_name', 'purchaser_client', 'recipient_name', 'face_value', 'remaining_amount', 'visits_count', 'last_visit', 'valid_until', 'status')
    list_filter = ('status', 'template')
    search_fields = (
        'serial_number', 'code', 'recipient_name', 'recipient_phone',
        'batch__purchaser_name', 'batch__purchaser_phone', 'batch__purchaser_phone_snapshot',
        'redemptions__visitor_phone', 'purchaser_client__first_name', 'purchaser_client__last_name',
        'purchaser_client__phone',
    )
    readonly_fields = ('public_token', 'serial_code')

    def visits_count(self, obj):
        return obj.redemptions.count()

    def last_visit(self, obj):
        redemption = obj.redemptions.first()
        return redemption.redeemed_at if redemption else None


@admin.register(CertificateRedemption)
class CertificateRedemptionAdmin(admin.ModelAdmin):
    list_display = ('certificate', 'visitor_name', 'visitor_phone', 'service_name', 'amount', 'remaining_amount_after', 'redeemed_at', 'created_by')
    search_fields = ('certificate__code', 'certificate__serial_number', 'visitor_name', 'visitor_phone', 'service_name', 'comment', 'created_by__username')


@admin.register(PaymentMethod)
class PaymentMethodAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'is_cash', 'is_active', 'sort_order')
    list_filter = ('is_cash', 'is_active')
    search_fields = ('name', 'code', 'description')


@admin.register(CashRegisterSnapshot)
class CashRegisterSnapshotAdmin(admin.ModelAdmin):
    list_display = ('branch', 'amount', 'recorded_at', 'created_by', 'created_at')
    list_filter = ('branch', 'recorded_at')
    search_fields = ('branch__name', 'comment', 'created_by__username')


@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ('sender', 'client', 'is_read', 'created_at')
    list_filter = ('is_read', 'created_at')
    search_fields = ('sender__username', 'client__first_name', 'client__last_name', 'text')


@admin.register(MessagingChannel)
class MessagingChannelAdmin(admin.ModelAdmin):
    list_display = ('provider', 'name', 'external_account_id', 'phone_number', 'branch', 'default_manager', 'is_active', 'last_webhook_at', 'last_message_at')
    list_filter = ('provider', 'is_active', 'branch')
    search_fields = ('name', 'external_account_id', 'phone_number')


@admin.register(MessagingContact)
class MessagingContactAdmin(admin.ModelAdmin):
    list_display = ('channel', 'external_contact_id', 'display_name', 'phone', 'username', 'client', 'last_message_at')
    search_fields = ('external_contact_id', 'display_name', 'phone', 'username', 'client__first_name', 'client__last_name')


@admin.register(Lead)
class LeadAdmin(admin.ModelAdmin):
    list_display = ('id', 'source', 'contact_name', 'contact_phone', 'status', 'manager', 'branch', 'unread_count', 'last_message_at')
    list_filter = ('source', 'status', 'manager', 'branch')
    search_fields = ('contact_name', 'contact_phone', 'contact_username', 'first_message', 'last_message', 'messages__text', 'messages__external_message_id')


@admin.register(LeadMessage)
class LeadMessageAdmin(admin.ModelAdmin):
    list_display = ('lead', 'direction', 'message_type', 'external_message_id', 'sent_at', 'is_read')
    list_filter = ('direction', 'message_type', 'is_read')
    search_fields = ('external_message_id', 'text', 'lead__contact_name', 'lead__contact_phone')


@admin.register(MetaWebhookEvent)
class MetaWebhookEventAdmin(admin.ModelAdmin):
    list_display = ('provider', 'event_key', 'object_type', 'processed_at', 'processing_error', 'created_at')
    search_fields = ('event_key', 'provider', 'object_type', 'processing_error')
    readonly_fields = ('payload', 'created_at', 'updated_at')


@admin.register(StudioSettings)
class StudioSettingsAdmin(admin.ModelAdmin):
    list_display = ('studio_name', 'phone', 'email', 'currency', 'default_price_ab4', 'default_price_ab8')


@admin.register(CatalogItem)
class CatalogItemAdmin(admin.ModelAdmin):
    list_display = ('name', 'price', 'category', 'is_active', 'sort_order')
    list_filter = ('category', 'is_active')
    search_fields = ('name',)


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'user', 'action', 'entity_type', 'entity_name', 'ip_address')
    list_filter = ('action', 'entity_type', 'created_at')
    search_fields = ('user__username', 'user__first_name', 'user__last_name', 'entity_name', 'description')
    readonly_fields = ('created_at',)
