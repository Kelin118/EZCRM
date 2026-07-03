from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from .models import AuditLog, Client, FinanceTransaction, Task


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
        self.assertTrue(AuditLog.objects.filter(action='update', entity_type='Task', description='Задача выполнена').exists())


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
