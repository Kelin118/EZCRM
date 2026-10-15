from datetime import date, datetime, time

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Client, GroupMembership, Lesson, StudyGroup, Subscription, Visit


class AttendancePeriodTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin = user_model.objects.create_user(username='period-admin', password='pass', role='admin', roles=['admin'])
        self.teacher = user_model.objects.create_user(username='period-teacher', password='pass', role='teacher', roles=['teacher'])
        self.other_teacher = user_model.objects.create_user(username='period-other', password='pass', role='teacher', roles=['teacher'])
        self.group = StudyGroup.objects.create(name='History group', teacher=self.teacher)
        self.current = Client.objects.create(first_name='Current', last_name='Student')
        self.former = Client.objects.create(first_name='Former', last_name='Student')
        GroupMembership.objects.create(group=self.group, client=self.current, joined_at=date(2026, 10, 3))
        GroupMembership.objects.create(
            group=self.group, client=self.former, joined_at=date(2026, 10, 3),
            left_at=date(2026, 10, 4), status=GroupMembership.Status.LEFT,
        )
        Subscription.objects.create(
            client=self.current, title='AB-8', start_date=date(2026, 10, 1),
            total_visits=8, remaining_visits=5, status=Subscription.Status.ACTIVE,
        )
        self.lessons = [
            Lesson.objects.create(
                group=self.group, teacher=self.teacher, lesson_date=day,
                start_time=time(9), end_time=time(10), status=status,
            )
            for day, status in (
                (date(2026, 10, 2), Lesson.Status.COMPLETED),
                (date(2026, 10, 3), Lesson.Status.COMPLETED),
                (date(2026, 10, 4), Lesson.Status.COMPLETED),
                (date(2026, 10, 10), Lesson.Status.PLANNED),
                (date(2026, 10, 17), Lesson.Status.CANCELLED),
            )
        ]
        self._visit(self.current, self.lessons[1], Visit.Status.ATTENDED, deducted=True)
        self._visit(self.current, self.lessons[2], Visit.Status.MISSED)
        self._visit(self.former, self.lessons[1], Visit.Status.SICK)
        self._visit(self.former, self.lessons[2], Visit.Status.ATTENDED)

    def _visit(self, client, lesson, status, *, deducted=False):
        Visit.objects.create(
            client=client, lesson=lesson, status=status, lesson_deducted=deducted,
            visited_at=timezone.make_aware(datetime.combine(lesson.lesson_date, time(9))),
        )

    def _get(self, **params):
        return self.client.get('/api/lessons/attendance-period/', {
            'group': self.group.id, 'date_from': '2026-10-01', 'date_to': '2026-10-31', **params,
        })

    def test_matrix_uses_actual_lessons_and_historical_membership(self):
        self.client.force_authenticate(self.admin)
        response = self._get()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([lesson['id'] for lesson in response.data['lessons']], [item.id for item in self.lessons[:4]])
        rows = {row['client']: row for row in response.data['students']}
        current = rows[self.current.id]
        former = rows[self.former.id]
        self.assertFalse(current['cells'][0]['eligible'])
        self.assertEqual(current['cells'][1]['status'], Visit.Status.ATTENDED)
        self.assertEqual(current['cells'][2]['status'], Visit.Status.MISSED)
        self.assertTrue(current['cells'][3]['eligible'])
        self.assertIsNone(current['cells'][3]['status'])
        self.assertEqual(current['totals'], {'attended': 1, 'sick': 0, 'missed': 1, 'unmarked': 1, 'deducted': 1})
        self.assertEqual(current['remaining_lessons'], 5)
        self.assertFalse(former['current_member'])
        self.assertFalse(former['cells'][3]['eligible'])
        self.assertEqual(former['totals'], {'attended': 1, 'sick': 1, 'missed': 0, 'unmarked': 0, 'deducted': 0})

    def test_teacher_cannot_read_another_teachers_group(self):
        self.client.force_authenticate(self.other_teacher)
        self.assertEqual(self._get().status_code, 404)
        self.client.force_authenticate(self.teacher)
        self.assertEqual(self._get().status_code, 200)

    def test_two_lessons_on_one_date_have_separate_columns(self):
        extra = Lesson.objects.create(
            group=self.group, teacher=self.teacher, lesson_date=date(2026, 10, 4),
            start_time=time(11), end_time=time(12), status=Lesson.Status.COMPLETED,
        )
        self._visit(self.current, extra, Visit.Status.ATTENDED)
        self.client.force_authenticate(self.admin)
        response = self._get()
        self.assertEqual(response.status_code, 200, response.data)
        lessons = response.data['lessons']
        self.assertEqual([lesson['id'] for lesson in lessons[2:4]], [self.lessons[2].id, extra.id])
        current = next(row for row in response.data['students'] if row['client'] == self.current.id)
        self.assertEqual(current['totals']['attended'], 2)
        self.assertEqual(len(current['cells']), len(lessons))

    def test_invalid_period_is_rejected(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self._get(date_from='2026-11-01').status_code, 400)
        self.assertEqual(self._get(date_to='2028-01-01').status_code, 400)
        self.assertEqual(self._get(group='invalid').status_code, 400)
