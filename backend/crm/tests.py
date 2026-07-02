from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from .models import Client


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
