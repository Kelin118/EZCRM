from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AuditLogViewSet,
    ChatMessageViewSet,
    ClientViewSet,
    CurrentUserView,
    DashboardStatsView,
    ExcelImportView,
    FinanceTransactionViewSet,
    GroupMembershipViewSet,
    LessonViewSet,
    MasterClassViewSet,
    ReportsSummaryView,
    RoomViewSet,
    ScheduleSlotViewSet,
    StudioSettingsViewSet,
    StudyGroupViewSet,
    SubjectViewSet,
    SubscriptionViewSet,
    TaskViewSet,
    TrialViewSet,
    VisitViewSet,
)

router = DefaultRouter()
router.register('clients', ClientViewSet, basename='client')
router.register('subscriptions', SubscriptionViewSet, basename='subscription')
router.register('visits', VisitViewSet, basename='visit')
router.register('subjects', SubjectViewSet, basename='subject')
router.register('rooms', RoomViewSet, basename='room')
router.register('study-groups', StudyGroupViewSet, basename='study-group')
router.register('group-memberships', GroupMembershipViewSet, basename='group-membership')
router.register('schedule-slots', ScheduleSlotViewSet, basename='schedule-slot')
router.register('lessons', LessonViewSet, basename='lesson')
router.register('trials', TrialViewSet, basename='trial')
router.register('master-classes', MasterClassViewSet, basename='master-class')
router.register('tasks', TaskViewSet, basename='task')
router.register('finance', FinanceTransactionViewSet, basename='finance')
router.register('chat/messages', ChatMessageViewSet, basename='chat-message')
router.register('settings', StudioSettingsViewSet, basename='settings')
router.register('audit-logs', AuditLogViewSet, basename='audit-log')

urlpatterns = [
    path('auth/me/', CurrentUserView.as_view(), name='auth-me'),
    path('dashboard/stats/', DashboardStatsView.as_view(), name='dashboard-stats'),
    path('reports/summary/', ReportsSummaryView.as_view(), name='reports-summary'),
    path('import/excel/', ExcelImportView.as_view(), name='excel-import'),
]

urlpatterns += router.urls
