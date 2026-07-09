from datetime import date, datetime, time, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import (
    AuditLog,
    Branch,
    CatalogItem,
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
from .subscription_dates import calculate_subscription_end_date


class SubscriptionDateHelperTests(APITestCase):
    def test_validity_days_calculates_inclusive_end_date(self):
        self.assertEqual(
            calculate_subscription_end_date(date(2026, 7, 1), lessons_count=8, validity_days=30),
            date(2026, 7, 30),
        )

    def test_lessons_count_fallback_rules(self):
        self.assertEqual(calculate_subscription_end_date(date(2026, 7, 1), lessons_count=4), date(2026, 7, 28))
        self.assertEqual(calculate_subscription_end_date(date(2026, 7, 1), lessons_count=8), date(2026, 7, 31))

    def test_group_schedule_uses_nth_group_day(self):
        group = StudyGroup.objects.create(name='Tue Thu', schedule_days=['tuesday', 'thursday'])

        end_date = calculate_subscription_end_date(date(2026, 7, 9), lessons_count=8, validity_days=30, group=group)

        self.assertEqual(end_date, date(2026, 8, 4))


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


class ClientPhoneDuplicateTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(username='client-admin', password='pass', role='admin')
        self.client.force_authenticate(self.admin)

    def payload(self, first_name='Алихан', last_name='Сатыбалдин'):
        return {
            'first_name': first_name,
            'last_name': last_name,
            'parent_name': 'Айнур',
            'phone': '87070000000',
            'is_active': True,
        }

    def test_can_create_two_clients_with_same_phone_and_different_names(self):
        first = self.client.post('/api/clients/', self.payload(), format='json')
        second = self.client.post('/api/clients/', self.payload('Айлин', 'Сатыбалдина'), format='json')

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(Client.objects.filter(phone='87070000000').count(), 2)

    def test_search_by_phone_returns_all_clients_with_that_phone(self):
        Client.objects.create(**self.payload())
        Client.objects.create(**self.payload('Айлин', 'Сатыбалдина'))

        response = self.client.get('/api/clients/', {'search': '87070000000'})

        self.assertEqual(response.status_code, 200)
        items = response.data if isinstance(response.data, list) else response.data['results']
        names = {item['full_name'] for item in items}
        self.assertIn('Алихан Сатыбалдин', names)
        self.assertIn('Айлин Сатыбалдина', names)

    def test_display_name_contains_child_parent_and_phone(self):
        response = self.client.post('/api/clients/', self.payload(), format='json')

        self.assertEqual(response.status_code, 201)
        display_name = response.data['display_name']
        self.assertIn('Алихан Сатыбалдин', display_name)
        self.assertIn('Айнур', display_name)
        self.assertIn('87070000000', display_name)

    def test_client_options_returns_active_clients_in_shared_format(self):
        active = Client.objects.create(**self.payload())
        Client.objects.create(**{**self.payload('Inactive', 'Client'), 'is_active': False})

        response = self.client.get('/api/clients/options/')

        self.assertEqual(response.status_code, 200)
        ids = {item['id'] for item in response.data}
        self.assertIn(active.id, ids)
        self.assertNotIn(Client.objects.get(first_name='Inactive').id, ids)
        item = next(item for item in response.data if item['id'] == active.id)
        self.assertEqual(item['full_name'], str(active))
        self.assertIn(active.parent_name, item['display_name'])
        self.assertIn(active.phone, item['display_name'])

    def test_same_phone_same_name_creation_does_not_return_400(self):
        first = self.client.post('/api/clients/', self.payload(), format='json')
        second = self.client.post('/api/clients/', self.payload(), format='json')

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)

    def test_client_phone_has_no_unique_database_constraint(self):
        with connection.cursor() as cursor:
            constraints = connection.introspection.get_constraints(cursor, Client._meta.db_table)

        unique_phone_constraints = [
            name
            for name, details in constraints.items()
            if details.get('unique') and details.get('columns') == ['phone']
        ]
        self.assertEqual(unique_phone_constraints, [])


class CatalogItemApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(username='catalog-admin', password='pass', role='admin')
        self.manager = User.objects.create_user(username='catalog-manager', password='pass', role='manager')
        self.accountant = User.objects.create_user(username='catalog-accountant', password='pass', role='accountant')

    def create_item(self, category='service', name='AB-8', price='45000.00'):
        self.client.force_authenticate(self.admin)
        return self.client.post(
            '/api/catalog-items/',
            {'name': name, 'price': price, 'category': category},
            format='json',
        )

    def test_admin_can_create_service(self):
        response = self.create_item(category='service', name='AB-8')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['category'], 'service')

    def test_service_has_lessons_count_and_validity_days(self):
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            '/api/catalog-items/',
            {
                'name': 'AB-8',
                'price': '45000.00',
                'category': 'service',
                'lessons_count': 8,
                'validity_days': 30,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['lessons_count'], 8)
        self.assertEqual(response.data['validity_days'], 30)
        self.assertEqual(response.data['category_display'], 'Услуги')

    def test_admin_can_create_product(self):
        response = self.create_item(category='product', name='Учебник', price='3500.00')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['category'], 'product')

    def test_admin_can_create_extra_service(self):
        response = self.create_item(category='extra_service', name='Индивидуальное занятие', price='7000.00')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['category'], 'extra_service')

    def test_cannot_create_without_name(self):
        self.client.force_authenticate(self.admin)

        response = self.client.post('/api/catalog-items/', {'price': '1000.00', 'category': 'service'}, format='json')

        self.assertEqual(response.status_code, 400)

    def test_cannot_create_negative_price(self):
        self.client.force_authenticate(self.admin)

        response = self.client.post('/api/catalog-items/', {'name': 'Bad', 'price': '-1.00', 'category': 'service'}, format='json')

        self.assertEqual(response.status_code, 400)

    def test_category_filter_returns_only_services(self):
        CatalogItem.objects.create(name='AB-8', price='45000.00', category='service')
        CatalogItem.objects.create(name='Учебник', price='3500.00', category='product')
        self.client.force_authenticate(self.manager)

        response = self.client.get('/api/catalog-items/', {'category': 'service'})

        self.assertEqual(response.status_code, 200)
        items = response.data if isinstance(response.data, list) else response.data['results']
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['category'], 'service')

    def test_active_filter_excludes_disabled_services(self):
        active = CatalogItem.objects.create(name='AB-8', price='45000.00', category='service', is_active=True)
        CatalogItem.objects.create(name='Old', price='1000.00', category='service', is_active=False)
        self.client.force_authenticate(self.manager)

        response = self.client.get('/api/catalog-items/', {'category': 'service', 'is_active': 'true'})

        self.assertEqual([item['id'] for item in response.data], [active.id])

    def test_subscription_from_service_copies_snapshot(self):
        service = CatalogItem.objects.create(
            name='AB-8', price='45000.00', category='service', lessons_count=8, validity_days=30,
        )
        student = Client.objects.create(first_name='Service', last_name='Student')
        self.client.force_authenticate(self.manager)

        response = self.client.post(
            '/api/subscriptions/',
            {'client': student.id, 'service': service.id, 'start_date': date.today().isoformat()},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        service.refresh_from_db()
        subscription = Subscription.objects.get(pk=response.data['id'])
        self.assertEqual(subscription.service, service)
        self.assertEqual(subscription.title, service.name)
        self.assertEqual(str(subscription.price), str(service.price))
        self.assertEqual(subscription.total_visits, 8)
        self.assertEqual(subscription.remaining_visits, 8)
        self.assertEqual(subscription.end_date, date.today() + timedelta(days=29))
        service.price = 50000
        service.lessons_count = 10
        service.save(update_fields=('price', 'lessons_count', 'updated_at'))
        subscription.refresh_from_db()
        self.assertEqual(subscription.price, 45000)
        self.assertEqual(subscription.total_visits, 8)

    def test_subscription_from_service_defaults_start_date_to_today(self):
        service = CatalogItem.objects.create(
            name='AB-4', price='24000.00', category='service', lessons_count=4, validity_days=28,
        )
        student = Client.objects.create(first_name='Today', last_name='Student')
        self.client.force_authenticate(self.manager)

        response = self.client.post('/api/subscriptions/', {'client': student.id, 'service': service.id}, format='json')

        self.assertEqual(response.status_code, 201)
        subscription = Subscription.objects.get(pk=response.data['id'])
        self.assertEqual(subscription.start_date, timezone.localdate())
        self.assertEqual(subscription.end_date, timezone.localdate() + timedelta(days=27))

    def test_subscription_from_service_uses_group_schedule_for_end_date(self):
        service = CatalogItem.objects.create(
            name='AB-8', price='45000.00', category='service', lessons_count=8, validity_days=30,
        )
        student = Client.objects.create(first_name='Group', last_name='Student')
        group = StudyGroup.objects.create(name='Tue Thu', schedule_days=['tuesday', 'thursday'])
        GroupMembership.objects.create(group=group, client=student, status=GroupMembership.Status.ACTIVE)
        self.client.force_authenticate(self.manager)

        response = self.client.post(
            '/api/subscriptions/',
            {'client': student.id, 'service': service.id, 'start_date': '2026-07-09'},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        subscription = Subscription.objects.get(pk=response.data['id'])
        self.assertEqual(subscription.end_date, date(2026, 8, 4))

    def test_product_cannot_be_used_as_subscription_service(self):
        product = CatalogItem.objects.create(name='Book', price='3500.00', category='product')
        student = Client.objects.create(first_name='Product', last_name='Student')
        self.client.force_authenticate(self.manager)

        response = self.client.post(
            '/api/subscriptions/',
            {'client': student.id, 'service': product.id, 'start_date': date.today().isoformat()},
            format='json',
        )

        self.assertEqual(response.status_code, 400)

    def test_legacy_subscription_without_service_still_works(self):
        student = Client.objects.create(first_name='Legacy', last_name='Student')
        self.client.force_authenticate(self.manager)

        response = self.client.post(
            '/api/subscriptions/',
            {
                'client': student.id, 'title': 'Legacy AB',
                'start_date': date.today().isoformat(), 'total_visits': 4,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertIsNone(Subscription.objects.get(pk=response.data['id']).service)

    def test_manager_and_accountant_cannot_edit(self):
        item = CatalogItem.objects.create(name='AB-8', price='45000.00', category='service')

        for user in (self.manager, self.accountant):
            with self.subTest(role=user.role):
                self.client.force_authenticate(user)
                response = self.client.patch(f'/api/catalog-items/{item.id}/', {'price': '46000.00'}, format='json')
                self.assertEqual(response.status_code, 403)

    def test_audit_log_created_on_create_update_disable(self):
        create_response = self.create_item(category='service', name='AB-8')
        item_id = create_response.data['id']

        update_response = self.client.patch(f'/api/catalog-items/{item_id}/', {'price': '46000.00'}, format='json')
        disable_response = self.client.delete(f'/api/catalog-items/{item_id}/')

        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(disable_response.status_code, 204)
        self.assertTrue(AuditLog.objects.filter(action='catalog_item_create', entity_type='CatalogItem').exists())
        self.assertTrue(AuditLog.objects.filter(action='catalog_item_update', entity_type='CatalogItem').exists())
        self.assertTrue(AuditLog.objects.filter(action='catalog_item_disable', entity_type='CatalogItem').exists())
        self.assertFalse(CatalogItem.objects.get(id=item_id).is_active)


class LessonAttendanceJournalTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(username='attendance-admin', password='pass', role='admin', roles=['admin'])
        self.manager = User.objects.create_user(username='attendance-manager', password='pass', role='manager', roles=['manager'])
        self.teacher = User.objects.create_user(username='attendance-teacher', password='pass', role='teacher', roles=['teacher'])
        self.other_teacher = User.objects.create_user(username='attendance-other-teacher', password='pass', role='teacher', roles=['teacher'])
        self.teacher_manager = User.objects.create_user(
            username='attendance-teacher-manager',
            password='pass',
            role='teacher',
            roles=['teacher', 'manager'],
        )
        self.group = StudyGroup.objects.create(name='Math 5', teacher=self.teacher, manager=self.manager)
        self.lesson = Lesson.objects.create(
            group=self.group,
            teacher=self.teacher,
            lesson_date=date.today(),
            start_time=time(9, 0),
            end_time=time(10, 0),
        )
        self.clients = [
            Client.objects.create(first_name='Student', last_name='One', parent_name='Parent One', phone='87070000001'),
            Client.objects.create(first_name='Student', last_name='Two', parent_name='Parent Two', phone='87070000002'),
            Client.objects.create(first_name='Student', last_name='Three', parent_name='Parent Three', phone='87070000003'),
        ]
        for client in self.clients:
            GroupMembership.objects.create(group=self.group, client=client, status=GroupMembership.Status.ACTIVE)
            Subscription.objects.create(
                client=client,
                title='AB-8',
                start_date=date.today(),
                total_visits=8,
                remaining_visits=8,
                status=Subscription.Status.ACTIVE,
            )

    def post_attendance(self, client, status_value, user=None):
        self.client.force_authenticate(user or self.admin)
        return self.client.post(
            f'/api/lessons/{self.lesson.id}/attendance/',
            {'items': [{'client': client.id, 'status': status_value, 'comment': ''}]},
            format='json',
        )

    def remaining(self, client):
        return Subscription.objects.get(client=client).remaining_visits

    def test_get_attendance_returns_all_group_students_without_visits(self):
        self.client.force_authenticate(self.admin)

        response = self.client.get(f'/api/lessons/{self.lesson.id}/attendance/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['students']), 3)
        self.assertTrue(all(student['status'] is None for student in response.data['students']))
        self.assertTrue(all('remaining_lessons' in student for student in response.data['students']))

    def test_attended_creates_visit_and_deducts_lesson(self):
        response = self.post_attendance(self.clients[0], Visit.Status.ATTENDED)

        self.assertEqual(response.status_code, 200)
        visit = Visit.objects.get(lesson=self.lesson, client=self.clients[0])
        self.assertTrue(visit.lesson_deducted)
        self.assertEqual(self.remaining(self.clients[0]), 7)

    def test_sick_creates_visit_without_deduction(self):
        response = self.post_attendance(self.clients[0], Visit.Status.SICK)

        self.assertEqual(response.status_code, 200)
        visit = Visit.objects.get(lesson=self.lesson, client=self.clients[0])
        self.assertFalse(visit.lesson_deducted)
        self.assertEqual(self.remaining(self.clients[0]), 8)

    def test_missed_creates_visit_without_deduction(self):
        response = self.post_attendance(self.clients[0], Visit.Status.MISSED)

        self.assertEqual(response.status_code, 200)
        visit = Visit.objects.get(lesson=self.lesson, client=self.clients[0])
        self.assertFalse(visit.lesson_deducted)
        self.assertEqual(self.remaining(self.clients[0]), 8)

    def test_attended_to_sick_restores_lesson(self):
        self.post_attendance(self.clients[0], Visit.Status.ATTENDED)
        response = self.post_attendance(self.clients[0], Visit.Status.SICK)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.remaining(self.clients[0]), 8)
        self.assertFalse(Visit.objects.get(lesson=self.lesson, client=self.clients[0]).lesson_deducted)

    def test_attended_to_missed_restores_lesson(self):
        self.post_attendance(self.clients[0], Visit.Status.ATTENDED)
        response = self.post_attendance(self.clients[0], Visit.Status.MISSED)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.remaining(self.clients[0]), 8)
        self.assertFalse(Visit.objects.get(lesson=self.lesson, client=self.clients[0]).lesson_deducted)

    def test_missed_to_attended_deducts_lesson(self):
        self.post_attendance(self.clients[0], Visit.Status.MISSED)
        response = self.post_attendance(self.clients[0], Visit.Status.ATTENDED)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.remaining(self.clients[0]), 7)
        self.assertTrue(Visit.objects.get(lesson=self.lesson, client=self.clients[0]).lesson_deducted)

    def test_teacher_can_mark_only_own_lessons(self):
        own = self.post_attendance(self.clients[0], Visit.Status.ATTENDED, user=self.teacher)

        other_group = StudyGroup.objects.create(name='Other', teacher=self.other_teacher)
        other_lesson = Lesson.objects.create(group=other_group, teacher=self.other_teacher, lesson_date=date.today(), start_time=time(11, 0), end_time=time(12, 0))
        GroupMembership.objects.create(group=other_group, client=self.clients[1], status=GroupMembership.Status.ACTIVE)
        self.client.force_authenticate(self.teacher)
        forbidden = self.client.post(
            f'/api/lessons/{other_lesson.id}/attendance/',
            {'items': [{'client': self.clients[1].id, 'status': Visit.Status.ATTENDED}]},
            format='json',
        )

        self.assertEqual(own.status_code, 200)
        self.assertIn(forbidden.status_code, (403, 404))

    def test_manager_and_admin_can_mark_groups(self):
        manager_response = self.post_attendance(self.clients[0], Visit.Status.MISSED, user=self.manager)
        admin_response = self.post_attendance(self.clients[1], Visit.Status.ATTENDED, user=self.admin)

        self.assertEqual(manager_response.status_code, 200)
        self.assertEqual(admin_response.status_code, 200)

    def test_teacher_manager_works_as_manager(self):
        self.lesson.teacher = self.other_teacher
        self.lesson.save(update_fields=('teacher', 'updated_at'))

        response = self.post_attendance(self.clients[0], Visit.Status.MISSED, user=self.teacher_manager)

        self.assertEqual(response.status_code, 200)

    def test_group_create_with_schedule_creates_schedule_slots(self):
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            '/api/study-groups/',
            {
                'name': 'Tue Thu group',
                'teacher': self.teacher.id,
                'schedule_days': ['tuesday', 'thursday'],
                'start_time': '12:30:00',
                'end_time': '14:00:00',
                'status': StudyGroup.Status.ACTIVE,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        group = StudyGroup.objects.get(id=response.data['id'])
        self.assertEqual(ScheduleSlot.objects.filter(group=group, is_active=True).count(), 2)

    def test_schedule_slot_generation_creates_lesson_with_group_links(self):
        slot = ScheduleSlot.objects.create(
            group=self.group,
            teacher=self.teacher,
            subject=self.group.subject,
            room=self.group.room,
            weekday=date.today().weekday(),
            start_time=time(12, 30),
            end_time=time(14, 0),
        )
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            f'/api/schedule-slots/{slot.id}/generate-lessons/',
            {'date_from': date.today().isoformat(), 'date_to': date.today().isoformat()},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        lesson = Lesson.objects.get(schedule_slot=slot)
        self.assertEqual(lesson.group_id, self.group.id)
        self.assertEqual(lesson.teacher_id, slot.teacher_id)
        self.assertEqual(lesson.start_time, slot.start_time)
        self.assertEqual(lesson.end_time, slot.end_time)

    def test_lessons_group_filter_returns_group_lessons(self):
        other_group = StudyGroup.objects.create(name='Other lessons', teacher=self.teacher)
        Lesson.objects.create(group=other_group, teacher=self.teacher, lesson_date=date.today(), start_time=time(9, 0), end_time=time(10, 0))
        self.client.force_authenticate(self.admin)

        response = self.client.get(
            '/api/lessons/',
            {'date_from': date.today().isoformat(), 'date_to': date.today().isoformat(), 'group': self.group.id},
        )

        self.assertEqual(response.status_code, 200)
        ids = {item['id'] for item in response.data}
        self.assertIn(self.lesson.id, ids)
        self.assertFalse(Lesson.objects.filter(id__in=ids, group=other_group).exists())

    def test_attendance_returns_students_only_from_lesson_group(self):
        other_group = StudyGroup.objects.create(name='Other group', teacher=self.teacher)
        other_client = Client.objects.create(first_name='Other', last_name='Student')
        GroupMembership.objects.create(group=other_group, client=other_client, status=GroupMembership.Status.ACTIVE)
        self.client.force_authenticate(self.admin)

        response = self.client.get(f'/api/lessons/{self.lesson.id}/attendance/')

        self.assertEqual(response.status_code, 200)
        client_ids = {item['client'] for item in response.data['items']}
        self.assertIn(self.clients[0].id, client_ids)
        self.assertNotIn(other_client.id, client_ids)

    def test_post_attendance_rejects_student_outside_lesson_group(self):
        other_client = Client.objects.create(first_name='Outside', last_name='Student')
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            f'/api/lessons/{self.lesson.id}/attendance/',
            {'items': [{'client': other_client.id, 'status': Visit.Status.ATTENDED}]},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Visit.objects.filter(lesson=self.lesson, client=other_client).exists())

    def test_new_active_member_appears_and_inactive_member_is_hidden(self):
        new_client = Client.objects.create(first_name='New', last_name='Member')
        inactive_client = Client.objects.create(first_name='Inactive', last_name='Member')
        GroupMembership.objects.create(group=self.group, client=new_client, status=GroupMembership.Status.ACTIVE)
        GroupMembership.objects.create(group=self.group, client=inactive_client, status=GroupMembership.Status.LEFT)
        self.client.force_authenticate(self.admin)

        response = self.client.get(f'/api/lessons/{self.lesson.id}/attendance/')

        self.assertEqual(response.status_code, 200)
        client_ids = {item['client'] for item in response.data['items']}
        self.assertIn(new_client.id, client_ids)
        self.assertNotIn(inactive_client.id, client_ids)

    def add_student(self, client, user=None, status_value=Visit.Status.ATTENDED, extra=None):
        self.client.force_authenticate(user or self.admin)
        payload = {'client': client.id, 'status': status_value, 'comment': 'Added from journal'}
        if extra:
            payload.update(extra)
        return self.client.post(
            f'/api/lessons/{self.lesson.id}/add-student/',
            payload,
            format='json',
        )

    def test_add_student_creates_membership_visit_and_automatic_links(self):
        client = Client.objects.create(first_name='Added', last_name='Student')
        subscription = Subscription.objects.create(
            client=client, title='Auto subscription', start_date=date.today(),
            total_visits=4, remaining_visits=4, status=Subscription.Status.ACTIVE,
        )

        response = self.add_student(client)

        self.assertEqual(response.status_code, 201)
        self.assertTrue(GroupMembership.objects.filter(group=self.group, client=client, status='active').exists())
        visit = Visit.objects.get(lesson=self.lesson, client=client)
        self.assertEqual(visit.teacher, self.lesson.teacher)
        self.assertEqual(visit.visited_at.date(), self.lesson.lesson_date)
        self.assertEqual(visit.subscription, subscription)
        self.assertEqual(subscription.__class__.objects.get(pk=subscription.pk).remaining_visits, 3)

    def test_add_student_without_subscription_does_not_fail(self):
        client = Client.objects.create(first_name='No', last_name='Subscription')

        response = self.add_student(client)

        self.assertEqual(response.status_code, 201)
        visit = Visit.objects.get(lesson=self.lesson, client=client)
        self.assertIsNone(visit.subscription)
        self.assertFalse(visit.lesson_deducted)

    def test_add_student_can_create_subscription_from_service_and_deduct_attended(self):
        branch = Branch.objects.create(name='Lesson branch')
        self.group.branch = branch
        self.group.save(update_fields=('branch', 'updated_at'))
        self.lesson.branch = branch
        self.lesson.save(update_fields=('branch', 'updated_at'))
        client = Client.objects.create(first_name='Paid', last_name='Student')
        service = CatalogItem.objects.create(
            name='AB-8',
            category=CatalogItem.Category.SERVICE,
            price='45000.00',
            lessons_count=8,
            validity_days=30,
        )

        response = self.add_student(client, extra={
            'create_subscription': True,
            'service': service.id,
            'start_date': '2026-07-09',
            'price': '45000.00',
            'payment_amount': '45000.00',
            'total_visits': 8,
            'remaining_visits': 8,
        })

        self.assertEqual(response.status_code, 201)
        subscription = Subscription.objects.get(client=client)
        visit = Visit.objects.get(lesson=self.lesson, client=client)
        transaction = FinanceTransaction.objects.get(subscription=subscription)
        self.assertEqual(subscription.service, service)
        self.assertEqual(str(subscription.price), str(service.price))
        self.assertEqual(subscription.total_visits, 8)
        self.assertEqual(subscription.remaining_visits, 7)
        self.assertEqual(subscription.start_date, date(2026, 7, 9))
        self.assertEqual(subscription.end_date, date(2026, 8, 7))
        self.assertEqual(subscription.branch, branch)
        self.assertEqual(visit.subscription, subscription)
        self.assertTrue(visit.lesson_deducted)
        self.assertEqual(str(transaction.amount), str(service.price))
        self.assertTrue(response.data['subscription_created'])

    def test_add_student_create_subscription_sick_does_not_deduct(self):
        client = Client.objects.create(first_name='Sick', last_name='Student')
        service = CatalogItem.objects.create(
            name='AB-4',
            category=CatalogItem.Category.SERVICE,
            price='24000.00',
            lessons_count=4,
            validity_days=28,
        )

        response = self.add_student(client, status_value=Visit.Status.SICK, extra={
            'create_subscription': True,
            'service': service.id,
            'total_visits': 4,
            'remaining_visits': 4,
        })

        self.assertEqual(response.status_code, 201)
        subscription = Subscription.objects.get(client=client)
        visit = Visit.objects.get(lesson=self.lesson, client=client)
        self.assertEqual(subscription.remaining_visits, 4)
        self.assertFalse(visit.lesson_deducted)

    def test_add_student_without_create_subscription_uses_existing_active_only(self):
        client = Client.objects.create(first_name='Existing', last_name='Student')
        existing = Subscription.objects.create(
            client=client,
            title='AB-4',
            start_date=date.today(),
            total_visits=4,
            remaining_visits=4,
            status=Subscription.Status.ACTIVE,
        )

        response = self.add_student(client, extra={'create_subscription': False})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Subscription.objects.filter(client=client).count(), 1)
        self.assertEqual(Visit.objects.get(lesson=self.lesson, client=client).subscription, existing)

    def test_add_student_rejects_product_as_subscription_service(self):
        client = Client.objects.create(first_name='Bad', last_name='Service')
        product = CatalogItem.objects.create(name='Book', category=CatalogItem.Category.PRODUCT, price='3500.00')

        response = self.add_student(client, extra={'create_subscription': True, 'service': product.id})

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Subscription.objects.filter(client=client).exists())

    def test_add_student_reuses_membership_and_visit(self):
        client = self.clients[0]

        first = self.add_student(client)
        second = self.add_student(client, status_value=Visit.Status.SICK)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(GroupMembership.objects.filter(group=self.group, client=client, status='active').count(), 1)
        self.assertEqual(Visit.objects.filter(lesson=self.lesson, client=client).count(), 1)
        self.assertTrue(second.data['already_in_group'])
        self.assertEqual(second.data['item']['status'], Visit.Status.SICK)

    def test_add_student_reactivates_inactive_membership(self):
        client = Client.objects.create(first_name='Returning', last_name='Student')
        membership = GroupMembership.objects.create(group=self.group, client=client, status=GroupMembership.Status.LEFT)

        response = self.add_student(client)

        self.assertEqual(response.status_code, 201)
        membership.refresh_from_db()
        self.assertEqual(membership.status, GroupMembership.Status.ACTIVE)
        self.assertEqual(GroupMembership.objects.filter(group=self.group, client=client).count(), 1)

    def test_group_membership_api_reactivates_without_duplicate(self):
        client = Client.objects.create(first_name='Returning', last_name='Through API')
        membership = GroupMembership.objects.create(
            group=self.group,
            client=client,
            status=GroupMembership.Status.LEFT,
            left_at=date.today(),
        )
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            '/api/group-memberships/',
            {'group': self.group.id, 'client': client.id, 'status': GroupMembership.Status.ACTIVE},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        membership.refresh_from_db()
        self.assertEqual(membership.status, GroupMembership.Status.ACTIVE)
        self.assertIsNone(membership.left_at)
        self.assertEqual(GroupMembership.objects.filter(group=self.group, client=client).count(), 1)

    def test_plain_teacher_cannot_add_student(self):
        client = Client.objects.create(first_name='Forbidden', last_name='Student')

        response = self.add_student(client, user=self.teacher)

        self.assertEqual(response.status_code, 403)
        self.assertFalse(GroupMembership.objects.filter(group=self.group, client=client).exists())

    def test_manager_admin_and_teacher_manager_can_add_student(self):
        for index, user in enumerate((self.manager, self.admin, self.teacher_manager)):
            client = Client.objects.create(first_name='Allowed', last_name=str(index))
            response = self.add_student(client, user=user, status_value=Visit.Status.MISSED)
            self.assertEqual(response.status_code, 201)
            self.assertTrue(GroupMembership.objects.filter(group=self.group, client=client, status='active').exists())

    def next_weekday(self, weekday):
        current = date.today()
        days_ahead = (weekday - current.weekday()) % 7
        return current + timedelta(days=days_ahead)

    def create_slot_for_weekday(self, weekday=1, group=None):
        return ScheduleSlot.objects.create(
            group=group or self.group,
            teacher=self.teacher,
            weekday=weekday,
            start_time=time(14, 30),
            end_time=time(15, 30),
            is_active=True,
        )

    def test_attendance_day_returns_schedule_slot_without_lesson(self):
        slot = self.create_slot_for_weekday(weekday=1)
        lesson_date = self.next_weekday(1)
        self.client.force_authenticate(self.admin)

        response = self.client.get('/api/attendance/day/', {'date': lesson_date.isoformat()})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(any(item['type'] == 'schedule_slot' and item['schedule_slot_id'] == slot.id for item in response.data['items']))

    def test_attendance_day_does_not_return_slot_on_wrong_weekday(self):
        slot = self.create_slot_for_weekday(weekday=1)
        lesson_date = self.next_weekday(2)
        self.client.force_authenticate(self.admin)

        response = self.client.get('/api/attendance/day/', {'date': lesson_date.isoformat()})

        self.assertEqual(response.status_code, 200)
        self.assertFalse(any(item.get('schedule_slot_id') == slot.id for item in response.data['items']))

    def test_attendance_day_returns_existing_lesson_instead_of_duplicate_slot(self):
        slot = self.create_slot_for_weekday(weekday=1)
        lesson_date = self.next_weekday(1)
        lesson = Lesson.objects.create(
            group=self.group,
            schedule_slot=slot,
            teacher=self.teacher,
            lesson_date=lesson_date,
            start_time=slot.start_time,
            end_time=slot.end_time,
        )
        self.client.force_authenticate(self.admin)

        response = self.client.get('/api/attendance/day/', {'date': lesson_date.isoformat()})

        self.assertEqual(response.status_code, 200)
        matching = [item for item in response.data['items'] if item.get('schedule_slot_id') == slot.id]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]['type'], 'lesson')
        self.assertEqual(matching[0]['lesson_id'], lesson.id)

    def test_ensure_lesson_creates_lesson_for_slot_date(self):
        slot = self.create_slot_for_weekday(weekday=1)
        lesson_date = self.next_weekday(1)
        self.client.force_authenticate(self.admin)

        response = self.client.post(f'/api/schedule-slots/{slot.id}/ensure-lesson/', {'date': lesson_date.isoformat()}, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['created'])
        lesson = Lesson.objects.get(id=response.data['lesson']['id'])
        self.assertEqual(lesson.group_id, self.group.id)
        self.assertEqual(lesson.schedule_slot_id, slot.id)
        self.assertEqual(lesson.lesson_date, lesson_date)

    def test_ensure_lesson_does_not_create_duplicate(self):
        slot = self.create_slot_for_weekday(weekday=1)
        lesson_date = self.next_weekday(1)
        self.client.force_authenticate(self.admin)

        first = self.client.post(f'/api/schedule-slots/{slot.id}/ensure-lesson/', {'date': lesson_date.isoformat()}, format='json')
        second = self.client.post(f'/api/schedule-slots/{slot.id}/ensure-lesson/', {'date': lesson_date.isoformat()}, format='json')

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertFalse(second.data['created'])
        self.assertEqual(Lesson.objects.filter(schedule_slot=slot, lesson_date=lesson_date, start_time=slot.start_time).count(), 1)

    def test_ensure_lesson_rejects_wrong_weekday(self):
        slot = self.create_slot_for_weekday(weekday=1)
        lesson_date = self.next_weekday(2)
        self.client.force_authenticate(self.admin)

        response = self.client.post(f'/api/schedule-slots/{slot.id}/ensure-lesson/', {'date': lesson_date.isoformat()}, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Lesson.objects.filter(schedule_slot=slot, lesson_date=lesson_date).exists())

    def test_attendance_day_group_filter(self):
        slot = self.create_slot_for_weekday(weekday=1)
        other_group = StudyGroup.objects.create(name='Filtered other', teacher=self.teacher)
        other_slot = self.create_slot_for_weekday(weekday=1, group=other_group)
        lesson_date = self.next_weekday(1)
        self.client.force_authenticate(self.admin)

        response = self.client.get('/api/attendance/day/', {'date': lesson_date.isoformat(), 'group': self.group.id})

        self.assertEqual(response.status_code, 200)
        slot_ids = {item['schedule_slot_id'] for item in response.data['items']}
        self.assertIn(slot.id, slot_ids)
        self.assertNotIn(other_slot.id, slot_ids)

    def test_attendance_after_ensure_lesson_returns_group_students(self):
        slot = self.create_slot_for_weekday(weekday=1)
        lesson_date = self.next_weekday(1)
        inactive_client = Client.objects.create(first_name='Inactive', last_name='Ensured')
        GroupMembership.objects.create(group=self.group, client=inactive_client, status=GroupMembership.Status.LEFT)
        self.client.force_authenticate(self.admin)
        ensured = self.client.post(f'/api/schedule-slots/{slot.id}/ensure-lesson/', {'date': lesson_date.isoformat()}, format='json')

        response = self.client.get(f"/api/lessons/{ensured.data['lesson']['id']}/attendance/")

        self.assertEqual(response.status_code, 200)
        client_ids = {item['client'] for item in response.data['items']}
        self.assertIn(self.clients[0].id, client_ids)
        self.assertNotIn(inactive_client.id, client_ids)


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
                'roles': ['manager'],
                'password': '1234',
                'is_active': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        manager = User.objects.get(username='manager')
        self.assertEqual(manager.role, 'manager')
        self.assertEqual(manager.phone, '+77001112233')
        self.assertEqual(manager.email, '')
        self.assertTrue(manager.check_password('1234'))
        self.assertNotIn('password', response.data)
        self.assertTrue(AuditLog.objects.filter(action='create', entity_type='User', description='Создан сотрудник').exists())

    def test_admin_can_create_employee_without_email_and_with_simple_password(self):
        User = get_user_model()
        admin = User.objects.create_user(username='admin', password='password123', role='admin', roles=['admin'])
        self.client.force_authenticate(admin)

        response = self.client.post(
            '/api/users/employees/',
            {
                'username': 'teacher1',
                'full_name': 'Ivan Ivanov',
                'roles': ['teacher'],
                'password': '1234',
                'is_active': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        employee = User.objects.get(username='teacher1')
        self.assertEqual(employee.email, '')
        self.assertTrue(employee.check_password('1234'))
        self.assertNotIn('password', response.data)

    def test_admin_can_create_multiple_employees_without_email(self):
        User = get_user_model()
        admin = User.objects.create_user(username='admin', password='password123', role='admin', roles=['admin'])
        self.client.force_authenticate(admin)

        first = self.client.post('/api/users/employees/', {'username': 'employee1', 'password': '1234', 'roles': ['manager']}, format='json')
        second = self.client.post('/api/users/employees/', {'username': 'employee2', 'password': '1234', 'roles': ['teacher']}, format='json')

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(User.objects.filter(email='').count(), 3)

    def test_employee_create_requires_username_password_and_roles(self):
        User = get_user_model()
        admin = User.objects.create_user(username='admin', password='password123', role='admin', roles=['admin'])
        self.client.force_authenticate(admin)

        without_username = self.client.post('/api/users/employees/', {'password': '1234', 'roles': ['manager']}, format='json')
        without_password = self.client.post('/api/users/employees/', {'username': 'no-password', 'roles': ['manager']}, format='json')
        without_roles = self.client.post('/api/users/employees/', {'username': 'no-roles', 'password': '1234'}, format='json')

        self.assertEqual(without_username.status_code, 400)
        self.assertEqual(without_password.status_code, 400)
        self.assertEqual(without_roles.status_code, 400)

    def test_empty_password_on_employee_update_does_not_change_password(self):
        User = get_user_model()
        admin = User.objects.create_user(username='admin', password='password123', role='admin', roles=['admin'])
        employee = User.objects.create_user(username='teacher', password='oldpass123', role='teacher', roles=['teacher'])
        old_hash = employee.password
        self.client.force_authenticate(admin)

        response = self.client.patch(f'/api/users/employees/{employee.id}/', {'password': '', 'roles': ['teacher']}, format='json')

        self.assertEqual(response.status_code, 200)
        employee.refresh_from_db()
        self.assertEqual(employee.password, old_hash)
        self.assertTrue(employee.check_password('oldpass123'))

    def test_new_password_on_employee_update_changes_password(self):
        User = get_user_model()
        admin = User.objects.create_user(username='admin', password='password123', role='admin', roles=['admin'])
        employee = User.objects.create_user(username='teacher', password='oldpass123', role='teacher', roles=['teacher'])
        old_hash = employee.password
        self.client.force_authenticate(admin)

        response = self.client.patch(f'/api/users/employees/{employee.id}/', {'password': '1234', 'roles': ['teacher']}, format='json')

        self.assertEqual(response.status_code, 200)
        employee.refresh_from_db()
        self.assertNotEqual(employee.password, old_hash)
        self.assertTrue(employee.check_password('1234'))

    def test_employee_password_is_not_written_to_audit_log(self):
        User = get_user_model()
        admin = User.objects.create_user(username='admin', password='password123', role='admin', roles=['admin'])
        self.client.force_authenticate(admin)

        response = self.client.post(
            '/api/users/employees/',
            {'username': 'audited', 'password': '1234', 'roles': ['manager']},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        audit = AuditLog.objects.filter(entity_type='User', entity_name='audited').latest('created_at')
        self.assertNotIn('password', audit.changes)
        self.assertNotIn('password_confirm', audit.changes)

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
        legacy_teacher = User.objects.create_user(
            username='legacy-staff-teacher',
            password='password123',
            role='teacher',
            roles=[],
            is_active=True,
        )
        employee = User.objects.create_user(
            username='multi-role',
            password='password123',
            role='manager',
            roles=['teacher', 'manager'],
            is_active=True,
        )
        accountant = User.objects.create_user(
            username='accountant-only',
            password='password123',
            role='accountant',
            roles=['accountant'],
            is_active=True,
        )
        inactive_teacher = User.objects.create_user(
            username='inactive-teacher',
            password='password123',
            role='teacher',
            roles=['teacher'],
            is_active=False,
        )
        self.client.force_authenticate(admin)

        teacher_response = self.client.get('/api/users/staff-options/?role=teacher&active=1')
        manager_response = self.client.get('/api/users/staff-options/?role=manager&active=1')

        self.assertEqual(teacher_response.status_code, 200)
        self.assertEqual(manager_response.status_code, 200)
        teacher_ids = {item['id'] for item in teacher_response.data}
        manager_ids = {item['id'] for item in manager_response.data}
        self.assertIn(legacy_teacher.id, teacher_ids)
        self.assertIn(employee.id, teacher_ids)
        self.assertIn(employee.id, manager_ids)
        self.assertNotIn(accountant.id, teacher_ids)
        self.assertNotIn(inactive_teacher.id, teacher_ids)
        employee_item = next(item for item in teacher_response.data if item['id'] == employee.id)
        self.assertEqual(employee_item['roles'], ['teacher', 'manager'])
        self.assertIn('Преподаватель', employee_item['display_name'])
        self.assertIn('Менеджер', employee_item['display_name'])

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

    def test_conversion_accepts_service_and_copies_catalog_values(self):
        service = CatalogItem.objects.create(
            name='AB-4', price='24000.00', category=CatalogItem.Category.SERVICE, lessons_count=4, validity_days=28,
        )
        trial = self.create_trial()
        self.client.force_authenticate(self.admin)
        payload = {
            'service': service.id,
            'start_date': date.today().isoformat(),
            'payment_amount': '20000',
            'payment_method': 'cash',
        }

        response = self.client.post(f'/api/trials/{trial.id}/convert-to-subscription/', payload, format='json')

        self.assertEqual(response.status_code, 201)
        service.refresh_from_db()
        subscription = Subscription.objects.get(pk=response.data['subscription']['id'])
        transaction = FinanceTransaction.objects.get(pk=response.data['finance_transaction']['id'])
        self.assertEqual(subscription.service, service)
        self.assertEqual(subscription.title, 'AB-4')
        self.assertEqual(subscription.price, service.price)
        self.assertEqual(subscription.total_visits, 4)
        self.assertEqual(subscription.remaining_visits, 4)
        self.assertEqual(subscription.end_date, date.today() + timedelta(days=27))
        self.assertEqual(transaction.amount, 20000)

    def test_conversion_with_service_defaults_start_end_and_payment(self):
        service = CatalogItem.objects.create(
            name='AB-8', price='45000.00', category=CatalogItem.Category.SERVICE, lessons_count=8, validity_days=30,
        )
        trial = self.create_trial()
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            f'/api/trials/{trial.id}/convert-to-subscription/',
            {'service': service.id, 'payment_method': 'cash'},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        subscription = Subscription.objects.get(pk=response.data['subscription']['id'])
        transaction = FinanceTransaction.objects.get(pk=response.data['finance_transaction']['id'])
        self.assertEqual(subscription.start_date, timezone.localdate())
        self.assertEqual(subscription.end_date, timezone.localdate() + timedelta(days=29))
        self.assertEqual(subscription.total_visits, 8)
        self.assertEqual(subscription.remaining_visits, 8)
        self.assertEqual(str(transaction.amount), str(service.price))

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


class BranchIntegrationTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(username='branch-admin', password='pass', role='admin', roles=['admin'])
        self.manager = User.objects.create_user(username='branch-manager', password='pass', role='manager', roles=['manager'])
        self.branch = Branch.objects.create(name='Сарыарка', address='Астана')
        self.other_branch = Branch.objects.create(name='Левый берег')

    def test_admin_crud_soft_delete_and_audit(self):
        self.client.force_authenticate(self.admin)
        created = self.client.post('/api/branches/', {'name': 'Новый филиал'}, format='json')
        self.assertEqual(created.status_code, 201)
        branch_id = created.data['id']
        self.assertTrue(AuditLog.objects.filter(action=AuditLog.Action.BRANCH_CREATE, entity_id=str(branch_id)).exists())

        updated = self.client.patch(f'/api/branches/{branch_id}/', {'address': 'Новый адрес'}, format='json')
        disabled = self.client.delete(f'/api/branches/{branch_id}/')

        self.assertEqual(updated.status_code, 200)
        self.assertEqual(disabled.status_code, 204)
        self.assertFalse(Branch.objects.get(pk=branch_id).is_active)
        self.assertTrue(AuditLog.objects.filter(action=AuditLog.Action.BRANCH_UPDATE, entity_id=str(branch_id)).exists())
        self.assertTrue(AuditLog.objects.filter(action=AuditLog.Action.BRANCH_DISABLE, entity_id=str(branch_id)).exists())

    def test_manager_cannot_create_branch(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post('/api/branches/', {'name': 'Forbidden'}, format='json')
        self.assertEqual(response.status_code, 403)

    def test_branch_inheritance_chain_and_filters(self):
        client = Client.objects.create(first_name='Branch', last_name='Student', branch=self.branch)
        room = Room.objects.create(name='101', branch=self.branch)
        group = StudyGroup.objects.create(name='Branch group', room=room)
        slot = ScheduleSlot.objects.create(
            group=group, room=room, weekday=date.today().weekday(),
            start_time=time(9), end_time=time(10),
        )
        lesson = Lesson.objects.create(
            group=group, schedule_slot=slot, room=room,
            lesson_date=date.today(), start_time=time(9), end_time=time(10),
        )
        subscription = Subscription.objects.create(
            client=client, title='AB-8', start_date=date.today(),
            total_visits=8, remaining_visits=8,
        )
        visit = Visit.objects.create(
            client=client, subscription=subscription, lesson=lesson,
            visited_at=timezone.now(), status=Visit.Status.ATTENDED,
        )

        self.assertEqual(group.branch, self.branch)
        self.assertEqual(slot.branch, self.branch)
        self.assertEqual(lesson.branch, self.branch)
        self.assertEqual(subscription.branch, self.branch)
        self.assertEqual(visit.branch, self.branch)

        Client.objects.create(first_name='Other', branch=self.other_branch)
        self.client.force_authenticate(self.admin)
        clients = self.client.get('/api/clients/', {'branch': self.branch.id})
        groups = self.client.get('/api/study-groups/', {'branch': self.branch.id})
        day = self.client.get('/api/attendance/day/', {'date': date.today().isoformat(), 'branch': self.branch.id})
        self.assertEqual({item['id'] for item in clients.data}, {client.id})
        self.assertEqual({item['id'] for item in groups.data}, {group.id})
        self.assertEqual({item['lesson_id'] for item in day.data['items']}, {lesson.id})

    def test_trial_conversion_and_dashboard_keep_branch(self):
        client = Client.objects.create(first_name='Trial', branch=self.branch)
        trial = Trial.objects.create(client=client, scheduled_at=timezone.now(), branch=self.branch)
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            f'/api/trials/{trial.id}/convert-to-subscription/',
            {
                'subscription_type': 'AB-8', 'start_date': date.today().isoformat(),
                'total_visits': 8, 'price': '40000', 'payment_amount': '40000',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        subscription = Subscription.objects.get(pk=response.data['subscription']['id'])
        transaction = FinanceTransaction.objects.get(pk=response.data['finance_transaction']['id'])
        self.assertEqual(subscription.branch, self.branch)
        self.assertEqual(transaction.branch, self.branch)
        dashboard = self.client.get('/api/dashboard/stats/', {'branch': self.branch.id})
        self.assertEqual(dashboard.status_code, 200)
        self.assertEqual(float(dashboard.data['finance']['income']), 40000.0)


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
