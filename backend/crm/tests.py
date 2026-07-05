from datetime import date, datetime, time, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import (
    AuditLog,
    Client,
    FinanceTransaction,
    GroupMembership,
    Lesson,
    Room,
    ScheduleSlot,
    StudyGroup,
    Subject,
    Subscription,
    Task,
    Trial,
    Visit,
)
from .group_schedule import schedule_display, subscription_expected_end_date, subscription_remaining_lessons


class RolePermissionTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(username='admin', password='pass', role='admin')
        self.manager = User.objects.create_user(username='manager', password='pass', role='manager')
        self.teacher = User.objects.create_user(username='teacher', password='pass', role='teacher')
        self.accountant = User.objects.create_user(username='accountant', password='pass', role='accountant')
        self.client_obj = Client.objects.create(first_name='Test', last_name='Client', manager=self.manager)

    def test_admin_can_get_clients(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/clients/')
        self.assertEqual(response.status_code, 200)

    def test_teacher_cannot_get_finance(self):
        self.client.force_authenticate(self.teacher)
        response = self.client.get('/api/finance/')
        self.assertEqual(response.status_code, 403)

    def test_manager_cannot_delete_client(self):
        self.client.force_authenticate(self.manager)
        response = self.client.delete(f'/api/clients/{self.client_obj.id}/')
        self.assertEqual(response.status_code, 403)

    def test_accountant_can_get_finance(self):
        self.client.force_authenticate(self.accountant)
        response = self.client.get('/api/finance/')
        self.assertEqual(response.status_code, 200)

    def test_manager_and_teacher_cannot_import_excel(self):
        for user in (self.manager, self.teacher):
            self.client.force_authenticate(user)
            upload = SimpleUploadedFile(
                'import.xlsx',
                b'not an xlsx',
                content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            )
            response = self.client.post('/api/import/excel/', {'file': upload}, format='multipart')
            self.assertEqual(response.status_code, 403)

    def test_admin_can_get_audit_logs(self):
        AuditLog.objects.create(user=self.admin, action='create', entity_type='Client', description='test')
        self.client.force_authenticate(self.admin)

        response = self.client.get('/api/audit-logs/')

        self.assertEqual(response.status_code, 200)

    def test_manager_cannot_get_audit_logs(self):
        self.client.force_authenticate(self.manager)

        response = self.client.get('/api/audit-logs/')

        self.assertEqual(response.status_code, 403)

    def test_client_create_creates_audit_log(self):
        self.client.force_authenticate(self.manager)

        response = self.client.post('/api/clients/', {'first_name': 'Audit', 'last_name': 'Client'}, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertTrue(AuditLog.objects.filter(action='create', entity_type='Client', description='Создан клиент').exists())

    def test_finance_create_creates_audit_log(self):
        self.client.force_authenticate(self.accountant)

        response = self.client.post(
            '/api/finance/',
            {'transaction_type': FinanceTransaction.Type.INCOME, 'amount': '1200.00', 'source': 'manual'},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            AuditLog.objects.filter(
                action='payment',
                entity_type='FinanceTransaction',
                description='Добавлена финансовая операция',
            ).exists()
        )

    def test_mark_done_task_creates_audit_log(self):
        task = Task.objects.create(title='Audit task', assigned_to=self.manager)
        self.client.force_authenticate(self.manager)

        response = self.client.patch(f'/api/tasks/{task.id}/mark-done/')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action='task_done', entity_type='Task', description='Задача выполнена').exists())


class UserRegistrationAndEmployeeTests(APITestCase):
    def admin_payload(self, username='first-admin'):
        return {
            'username': username,
            'full_name': 'First Admin',
            'phone': '+77000000000',
            'email': 'admin@example.com',
            'password': 'password123',
            'password_confirm': 'password123',
        }

    def test_register_creates_admin_when_no_admin_exists(self):
        User = get_user_model()
        response = self.client.post('/api/auth/register/', self.admin_payload(), format='json')

        self.assertEqual(response.status_code, 201)
        user = User.objects.get(username='first-admin')
        self.assertEqual(user.role, 'admin')
        self.assertTrue(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertTrue(user.check_password('password123'))
        self.assertNotIn('password', response.data)

    def test_register_is_closed_when_admin_exists(self):
        User = get_user_model()
        User.objects.create_user(username='admin', password='password123', role='admin', is_active=True)

        response = self.client.post('/api/auth/register/', self.admin_payload('second-admin'), format='json')

        self.assertEqual(response.status_code, 403)
        self.assertIn('Регистрация закрыта', response.data['detail'])

    def test_manager_cannot_get_employees(self):
        User = get_user_model()
        manager = User.objects.create_user(username='manager', password='password123', role='manager')
        self.client.force_authenticate(manager)

        response = self.client.get('/api/users/employees/')

        self.assertEqual(response.status_code, 403)

    def test_admin_can_create_manager(self):
        User = get_user_model()
        admin = User.objects.create_user(username='admin', password='password123', role='admin')
        self.client.force_authenticate(admin)

        response = self.client.post(
            '/api/users/employees/',
            {
                'username': 'manager',
                'full_name': 'Sales Manager',
                'phone': '+77001112233',
                'email': 'manager@example.com',
                'role': 'manager',
                'password': 'password123',
                'password_confirm': 'password123',
                'is_active': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        manager = User.objects.get(username='manager')
        self.assertEqual(manager.role, 'manager')
        self.assertEqual(manager.phone, '+77001112233')
        self.assertTrue(manager.check_password('password123'))
        self.assertNotIn('password', response.data)
        self.assertTrue(AuditLog.objects.filter(action='create', entity_type='User', description='Создан сотрудник').exists())

    def test_admin_can_deactivate_employee(self):
        User = get_user_model()
        admin = User.objects.create_user(username='admin', password='password123', role='admin')
        employee = User.objects.create_user(username='teacher', password='password123', role='teacher', is_active=True)
        self.client.force_authenticate(admin)

        response = self.client.delete(f'/api/users/employees/{employee.id}/')

        self.assertEqual(response.status_code, 204)
        employee.refresh_from_db()
        self.assertFalse(employee.is_active)

    def test_admin_can_set_employee_password(self):
        User = get_user_model()
        admin = User.objects.create_user(username='admin', password='password123', role='admin')
        employee = User.objects.create_user(username='teacher', password='password123', role='teacher')
        old_hash = employee.password
        self.client.force_authenticate(admin)

        response = self.client.post(
            f'/api/users/employees/{employee.id}/set-password/',
            {'password': 'newpassword123', 'password_confirm': 'newpassword123'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        employee.refresh_from_db()
        self.assertNotEqual(employee.password, old_hash)
        self.assertTrue(check_password('newpassword123', employee.password))

    def test_cannot_deactivate_last_active_admin(self):
        User = get_user_model()
        admin = User.objects.create_user(username='admin', password='password123', role='admin', is_active=True)
        self.client.force_authenticate(admin)

        response = self.client.patch(f'/api/users/employees/{admin.id}/', {'is_active': False}, format='json')

        self.assertEqual(response.status_code, 400)
        admin.refresh_from_db()
        self.assertTrue(admin.is_active)

    def test_user_role_helpers_keep_legacy_role_compatibility(self):
        User = get_user_model()
        teacher = User.objects.create_user(username='legacy-teacher', password='password123', role='teacher')

        self.assertEqual(teacher.get_roles(), ['teacher'])
        self.assertTrue(teacher.has_role('teacher'))
        self.assertFalse(teacher.has_role('manager'))

    def test_user_role_helpers_support_multiple_roles(self):
        User = get_user_model()
        employee = User.objects.create_user(
            username='teacher-manager',
            password='password123',
            role='teacher',
            roles=['teacher', 'manager'],
        )

        self.assertTrue(employee.has_role('teacher'))
        self.assertTrue(employee.has_role('manager'))
        self.assertFalse(employee.has_role('accountant'))

    def test_staff_options_filters_by_roles(self):
        User = get_user_model()
        admin = User.objects.create_user(username='admin', password='password123', role='admin', roles=['admin'])
        employee = User.objects.create_user(
            username='multi-role',
            password='password123',
            role='teacher',
            roles=['teacher', 'manager'],
            is_active=True,
        )
        self.client.force_authenticate(admin)

        teacher_response = self.client.get('/api/users/staff-options/?role=teacher&active=1')
        manager_response = self.client.get('/api/users/staff-options/?role=manager&active=1')

        self.assertEqual(teacher_response.status_code, 200)
        self.assertEqual(manager_response.status_code, 200)
        self.assertIn(employee.id, [item['id'] for item in teacher_response.data])
        self.assertIn(employee.id, [item['id'] for item in manager_response.data])

    def test_admin_can_create_employee_with_multiple_roles(self):
        User = get_user_model()
        admin = User.objects.create_user(username='admin', password='password123', role='admin', roles=['admin'])
        self.client.force_authenticate(admin)

        response = self.client.post(
            '/api/users/employees/',
            {
                'username': 'teacher-manager',
                'full_name': 'Teacher Manager',
                'roles': ['teacher', 'manager'],
                'password': 'password123',
                'password_confirm': 'password123',
                'is_active': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        employee = User.objects.get(username='teacher-manager')
        self.assertEqual(employee.role, 'teacher')
        self.assertEqual(employee.roles, ['teacher', 'manager'])
        self.assertIn('roles', response.data)

    def test_admin_can_update_employee_roles_and_audit_log_is_written(self):
        User = get_user_model()
        admin = User.objects.create_user(username='admin', password='password123', role='admin', roles=['admin'])
        employee = User.objects.create_user(username='employee', password='password123', role='teacher', roles=['teacher'])
        self.client.force_authenticate(admin)

        response = self.client.patch(
            f'/api/users/employees/{employee.id}/',
            {'roles': ['manager', 'accountant']},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        employee.refresh_from_db()
        self.assertEqual(employee.role, 'manager')
        self.assertEqual(employee.roles, ['manager', 'accountant'])
        self.assertTrue(
            AuditLog.objects.filter(
                action='update',
                entity_type='User',
                description='Изменены роли сотрудника',
                changes__old_roles=['teacher'],
                changes__new_roles=['manager', 'accountant'],
            ).exists()
        )

    def test_cannot_remove_last_active_admin_role(self):
        User = get_user_model()
        admin = User.objects.create_user(username='admin', password='password123', role='admin', roles=['admin'], is_active=True)
        self.client.force_authenticate(admin)

        response = self.client.patch(f'/api/users/employees/{admin.id}/', {'roles': ['manager']}, format='json')

        self.assertEqual(response.status_code, 400)
        admin.refresh_from_db()
        self.assertTrue(admin.has_role('admin'))


class AdminApiSmokeTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(username='admin-smoke', password='pass12345', role='admin')

    def test_auth_and_main_admin_endpoints_return_200(self):
        token_response = self.client.post('/api/token/', {'username': 'admin-smoke', 'password': 'pass12345'}, format='json')
        self.assertEqual(token_response.status_code, 200)
        self.assertIn('access', token_response.data)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_response.data['access']}")

        endpoints = [
            '/api/auth/me/',
            '/api/clients/',
            '/api/subscriptions/',
            '/api/visits/',
            '/api/trials/',
            '/api/master-classes/',
            '/api/tasks/',
            '/api/finance/',
            '/api/dashboard/stats/',
            '/api/reports/summary/',
            '/api/study-groups/',
            '/api/schedule-slots/',
            '/api/lessons/',
            '/api/subjects/',
            '/api/rooms/',
            '/api/audit-logs/',
        ]
        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint):
                response = self.client.get(endpoint)
                self.assertEqual(response.status_code, 200)

    def test_export_endpoints_return_xlsx(self):
        self.client.force_authenticate(self.admin)
        for endpoint in ['/api/export/clients/', '/api/export/finance/', '/api/export/report-summary/']:
            with self.subTest(endpoint=endpoint):
                response = self.client.get(endpoint)
                self.assertEqual(response.status_code, 200)
                self.assertIn('spreadsheetml.sheet', response['Content-Type'])
                self.assertGreater(len(response.content), 1000)

    @patch('crm.views.create_database_backup')
    def test_admin_can_create_backup(self, mocked_backup):
        mocked_backup.return_value = {'filename': 'backup.sql', 'path': 'backups/backup.sql'}
        self.client.force_authenticate(self.admin)

        response = self.client.post('/api/backup/create/')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['success'])
        self.assertEqual(response.data['filename'], 'backup.sql')


class RoleAccessSmokeTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(username='admin-role', password='pass', role='admin')
        self.manager = User.objects.create_user(username='manager-role', password='pass', role='manager')
        self.teacher = User.objects.create_user(username='teacher-role', password='pass', role='teacher')
        self.accountant = User.objects.create_user(username='accountant-role', password='pass', role='accountant')
        self.group = StudyGroup.objects.create(name='Teacher group', teacher=self.teacher, manager=self.manager)
        self.task = Task.objects.create(title='Teacher task', assigned_to=self.teacher)

    def test_role_access_does_not_return_500(self):
        cases = [
            (self.manager, '/api/audit-logs/', 403),
            (self.manager, '/api/export/clients/', 200),
            (self.manager, '/api/study-groups/', 200),
            (self.manager, '/api/schedule-slots/', 200),
            (self.manager, '/api/finance/', 200),
            (self.teacher, '/api/audit-logs/', 403),
            (self.teacher, '/api/export/finance/', 403),
            (self.teacher, '/api/finance/', 403),
            (self.teacher, '/api/study-groups/', 200),
            (self.teacher, '/api/lessons/', 200),
            (self.teacher, '/api/tasks/', 200),
            (self.accountant, '/api/audit-logs/', 403),
            (self.accountant, '/api/finance/', 200),
            (self.accountant, '/api/reports/summary/', 200),
            (self.accountant, '/api/export/finance/', 200),
        ]
        for user, endpoint, expected in cases:
            with self.subTest(user=user.username, endpoint=endpoint):
                self.client.force_authenticate(user)
                response = self.client.get(endpoint)
                self.assertEqual(response.status_code, expected)

    def test_teacher_manager_gets_manager_access(self):
        User = get_user_model()
        teacher_manager = User.objects.create_user(
            username='teacher-manager-access',
            password='pass',
            role='teacher',
            roles=['teacher', 'manager'],
        )
        self.client.force_authenticate(teacher_manager)

        response = self.client.get('/api/finance/')

        self.assertEqual(response.status_code, 200)

    @patch('crm.views.create_database_backup')
    def test_backup_is_admin_only(self, mocked_backup):
        mocked_backup.return_value = {'filename': 'backup.sql', 'path': 'backups/backup.sql'}
        for user, expected in [(self.admin, 200), (self.accountant, 403), (self.manager, 403), (self.teacher, 403)]:
            with self.subTest(user=user.username):
                self.client.force_authenticate(user)
                response = self.client.post('/api/backup/create/')
                self.assertEqual(response.status_code, expected)


class GroupScheduleTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(username='admin-group', password='pass', role='admin', roles=['admin'])
        self.teacher = User.objects.create_user(username='teacher-group', password='pass', role='teacher', roles=['teacher'])
        self.manager = User.objects.create_user(username='manager-group', password='pass', role='manager', roles=['manager'])
        self.subject = Subject.objects.create(name='Math')
        self.room = Room.objects.create(name='101')
        self.client.force_authenticate(self.admin)

    def group_payload(self, **overrides):
        payload = {
            'name': 'Test Tue Thu',
            'subject': self.subject.id,
            'room': self.room.id,
            'teacher': self.teacher.id,
            'manager': self.manager.id,
            'schedule_days': ['tuesday', 'thursday'],
            'start_time': '12:30:00',
            'end_time': '14:00:00',
            'status': 'active',
        }
        payload.update(overrides)
        return payload

    def test_can_create_group_with_schedule(self):
        response = self.client.post('/api/study-groups/', self.group_payload(), format='json')

        self.assertEqual(response.status_code, 201)
        group = StudyGroup.objects.get(name='Test Tue Thu')
        self.assertEqual(group.schedule_days, ['tuesday', 'thursday'])
        self.assertEqual(str(group.start_time), '12:30:00')
        self.assertEqual(str(group.end_time), '14:00:00')

    def test_schedule_display_returns_human_text(self):
        group = StudyGroup.objects.create(
            name='Display',
            subject=self.subject,
            room=self.room,
            teacher=self.teacher,
            schedule_days=['tuesday', 'thursday'],
            start_time=time(12, 30),
            end_time=time(14, 0),
        )

        self.assertEqual(schedule_display(group), 'ВТ, ЧТ  12:30-14:00')
        self.assertEqual(StudyGroup.objects.get(pk=group.pk).schedule_days, ['tuesday', 'thursday'])

    def test_group_syncs_two_schedule_slots(self):
        response = self.client.post('/api/study-groups/', self.group_payload(), format='json')

        self.assertEqual(response.status_code, 201)
        group = StudyGroup.objects.get(name='Test Tue Thu')
        slots = ScheduleSlot.objects.filter(group=group, is_active=True).order_by('weekday')
        self.assertEqual(slots.count(), 2)
        self.assertEqual(list(slots.values_list('weekday', flat=True)), [1, 3])

    def test_updating_schedule_days_does_not_duplicate_slots(self):
        create_response = self.client.post('/api/study-groups/', self.group_payload(), format='json')
        group_id = create_response.data['id']

        first_update = self.client.patch(
            f'/api/study-groups/{group_id}/',
            {'schedule_days': ['tuesday'], 'start_time': '12:30:00', 'end_time': '14:00:00'},
            format='json',
        )
        second_update = self.client.patch(
            f'/api/study-groups/{group_id}/',
            {'schedule_days': ['tuesday', 'thursday'], 'start_time': '12:30:00', 'end_time': '14:00:00'},
            format='json',
        )

        self.assertEqual(first_update.status_code, 200)
        self.assertEqual(second_update.status_code, 200)
        group = StudyGroup.objects.get(pk=group_id)
        self.assertEqual(ScheduleSlot.objects.filter(group=group, weekday=1, is_active=True).count(), 1)
        self.assertEqual(ScheduleSlot.objects.filter(group=group, weekday=3, is_active=True).count(), 1)

    def test_group_schedule_generates_lessons_for_tuesday_and_thursday(self):
        create_response = self.client.post('/api/study-groups/', self.group_payload(), format='json')
        group_id = create_response.data['id']

        response = self.client.post(
            f'/api/study-groups/{group_id}/generate-lessons/',
            {'date_from': '2026-07-01', 'date_to': '2026-07-31'},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        lessons = Lesson.objects.filter(group_id=group_id).order_by('lesson_date')
        self.assertTrue(lessons.exists())
        self.assertTrue(all(lesson.lesson_date.weekday() in {1, 3} for lesson in lessons))
        self.assertEqual(Lesson.objects.values('group', 'lesson_date', 'start_time').distinct().count(), lessons.count())

    def test_remaining_lessons_uses_deducted_visits(self):
        client = Client.objects.create(first_name='Student')
        group = StudyGroup.objects.create(
            name='Subscription group',
            subject=self.subject,
            room=self.room,
            teacher=self.teacher,
            schedule_days=['tuesday', 'thursday'],
            start_time=time(12, 30),
            end_time=time(14, 0),
        )
        GroupMembership.objects.create(group=group, client=client, status=GroupMembership.Status.ACTIVE)
        subscription = Subscription.objects.create(
            client=client,
            title='AB-8',
            start_date=date.today(),
            total_visits=8,
            remaining_visits=8,
            status=Subscription.Status.ACTIVE,
        )
        Visit.objects.create(
            client=client,
            subscription=subscription,
            teacher=self.teacher,
            visited_at=timezone.now(),
            status=Visit.Status.ATTENDED,
            lesson_deducted=True,
        )

        self.assertEqual(subscription_remaining_lessons(subscription), 7)
        self.assertIsNotNone(subscription_expected_end_date(subscription))

    def test_attended_missed_and_status_change_affect_subscription_balance(self):
        client = Client.objects.create(first_name='Balance')
        subscription = Subscription.objects.create(
            client=client,
            title='AB-8',
            start_date=date.today(),
            total_visits=8,
            remaining_visits=8,
            status=Subscription.Status.ACTIVE,
        )
        attended = self.client.post(
            '/api/visits/',
            {
                'client': client.id,
                'subscription': subscription.id,
                'teacher': self.teacher.id,
                'visited_at': timezone.now().isoformat(),
                'status': Visit.Status.ATTENDED,
            },
            format='json',
        )
        self.assertEqual(attended.status_code, 201)
        subscription.refresh_from_db()
        self.assertEqual(subscription.remaining_visits, 7)

        missed = self.client.post(
            '/api/visits/',
            {
                'client': client.id,
                'subscription': subscription.id,
                'teacher': self.teacher.id,
                'visited_at': timezone.now().isoformat(),
                'status': Visit.Status.MISSED,
            },
            format='json',
        )
        self.assertEqual(missed.status_code, 201)
        subscription.refresh_from_db()
        self.assertEqual(subscription.remaining_visits, 7)

        patch = self.client.patch(f"/api/visits/{attended.data['id']}/", {'status': Visit.Status.MISSED}, format='json')
        self.assertEqual(patch.status_code, 200)
        subscription.refresh_from_db()
        self.assertEqual(subscription.remaining_visits, 8)


class TrialConversionTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(username='admin-convert', password='pass', role='admin', roles=['admin'])
        self.manager = User.objects.create_user(username='manager-convert', password='pass', role='manager', roles=['manager'])
        self.teacher = User.objects.create_user(username='teacher-convert', password='pass', role='teacher', roles=['teacher'])
        self.teacher_manager = User.objects.create_user(
            username='teacher-manager-convert',
            password='pass',
            role='teacher',
            roles=['teacher', 'manager'],
        )
        self.client_obj = Client.objects.create(first_name='Convert', last_name='Client', manager=self.manager)

    def create_trial(self, client='default'):
        return Trial.objects.create(
            client=self.client_obj if client == 'default' else client,
            manager=self.manager,
            teacher=self.teacher,
            scheduled_at=timezone.now(),
            status=Trial.Status.ATTENDED,
        )

    def payload(self, payment_amount='45000'):
        return {
            'subscription_type': 'AB-8',
            'start_date': date.today().isoformat(),
            'total_visits': 8,
            'price': '45000',
            'payment_amount': payment_amount,
            'payment_method': 'cash',
            'comment': 'Купил после пробного',
        }

    def test_admin_can_convert_trial_to_subscription(self):
        trial = self.create_trial()
        self.client.force_authenticate(self.admin)

        response = self.client.post(f'/api/trials/{trial.id}/convert-to-subscription/', self.payload(), format='json')

        self.assertEqual(response.status_code, 201)
        trial.refresh_from_db()
        self.assertIsNotNone(trial.subscription_id)
        self.assertEqual(trial.status, Trial.Status.BOUGHT)
        self.assertTrue(trial.bought_subscription)

    def test_manager_can_convert_trial_to_subscription(self):
        trial = self.create_trial()
        self.client.force_authenticate(self.manager)

        response = self.client.post(f'/api/trials/{trial.id}/convert-to-subscription/', self.payload(), format='json')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Subscription.objects.filter(client=self.client_obj).count(), 1)

    def test_teacher_without_manager_cannot_convert(self):
        trial = self.create_trial()
        self.client.force_authenticate(self.teacher)

        response = self.client.post(f'/api/trials/{trial.id}/convert-to-subscription/', self.payload(), format='json')

        self.assertEqual(response.status_code, 403)

    def test_trial_without_client_does_not_convert(self):
        trial = self.create_trial(client=None)
        self.client.force_authenticate(self.admin)

        response = self.client.post(f'/api/trials/{trial.id}/convert-to-subscription/', self.payload(), format='json')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Subscription.objects.count(), 0)

    def test_repeated_conversion_does_not_create_duplicate(self):
        trial = self.create_trial()
        self.client.force_authenticate(self.admin)

        first = self.client.post(f'/api/trials/{trial.id}/convert-to-subscription/', self.payload(), format='json')
        second = self.client.post(f'/api/trials/{trial.id}/convert-to-subscription/', self.payload(), format='json')

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(Subscription.objects.filter(client=self.client_obj).count(), 1)

    def test_conversion_creates_subscription_with_correct_balance(self):
        trial = self.create_trial()
        self.client.force_authenticate(self.admin)

        response = self.client.post(f'/api/trials/{trial.id}/convert-to-subscription/', self.payload(), format='json')

        self.assertEqual(response.status_code, 201)
        subscription = Subscription.objects.get(client=self.client_obj)
        self.assertEqual(subscription.title, 'AB-8')
        self.assertEqual(subscription.total_visits, 8)
        self.assertEqual(subscription.remaining_visits, 8)
        self.assertEqual(subscription.status, Subscription.Status.ACTIVE)

    def test_payment_amount_creates_finance_transaction(self):
        trial = self.create_trial()
        self.client.force_authenticate(self.admin)

        response = self.client.post(f'/api/trials/{trial.id}/convert-to-subscription/', self.payload('45000'), format='json')

        self.assertEqual(response.status_code, 201)
        subscription = Subscription.objects.get(client=self.client_obj)
        self.assertEqual(FinanceTransaction.objects.filter(subscription=subscription, source='subscription').count(), 1)

    def test_zero_payment_does_not_create_finance_transaction(self):
        trial = self.create_trial()
        self.client.force_authenticate(self.admin)

        response = self.client.post(f'/api/trials/{trial.id}/convert-to-subscription/', self.payload('0'), format='json')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(FinanceTransaction.objects.count(), 0)

    def test_subscription_appears_in_subscriptions_api(self):
        trial = self.create_trial()
        self.client.force_authenticate(self.admin)
        self.client.post(f'/api/trials/{trial.id}/convert-to-subscription/', self.payload(), format='json')

        response = self.client.get('/api/subscriptions/')

        self.assertEqual(response.status_code, 200)
        ids = [item['id'] for item in response.data]
        self.assertIn(Subscription.objects.get(client=self.client_obj).id, ids)

    def test_teacher_manager_can_convert(self):
        trial = self.create_trial()
        self.client.force_authenticate(self.teacher_manager)

        response = self.client.post(f'/api/trials/{trial.id}/convert-to-subscription/', self.payload(), format='json')

        self.assertEqual(response.status_code, 201)

    def test_conversion_writes_audit_log(self):
        trial = self.create_trial()
        self.client.force_authenticate(self.admin)

        response = self.client.post(f'/api/trials/{trial.id}/convert-to-subscription/', self.payload(), format='json')

        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            AuditLog.objects.filter(
                action='trial_converted_to_subscription',
                entity_type='Trial',
                entity_id=str(trial.id),
                description='Пробник переведен в абонемент',
            ).exists()
        )


class CriticalBusinessFlowTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(username='admin-flow', password='pass', role='admin')
        self.teacher = User.objects.create_user(username='teacher-flow', password='pass', role='teacher')
        self.manager = User.objects.create_user(username='manager-flow', password='pass', role='manager')
        self.client.force_authenticate(self.admin)

    def test_visit_deduction_and_lesson_attendance_flow(self):
        client = Client.objects.create(first_name='Flow', last_name='Client', manager=self.manager)
        subscription = Subscription.objects.create(
            client=client,
            title='AB-8',
            start_date=date.today(),
            total_visits=8,
            remaining_visits=8,
            status=Subscription.Status.ACTIVE,
        )

        visit_response = self.client.post(
            '/api/visits/',
            {
                'client': client.id,
                'subscription': subscription.id,
                'teacher': self.teacher.id,
                'visited_at': timezone.make_aware(datetime.combine(date.today(), time(10, 0))).isoformat(),
                'status': Visit.Status.ATTENDED,
                'notes': 'first visit',
            },
            format='json',
        )
        self.assertEqual(visit_response.status_code, 201)
        subscription.refresh_from_db()
        self.assertEqual(subscription.remaining_visits, 7)

        patch_response = self.client.patch(
            f"/api/visits/{visit_response.data['id']}/",
            {'status': Visit.Status.MISSED},
            format='json',
        )
        self.assertEqual(patch_response.status_code, 200)
        subscription.refresh_from_db()
        self.assertEqual(subscription.remaining_visits, 8)

        group = StudyGroup.objects.create(name='Flow group', teacher=self.teacher, manager=self.manager)
        GroupMembership.objects.create(group=group, client=client, status=GroupMembership.Status.ACTIVE)
        slot = ScheduleSlot.objects.create(
            group=group,
            teacher=self.teacher,
            weekday=date.today().weekday(),
            start_time=time(12, 0),
            end_time=time(13, 0),
        )

        generate_response = self.client.post(
            f'/api/schedule-slots/{slot.id}/generate-lessons/',
            {'date_from': date.today().isoformat(), 'date_to': (date.today() + timedelta(days=1)).isoformat()},
            format='json',
        )
        self.assertEqual(generate_response.status_code, 201)
        lesson = Lesson.objects.get(schedule_slot=slot)

        attendance_payload = {
            'items': [
                {
                    'client': client.id,
                    'subscription': subscription.id,
                    'status': Visit.Status.ATTENDED,
                    'comment': 'attended lesson',
                }
            ]
        }
        attendance_response = self.client.post(f'/api/lessons/{lesson.id}/attendance/', attendance_payload, format='json')
        self.assertEqual(attendance_response.status_code, 200)
        self.assertEqual(Visit.objects.filter(lesson=lesson, client=client).count(), 1)
        lesson_visit = Visit.objects.get(lesson=lesson, client=client)
        self.assertEqual(lesson_visit.subscription_id, subscription.id)
        subscription.refresh_from_db()
        self.assertEqual(subscription.remaining_visits, 7)

        second_response = self.client.post(f'/api/lessons/{lesson.id}/attendance/', attendance_payload, format='json')
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(Visit.objects.filter(lesson=lesson, client=client).count(), 1)
        subscription.refresh_from_db()
        self.assertEqual(subscription.remaining_visits, 7)

        self.assertTrue(AuditLog.objects.filter(entity_type='Visit').exists())
        self.assertTrue(AuditLog.objects.filter(entity_type='Lesson', action='visit').exists())
