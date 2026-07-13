from django.contrib.auth import get_user_model
from rest_framework import serializers

from .role_hierarchy import can_assign_roles, can_manage_user


User = get_user_model()


ROLE_CHOICES = {'admin', 'manager', 'teacher', 'accountant'}
ROLE_LABELS = {
    'admin': 'Администратор',
    'manager': 'Менеджер',
    'teacher': 'Преподаватель',
    'accountant': 'Бухгалтер',
}


def split_full_name(full_name):
    parts = (full_name or '').strip().split(maxsplit=1)
    first_name = parts[0] if parts else ''
    last_name = parts[1] if len(parts) > 1 else ''
    return first_name, last_name


def normalize_roles(value):
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        raise serializers.ValidationError('Роли должны быть списком.')

    roles = []
    for item in value:
        role_value = str(item).strip()
        if not role_value:
            continue
        if role_value not in ROLE_CHOICES:
            raise serializers.ValidationError('Недопустимая роль.')
        if role_value not in roles:
            roles.append(role_value)

    if not roles:
        raise serializers.ValidationError('Выберите хотя бы одну роль.')
    return roles


def active_admins():
    admin_ids = [user.id for user in User.objects.filter(is_active=True) if user.has_role('admin')]
    return User.objects.filter(id__in=admin_ids)


def would_remove_last_active_admin(instance, attrs):
    if not instance or not instance.is_active or not instance.has_role('admin'):
        return False

    next_roles = attrs.get('roles', instance.get_roles())
    next_active = attrs.get('is_active', instance.is_active)
    remains_admin = next_active and (instance.is_superuser or 'admin' in next_roles)
    return not remains_admin and active_admins().exclude(pk=instance.pk).count() == 0


class UserPublicSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()
    role_display = serializers.SerializerMethodField()
    roles_display = serializers.SerializerMethodField()
    branch_name = serializers.CharField(source='branch.name', read_only=True, default=None, allow_null=True)

    class Meta:
        model = User
        fields = (
            'id',
            'username',
            'email',
            'full_name',
            'display_name',
            'phone',
            'branch',
            'branch_name',
            'role',
            'roles',
            'role_display',
            'roles_display',
            'is_active',
            'is_staff',
            'is_superuser',
            'date_joined',
        )
        read_only_fields = ('id', 'date_joined')

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username

    def get_display_name(self, obj):
        name = obj.get_full_name() or obj.username
        role_names = [ROLE_LABELS.get(role, role) for role in obj.get_roles()]
        return ' · '.join(filter(None, [name, ', '.join(role_names)]))

    def get_roles(self, obj):
        return obj.get_roles()

    def get_role_display(self, obj):
        return ROLE_LABELS.get(obj.role, obj.role)

    def get_roles_display(self, obj):
        return [ROLE_LABELS.get(role, role) for role in obj.get_roles()]


class StaffOptionSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()
    branch_name = serializers.CharField(source='branch.name', read_only=True, default=None, allow_null=True)

    class Meta:
        model = User
        fields = ('id', 'username', 'full_name', 'display_name', 'role', 'roles', 'branch', 'branch_name', 'is_active')

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username

    def get_display_name(self, obj):
        name = obj.get_full_name() or obj.username
        role_names = [ROLE_LABELS.get(role, role) for role in obj.get_roles()]
        return ' · '.join(filter(None, [name, ', '.join(role_names)]))

    def get_roles(self, obj):
        return obj.get_roles()


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
            roles=['admin'],
            is_staff=True,
            is_superuser=False,
        )
        user.set_password(validated_data['password'])
        user.save()
        return user


class EmployeeSerializer(UserPublicSerializer):
    email = serializers.EmailField(required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True, trim_whitespace=False)
    password_confirm = serializers.CharField(write_only=True, required=False, allow_blank=True, trim_whitespace=False)
    full_name = serializers.CharField(max_length=255, required=False, allow_blank=True, write_only=True)
    roles = serializers.JSONField(required=False)

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

    def validate_roles(self, value):
        return normalize_roles(value)

    def validate(self, attrs):
        password = attrs.get('password')
        password_confirm = attrs.get('password_confirm')
        request = self.context.get('request')
        actor = getattr(request, 'user', None)

        if self.instance is None and not password:
            raise serializers.ValidationError({'password': 'Введите пароль'})
        if password and len(password) < 4:
            raise serializers.ValidationError({'password': 'Пароль слишком короткий'})
        if password_confirm and password != password_confirm:
            raise serializers.ValidationError({'password_confirm': 'Пароли не совпадают.'})

        if 'roles' not in attrs:
            if self.instance:
                attrs['roles'] = self.instance.get_roles()
            else:
                raise serializers.ValidationError({'roles': 'Выберите хотя бы одну роль.'})
        if actor and actor.is_authenticated and not can_assign_roles(actor, attrs['roles']):
            raise serializers.ValidationError({'roles': ['Менеджер не может назначать роль администратора.']})
        if actor and actor.is_authenticated and self.instance and not can_manage_user(actor, self.instance):
            raise serializers.ValidationError({'detail': 'Недостаточно прав для управления этим сотрудником.'})
        if actor and actor.is_authenticated and self.instance and self.instance.pk == actor.pk and attrs.get('is_active') is False:
            raise serializers.ValidationError({'is_active': 'Нельзя деактивировать собственный аккаунт.'})
        if actor and actor.is_authenticated and not actor.has_role('admin'):
            forbidden_flags = {}
            for field in ('is_superuser', 'is_staff'):
                if field in self.initial_data and self.initial_data.get(field) in (True, 'true', 'True', '1', 1):
                    forbidden_flags[field] = 'Менеджер не может назначать административные права.'
            if forbidden_flags:
                raise serializers.ValidationError(forbidden_flags)
            attrs.pop('is_superuser', None)
            attrs.pop('is_staff', None)
        attrs['role'] = attrs['roles'][0]

        if would_remove_last_active_admin(self.instance, attrs):
            raise serializers.ValidationError({'is_active': 'Нельзя заблокировать последнего активного администратора.'})

        return attrs

    def to_representation(self, instance):
        return UserPublicSerializer(instance).data

    def create(self, validated_data):
        password = validated_data.pop('password')
        validated_data.pop('password_confirm', None)
        full_name = validated_data.pop('full_name', '')
        validated_data['email'] = validated_data.get('email') or ''
        first_name, last_name = split_full_name(full_name)
        user = User(**validated_data, first_name=first_name, last_name=last_name)
        user.is_staff = user.has_role('admin')
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        validated_data.pop('password_confirm', None)
        full_name = validated_data.pop('full_name', None)
        if 'email' in validated_data:
            validated_data['email'] = validated_data.get('email') or ''
        if full_name is not None:
            instance.first_name, instance.last_name = split_full_name(full_name)

        for field, value in validated_data.items():
            setattr(instance, field, value)

        instance.is_staff = instance.has_role('admin')
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class PasswordSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True, required=True, allow_blank=False, trim_whitespace=False)
    password_confirm = serializers.CharField(write_only=True, required=False, allow_blank=True, trim_whitespace=False)

    def validate(self, attrs):
        password = attrs.get('password')
        password_confirm = attrs.get('password_confirm')

        if password and len(password) < 4:
            raise serializers.ValidationError({'password': 'Пароль слишком короткий'})
        if password_confirm and password != password_confirm:
            raise serializers.ValidationError({'password_confirm': 'Пароли не совпадают.'})

        return attrs
