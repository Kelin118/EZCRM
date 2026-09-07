from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AddonSaleViewSet,
    AuditLogViewSet,
    AttendanceDayView,
    BackupCreateView,
    BranchViewSet,
    CatalogItemViewSet,
    CertificateDesignAssetViewSet,
    CertificateTemplateViewSet,
    CertificatesExportView,
    ChatMessageViewSet,
    ClientViewSet,
    CurrentUserView,
    DashboardStatsView,
    DailyPaymentsReportView,
    DiscountViewSet,
    EmployeePayrollProfileViewSet,
    EmployeeWorklogView,
    EmployeeWorkScheduleViewSet,
    ExcelImportView,
    ClientsExportView,
    FinanceExportView,
    FinanceTransactionViewSet,
    GroupsExportView,
    GlobalSearchView,
    GroupMembershipViewSet,
    LessonsExportView,
    LessonViewSet,
    LeadViewSet,
    MasterClassViewSet,
    MessagingChannelViewSet,
    MetaEmbeddedSignupCompleteView,
    MetaIntegrationStatusView,
    MetaWebhookView,
    PaymentMethodViewSet,
    PayrollStatementViewSet,
    MasterClassesExportView,
    GiftCertificateViewSet,
    PublicCertificateAssetView,
    PublicGiftCertificateView,
    ReportsSummaryView,
    ReportSummaryExportView,
    RoomViewSet,
    ScheduleSlotViewSet,
    StudioSettingsViewSet,
    StudyGroupViewSet,
    SubjectViewSet,
    SubscriptionsExportView,
    SubscriptionViewSet,
    TaskViewSet,
    TrialViewSet,
    TrialsExportView,
    VisitsExportView,
    VisitViewSet,
)

router = DefaultRouter()
router.register('branches', BranchViewSet, basename='branch')
router.register('clients', ClientViewSet, basename='client')
router.register('subscriptions', SubscriptionViewSet, basename='subscription')
router.register('visits', VisitViewSet, basename='visit')
router.register('subjects', SubjectViewSet, basename='subject')
router.register('rooms', RoomViewSet, basename='room')
router.register('study-groups', StudyGroupViewSet, basename='study-group')
router.register('group-memberships', GroupMembershipViewSet, basename='group-membership')
router.register('schedule-slots', ScheduleSlotViewSet, basename='schedule-slot')
router.register('lessons', LessonViewSet, basename='lesson')
router.register('leads', LeadViewSet, basename='lead')
router.register('trials', TrialViewSet, basename='trial')
router.register('master-classes', MasterClassViewSet, basename='master-class')
router.register('tasks', TaskViewSet, basename='task')
router.register('addon-sales', AddonSaleViewSet, basename='addon-sale')
router.register('finance', FinanceTransactionViewSet, basename='finance')
router.register('employee-schedules', EmployeeWorkScheduleViewSet, basename='employee-schedule')
router.register('employee-payroll-profiles', EmployeePayrollProfileViewSet, basename='employee-payroll-profile')
router.register('payroll', PayrollStatementViewSet, basename='payroll')
router.register('discounts', DiscountViewSet, basename='discount')
router.register('payment-methods', PaymentMethodViewSet, basename='payment-method')
router.register('messaging-channels', MessagingChannelViewSet, basename='messaging-channel')
router.register('chat/messages', ChatMessageViewSet, basename='chat-message')
router.register('settings', StudioSettingsViewSet, basename='settings')
router.register('catalog-items', CatalogItemViewSet, basename='catalog-item')
router.register('certificate-assets', CertificateDesignAssetViewSet, basename='certificate-asset')
router.register('certificate-templates', CertificateTemplateViewSet, basename='certificate-template')
router.register('certificates', GiftCertificateViewSet, basename='certificate')
router.register('audit-logs', AuditLogViewSet, basename='audit-log')

urlpatterns = [
    path('search/', GlobalSearchView.as_view(), name='global-search'),
    path('auth/me/', CurrentUserView.as_view(), name='auth-me'),
    path('dashboard/stats/', DashboardStatsView.as_view(), name='dashboard-stats'),
    path('reports/summary/', ReportsSummaryView.as_view(), name='reports-summary'),
    path('reports/daily-payments/', DailyPaymentsReportView.as_view(), name='reports-daily-payments'),
    path('employee-worklog/', EmployeeWorklogView.as_view(), name='employee-worklog'),
    path('attendance/day/', AttendanceDayView.as_view(), name='attendance-day'),
    path('integrations/meta/webhook/', MetaWebhookView.as_view(), name='meta-webhook'),
    path('integrations/meta/status/', MetaIntegrationStatusView.as_view(), name='meta-integration-status'),
    path('integrations/meta/embedded-signup/complete/', MetaEmbeddedSignupCompleteView.as_view(), name='meta-embedded-signup-complete'),
    path('import/excel/', ExcelImportView.as_view(), name='excel-import'),
    path('export/clients/', ClientsExportView.as_view(), name='export-clients'),
    path('export/subscriptions/', SubscriptionsExportView.as_view(), name='export-subscriptions'),
    path('export/visits/', VisitsExportView.as_view(), name='export-visits'),
    path('export/finance/', FinanceExportView.as_view(), name='export-finance'),
    path('export/trials/', TrialsExportView.as_view(), name='export-trials'),
    path('export/master-classes/', MasterClassesExportView.as_view(), name='export-master-classes'),
    path('export/certificates/', CertificatesExportView.as_view(), name='export-certificates'),
    path('export/groups/', GroupsExportView.as_view(), name='export-groups'),
    path('export/lessons/', LessonsExportView.as_view(), name='export-lessons'),
    path('export/report-summary/', ReportSummaryExportView.as_view(), name='export-report-summary'),
    path('backup/create/', BackupCreateView.as_view(), name='backup-create'),
    path('public/certificates/<uuid:public_token>/', PublicGiftCertificateView.as_view(), name='public-certificate'),
    path('public/certificate-assets/<uuid:public_token>/', PublicCertificateAssetView.as_view(), name='public-certificate-asset'),
]

urlpatterns += router.urls
