from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import EmployeeViewSet, RegisterView


router = DefaultRouter()
router.register('users/employees', EmployeeViewSet, basename='employee')

urlpatterns = [
    path('auth/register/', RegisterView.as_view(), name='auth-register'),
]

urlpatterns += router.urls
