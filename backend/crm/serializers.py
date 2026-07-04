from rest_framework import serializers

from .models import (
    AuditLog,
    ChatMessage,
    Client,
    FinanceTransaction,
    GroupMembership,
    Lesson,
    MasterClass,
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


class ClientSerializer(serializers.ModelSerializer):
    manager_name = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = '__all__'

    def get_manager_name(self, obj):
        return obj.manager.get_full_name() or obj.manager.username if obj.manager else ''


class SubjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = '__all__'


class RoomSerializer(serializers.ModelSerializer):
    class Meta:
        model = Room
        fields = '__all__'


class StudyGroupSerializer(serializers.ModelSerializer):
    subject_name = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()
    students_count = serializers.SerializerMethodField()

    class Meta:
        model = StudyGroup
        fields = '__all__'

    def get_subject_name(self, obj):
        return obj.subject.name if obj.subject else ''

    def get_teacher_name(self, obj):
        return obj.teacher.get_full_name() or obj.teacher.username if obj.teacher else ''

    def get_manager_name(self, obj):
        return obj.manager.get_full_name() or obj.manager.username if obj.manager else ''

    def get_students_count(self, obj):
        return obj.memberships.filter(status=GroupMembership.Status.ACTIVE).count()


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


class ScheduleSlotSerializer(serializers.ModelSerializer):
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


class LessonSerializer(serializers.ModelSerializer):
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


class SubscriptionSerializer(serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    client_phone = serializers.SerializerMethodField()
    lessons_total = serializers.IntegerField(source='total_visits', read_only=True)
    lessons_left = serializers.IntegerField(source='remaining_visits', read_only=True)
    used_lessons = serializers.SerializerMethodField()

    class Meta:
        model = Subscription
        fields = '__all__'

    def get_client_name(self, obj):
        return str(obj.client)

    def get_client_phone(self, obj):
        return obj.client.phone if obj.client else ''

    def get_used_lessons(self, obj):
        return max((obj.total_visits or 0) - (obj.remaining_visits or 0), 0)


class VisitSerializer(serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    subscription_title = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()
    lesson_title = serializers.SerializerMethodField()

    class Meta:
        model = Visit
        fields = '__all__'

    def get_client_name(self, obj):
        return str(obj.client)

    def get_subscription_title(self, obj):
        return obj.subscription.title if obj.subscription else ''

    def get_teacher_name(self, obj):
        return obj.teacher.get_full_name() or obj.teacher.username if obj.teacher else ''

    def get_lesson_title(self, obj):
        return str(obj.lesson) if obj.lesson else ''


class TrialSerializer(serializers.ModelSerializer):
    stage = serializers.CharField(source='status', required=False)
    client_name = serializers.SerializerMethodField()
    client_parent_name = serializers.SerializerMethodField()
    client_phone = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()

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


class MasterClassSerializer(serializers.ModelSerializer):
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
        master_class = super().create(validated_data)
        if client:
            master_class.participants.add(client)
        return master_class

    def update(self, instance, validated_data):
        client = validated_data.pop('client', None)
        master_class = super().update(instance, validated_data)
        if client:
            master_class.participants.add(client)
        return master_class


class TaskSerializer(serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    assigned_to_name = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = '__all__'

    def get_client_name(self, obj):
        return str(obj.client) if obj.client else ''

    def get_assigned_to_name(self, obj):
        return obj.assigned_to.get_full_name() or obj.assigned_to.username if obj.assigned_to else ''


class FinanceTransactionSerializer(serializers.ModelSerializer):
    type = serializers.CharField(source='transaction_type', required=False)
    client_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = FinanceTransaction
        fields = '__all__'

    def get_client_name(self, obj):
        return str(obj.client) if obj.client else ''

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username if obj.created_by else ''


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
