from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import EmployeeViewSet, RegisterView, StaffOptionViewSet


router = DefaultRouter()
router.register('users/employees', EmployeeViewSet, basename='employee')
router.register('users/staff-options', StaffOptionViewSet, basename='staff-option')

urlpatterns = [
    path('auth/register/', RegisterView.as_view(), name='auth-register'),
]

urlpatterns += router.urls
