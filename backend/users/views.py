from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from crm.audit import log_action
from crm.models import AuditLog
from crm.permissions import IsAdminRole

from .serializers import (
    EmployeeSerializer,
    PasswordSerializer,
    RegisterSerializer,
    StaffOptionSerializer,
    UserPublicSerializer,
    active_admins,
)


User = get_user_model()


class RegisterView(APIView):
    permission_classes = (AllowAny,)

    def post(self, request):
        if User.objects.filter(Q(role='admin') | Q(is_superuser=True)).exists():
            return Response(
                {'detail': 'Регистрация закрыта. Обратитесь к администратору.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        log_action(
            request,
            AuditLog.Action.CREATE,
            'User',
            entity_id=user.id,
            entity_name=user.get_full_name() or user.username,
            description='Создан первый администратор',
            changes={'username': user.username, 'role': user.role},
        )
        return Response(UserPublicSerializer(user).data, status=status.HTTP_201_CREATED)


class EmployeeViewSet(viewsets.ModelViewSet):
    permission_classes = (IsAdminRole,)
    serializer_class = EmployeeSerializer

    def get_queryset(self):
        queryset = User.objects.all().order_by('username')
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(username__icontains=search)
                | Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(phone__icontains=search)
                | Q(email__icontains=search)
            )
        return queryset

    def perform_create(self, serializer):
        user = serializer.save()
        log_action(
            self.request,
            AuditLog.Action.CREATE,
            'User',
            entity_id=user.id,
            entity_name=user.get_full_name() or user.username,
            description='Создан сотрудник',
            changes={'username': user.username, 'role': user.role, 'is_active': user.is_active},
        )

    def perform_update(self, serializer):
        was_active = serializer.instance.is_active
        user = serializer.save()
        description = 'Изменён сотрудник'
        action_value = AuditLog.Action.UPDATE
        if not was_active and user.is_active:
            description = 'Сотрудник активирован'
            action_value = AuditLog.Action.ACTIVATE
        elif was_active and not user.is_active:
            description = 'Сотрудник деактивирован'
            action_value = AuditLog.Action.DEACTIVATE

        changes = {
            key: value
            for key, value in self.request.data.items()
            if key not in {'password', 'password_confirm'}
        }
        log_action(
            self.request,
            action_value,
            'User',
            entity_id=user.id,
            entity_name=user.get_full_name() or user.username,
            description=description,
            changes=changes,
        )

    def destroy(self, request, *args, **kwargs):
        user = self.get_object()
        if user.is_active and (user.role == 'admin' or user.is_superuser) and active_admins().exclude(pk=user.pk).count() == 0:
            return Response(
                {'detail': 'Нельзя заблокировать последнего активного администратора.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.is_active = False
        user.save(update_fields=['is_active'])
        log_action(
            request,
            AuditLog.Action.DEACTIVATE,
            'User',
            entity_id=user.id,
            entity_name=user.get_full_name() or user.username,
            description='Сотрудник деактивирован',
            changes={'is_active': False},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='set-password')
    def set_password(self, request, pk=None):
        user = self.get_object()
        serializer = PasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user.set_password(serializer.validated_data['password'])
        user.save(update_fields=['password'])
        log_action(
            request,
            AuditLog.Action.PASSWORD_CHANGE,
            'User',
            entity_id=user.id,
            entity_name=user.get_full_name() or user.username,
            description='Изменён пароль сотрудника',
        )
        return Response({'detail': 'Пароль обновлён.'}, status=status.HTTP_200_OK)
 
class StaffOptionViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = StaffOptionSerializer

    def get_queryset(self):
        queryset = User.objects.all().order_by('first_name', 'last_name', 'username')
        role_value = self.request.query_params.get('role')
        active = self.request.query_params.get('active')

        if role_value:
            queryset = queryset.filter(role=role_value)
        if active in ('1', 'true', 'True', 'yes'):
            queryset = queryset.filter(is_active=True)
        elif active in ('0', 'false', 'False', 'no'):
            queryset = queryset.filter(is_active=False)

        return queryset
