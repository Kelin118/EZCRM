from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = 'admin', 'Admin'
        MANAGER = 'manager', 'Manager'
        TEACHER = 'teacher', 'Teacher'
        ACCOUNTANT = 'accountant', 'Accountant'

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MANAGER)
    roles = models.JSONField(default=list, blank=True)
    phone = models.CharField(max_length=30, blank=True)

    def __str__(self):
        return self.get_full_name() or self.username

    def get_roles(self):
        if self.is_superuser:
            current_roles = ['admin']
            if isinstance(self.roles, list):
                current_roles.extend(self.roles)
            elif self.role:
                current_roles.append(self.role)
            return list(dict.fromkeys(filter(None, current_roles)))
        if isinstance(self.roles, list) and self.roles:
            return self.roles
        if self.role:
            return [self.role]
        return []

    def has_role(self, role_name):
        return self.is_superuser or role_name in self.get_roles()

    def has_any_role(self, role_names):
        return self.is_superuser or any(role_name in self.get_roles() for role_name in role_names)
