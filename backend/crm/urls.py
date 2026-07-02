from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ChatMessageViewSet,
    ClientViewSet,
    DashboardStatsView,
    ExcelImportView,
    FinanceTransactionViewSet,
    MasterClassViewSet,
    ReportsSummaryView,
    StudioSettingsViewSet,
    SubscriptionViewSet,
    TaskViewSet,
    TrialViewSet,
    VisitViewSet,
)

router = DefaultRouter()
router.register('clients', ClientViewSet, basename='client')
router.register('subscriptions', SubscriptionViewSet, basename='subscription')
router.register('visits', VisitViewSet, basename='visit')
router.register('trials', TrialViewSet, basename='trial')
router.register('master-classes', MasterClassViewSet, basename='master-class')
router.register('tasks', TaskViewSet, basename='task')
router.register('finance', FinanceTransactionViewSet, basename='finance')
router.register('chat/messages', ChatMessageViewSet, basename='chat-message')
router.register('settings', StudioSettingsViewSet, basename='settings')

urlpatterns = [
    path('dashboard/stats/', DashboardStatsView.as_view(), name='dashboard-stats'),
    path('reports/summary/', ReportsSummaryView.as_view(), name='reports-summary'),
    path('import/excel/', ExcelImportView.as_view(), name='excel-import'),
]

urlpatterns += router.urls
