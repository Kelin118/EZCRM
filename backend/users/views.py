from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from crm.permissions import IsAdminRole

from .serializers import (
    EmployeeSerializer,
    PasswordSerializer,
    RegisterSerializer,
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

    def destroy(self, request, *args, **kwargs):
        user = self.get_object()
        if user.is_active and (user.role == 'admin' or user.is_superuser) and active_admins().exclude(pk=user.pk).count() == 0:
            return Response(
                {'detail': 'Нельзя заблокировать последнего активного администратора.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.is_active = False
        user.save(update_fields=['is_active'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='set-password')
    def set_password(self, request, pk=None):
        user = self.get_object()
        serializer = PasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user.set_password(serializer.validated_data['password'])
        user.save(update_fields=['password'])
        return Response({'detail': 'Пароль обновлён.'}, status=status.HTTP_200_OK)
