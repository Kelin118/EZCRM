from django.contrib import admin

from .models import (
    AddonSale,
    AddonSaleItem,
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


@admin.register(PaymentMethod)
class PaymentMethodAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'is_active', 'sort_order')
    list_filter = ('is_active',)
    search_fields = ('name', 'code', 'description')


@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ('sender', 'client', 'is_read', 'created_at')
    list_filter = ('is_read', 'created_at')
    search_fields = ('sender__username', 'client__first_name', 'client__last_name', 'text')


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
