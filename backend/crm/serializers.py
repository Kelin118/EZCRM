from rest_framework import serializers

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


class ClientSerializer(serializers.ModelSerializer):
    manager_name = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = '__all__'

    def get_manager_name(self, obj):
        return obj.manager.get_full_name() or obj.manager.username if obj.manager else ''


class SubscriptionSerializer(serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    lessons_total = serializers.IntegerField(source='total_visits', read_only=True)
    lessons_left = serializers.IntegerField(source='remaining_visits', read_only=True)
    used_lessons = serializers.SerializerMethodField()

    class Meta:
        model = Subscription
        fields = '__all__'

    def get_client_name(self, obj):
        return str(obj.client)

    def get_used_lessons(self, obj):
        return max((obj.total_visits or 0) - (obj.remaining_visits or 0), 0)


class VisitSerializer(serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()

    class Meta:
        model = Visit
        fields = '__all__'

    def get_client_name(self, obj):
        return str(obj.client)


class TrialSerializer(serializers.ModelSerializer):
    stage = serializers.CharField(source='status', required=False)
    client_name = serializers.SerializerMethodField()

    class Meta:
        model = Trial
        fields = '__all__'

    def get_client_name(self, obj):
        return str(obj.client)


class MasterClassSerializer(serializers.ModelSerializer):
    client_names = serializers.SerializerMethodField()
    client = serializers.PrimaryKeyRelatedField(queryset=Client.objects.all(), write_only=True, required=False)

    class Meta:
        model = MasterClass
        fields = '__all__'

    def get_client_names(self, obj):
        return [str(client) for client in obj.participants.all()]

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

    class Meta:
        model = Task
        fields = '__all__'

    def get_client_name(self, obj):
        return str(obj.client) if obj.client else ''


class FinanceTransactionSerializer(serializers.ModelSerializer):
    type = serializers.CharField(source='transaction_type', required=False)
    client_name = serializers.SerializerMethodField()

    class Meta:
        model = FinanceTransaction
        fields = '__all__'

    def get_client_name(self, obj):
        return str(obj.client) if obj.client else ''


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
