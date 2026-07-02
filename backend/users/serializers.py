from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework import serializers


User = get_user_model()


ROLE_CHOICES = {'admin', 'manager', 'teacher', 'accountant'}


def split_full_name(full_name):
    parts = (full_name or '').strip().split(maxsplit=1)
    first_name = parts[0] if parts else ''
    last_name = parts[1] if len(parts) > 1 else ''
    return first_name, last_name


def active_admins():
    return User.objects.filter(is_active=True).filter(Q(role='admin') | Q(is_superuser=True))


def would_remove_last_active_admin(instance, attrs):
    if not instance or not instance.is_active or (instance.role != 'admin' and not instance.is_superuser):
        return False

    next_role = attrs.get('role', instance.role)
    next_active = attrs.get('is_active', instance.is_active)
    remains_admin = next_active and (next_role == 'admin' or instance.is_superuser)
    return not remains_admin and active_admins().exclude(pk=instance.pk).count() == 0


class UserPublicSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ('id', 'username', 'full_name', 'phone', 'email', 'role', 'is_active', 'date_joined')
        read_only_fields = ('id', 'date_joined')

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True, min_length=8)
    full_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError('Пользователь с таким username уже существует.')
        return value

    def validate(self, attrs):
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({'password_confirm': 'Пароли не совпадают.'})
        return attrs

    def create(self, validated_data):
        first_name, last_name = split_full_name(validated_data.get('full_name'))
        user = User(
            username=validated_data['username'],
            email=validated_data.get('email', ''),
            phone=validated_data.get('phone', ''),
            first_name=first_name,
            last_name=last_name,
            role='admin',
            is_staff=True,
            is_superuser=False,
        )
        user.set_password(validated_data['password'])
        user.save()
        return user


class EmployeeSerializer(UserPublicSerializer):
    password = serializers.CharField(write_only=True, min_length=8, required=False, allow_blank=True)
    password_confirm = serializers.CharField(write_only=True, min_length=8, required=False, allow_blank=True)
    full_name = serializers.CharField(max_length=255, required=False, allow_blank=True, write_only=True)

    class Meta(UserPublicSerializer.Meta):
        fields = UserPublicSerializer.Meta.fields + ('password', 'password_confirm')

    def validate_username(self, value):
        queryset = User.objects.filter(username=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError('Пользователь с таким username уже существует.')
        return value

    def validate_role(self, value):
        if value not in ROLE_CHOICES:
            raise serializers.ValidationError('Недопустимая роль.')
        return value

    def validate(self, attrs):
        password = attrs.get('password')
        password_confirm = attrs.get('password_confirm')

        if self.instance is None and not password:
            raise serializers.ValidationError({'password': 'Пароль обязателен.'})
        if password or password_confirm:
            if password != password_confirm:
                raise serializers.ValidationError({'password_confirm': 'Пароли не совпадают.'})

        if would_remove_last_active_admin(self.instance, attrs):
            raise serializers.ValidationError({'is_active': 'Нельзя заблокировать последнего активного администратора.'})

        return attrs

    def to_representation(self, instance):
        return UserPublicSerializer(instance).data

    def create(self, validated_data):
        password = validated_data.pop('password')
        validated_data.pop('password_confirm', None)
        full_name = validated_data.pop('full_name', '')
        first_name, last_name = split_full_name(full_name)
        user = User(**validated_data, first_name=first_name, last_name=last_name)
        user.is_staff = user.role == 'admin'
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        validated_data.pop('password_confirm', None)
        full_name = validated_data.pop('full_name', None)
        if full_name is not None:
            instance.first_name, instance.last_name = split_full_name(full_name)

        for field, value in validated_data.items():
            setattr(instance, field, value)

        instance.is_staff = instance.role == 'admin' or instance.is_superuser
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class PasswordSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True, min_length=8)

    def validate(self, attrs):
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({'password_confirm': 'Пароли не совпадают.'})
        return attrs
