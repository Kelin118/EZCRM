from django.conf import settings
from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Client(TimeStampedModel):
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100, blank=True)
    parent_name = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    birth_date = models.DateField(null=True, blank=True)
    school_class = models.CharField(max_length=30, blank=True)
    direction = models.CharField(max_length=120, blank=True)
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='managed_clients',
    )
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        full_name = f'{self.first_name} {self.last_name}'.strip()
        return full_name or self.phone or f'Client #{self.pk}'


class Subscription(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        PAUSED = 'paused', 'Paused'
        EXPIRED = 'expired', 'Expired'
        CANCELLED = 'cancelled', 'Cancelled'

    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='subscriptions')
    title = models.CharField(max_length=120)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    total_visits = models.PositiveIntegerField(default=0)
    remaining_visits = models.PositiveIntegerField(default=0)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    paid_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    purchase_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    finance_transaction = models.OneToOneField(
        'FinanceTransaction',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='subscription_payment',
    )

    def __str__(self):
        return f'{self.client} - {self.title}'


class Visit(TimeStampedModel):
    class Status(models.TextChoices):
        ATTENDED = 'attended', 'Attended'
        MISSED = 'missed', 'Missed'
        MAKEUP = 'makeup', 'Makeup'
        FROZEN = 'frozen', 'Frozen'
        TRIAL = 'trial', 'Trial'
        PLANNED = 'planned', 'Planned'
        CANCELLED = 'cancelled', 'Cancelled'

    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='visits')
    subscription = models.ForeignKey(
        Subscription,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='visits',
    )
    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='teaching_visits',
    )
    visited_at = models.DateTimeField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PLANNED)
    lesson_deducted = models.BooleanField(default=False)
    notes = models.TextField(blank=True)

    def __str__(self):
        return f'{self.client} - {self.visited_at:%Y-%m-%d %H:%M}'


class Trial(TimeStampedModel):
    class Status(models.TextChoices):
        NEW = 'new', 'New'
        SCHEDULED = 'scheduled', 'Scheduled'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'

    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='trials')
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='managed_trials',
    )
    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='trial_lessons',
    )
    scheduled_at = models.DateTimeField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW)
    payment_date = models.DateField(null=True, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    finance_transaction = models.OneToOneField(
        'FinanceTransaction',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='trial_payment',
    )
    bought_subscription = models.BooleanField(default=False)
    notes = models.TextField(blank=True)

    def __str__(self):
        return f'Trial: {self.client} - {self.scheduled_at:%Y-%m-%d %H:%M}'


class MasterClass(TimeStampedModel):
    class Stage(models.TextChoices):
        PLANNED = 'planned', 'Planned'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'

    title = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='managed_master_classes',
    )
    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='master_classes',
    )
    starts_at = models.DateTimeField()
    stage = models.CharField(max_length=20, choices=Stage.choices, default=Stage.PLANNED)
    payment_date = models.DateField(null=True, blank=True)
    payment_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    capacity = models.PositiveIntegerField(default=0)
    participants = models.ManyToManyField(Client, blank=True, related_name='master_classes')
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    finance_transaction = models.OneToOneField(
        'FinanceTransaction',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='master_class_payment',
    )

    def __str__(self):
        return self.title


class Task(TimeStampedModel):
    class Status(models.TextChoices):
        TODO = 'todo', 'To do'
        IN_PROGRESS = 'in_progress', 'In progress'
        DONE = 'done', 'Done'
        CANCELLED = 'cancelled', 'Cancelled'

    title = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tasks',
    )
    client = models.ForeignKey(Client, on_delete=models.SET_NULL, null=True, blank=True, related_name='tasks')
    due_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TODO)

    def __str__(self):
        return self.title


class FinanceTransaction(TimeStampedModel):
    class Type(models.TextChoices):
        INCOME = 'income', 'Income'
        EXPENSE = 'expense', 'Expense'

    transaction_type = models.CharField(max_length=20, choices=Type.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    source = models.CharField(max_length=100, blank=True)
    payment_method = models.CharField(max_length=50, blank=True)
    client = models.ForeignKey(
        Client,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_transactions',
    )
    subscription = models.ForeignKey(
        Subscription,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_transactions',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finance_transactions',
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    comment = models.TextField(blank=True)

    def __str__(self):
        return f'{self.get_transaction_type_display()} {self.amount}'


class ChatMessage(TimeStampedModel):
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sent_messages')
    client = models.ForeignKey(Client, on_delete=models.SET_NULL, null=True, blank=True, related_name='chat_messages')
    text = models.TextField()
    is_read = models.BooleanField(default=False)
    is_deleted = models.BooleanField(default=False)

    def __str__(self):
        return f'Message from {self.sender}'


class StudioSettings(TimeStampedModel):
    studio_name = models.CharField(max_length=150, default='EDUCRM')
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    currency = models.CharField(max_length=10, default='KZT')
    default_price_ab4 = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    default_price_ab8 = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    default_price_trial = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    default_price_master_class = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        verbose_name = 'Studio settings'
        verbose_name_plural = 'Studio settings'

    def __str__(self):
        return self.studio_name
