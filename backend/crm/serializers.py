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
    class Meta:
        model = Client
        fields = '__all__'


class SubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subscription
        fields = '__all__'


class VisitSerializer(serializers.ModelSerializer):
    class Meta:
        model = Visit
        fields = '__all__'


class TrialSerializer(serializers.ModelSerializer):
    stage = serializers.CharField(source='status', required=False)

    class Meta:
        model = Trial
        fields = '__all__'


class MasterClassSerializer(serializers.ModelSerializer):
    class Meta:
        model = MasterClass
        fields = '__all__'


class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = '__all__'


class FinanceTransactionSerializer(serializers.ModelSerializer):
    type = serializers.CharField(source='transaction_type', required=False)

    class Meta:
        model = FinanceTransaction
        fields = '__all__'


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
