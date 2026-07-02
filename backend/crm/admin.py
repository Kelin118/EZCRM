from django.contrib import admin

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


@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ('sender', 'client', 'is_read', 'created_at')
    list_filter = ('is_read', 'created_at')
    search_fields = ('sender__username', 'client__first_name', 'client__last_name', 'text')


@admin.register(StudioSettings)
class StudioSettingsAdmin(admin.ModelAdmin):
    list_display = ('studio_name', 'phone', 'email', 'currency', 'default_price_ab4', 'default_price_ab8')
