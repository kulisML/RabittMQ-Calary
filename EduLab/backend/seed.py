"""Seed script — creates test users and labs for development."""
import asyncio
import json
import sys

sys.path.insert(0, ".")

from app.config import settings
from app.database import async_session_factory, engine, Base
from app.models import User, Group, Lab, UserRole
from app.core.security import hash_password


async def seed():
    """Create test data."""
    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session_factory() as db:
        # Check if data already exists
        from sqlalchemy import select
        result = await db.execute(select(User))
        if result.scalars().first():
            print("Data already exists. Skipping seed.")
            return

        # 1. Create groups
        group1 = Group(name="ИВТ-21", year=2024, teacher_id=None)
        db.add(group1)
        await db.flush()

        # 2. Create admin
        admin = User(
            name="Администратор",
            email="admin@edulab.ru",
            password_hash=hash_password("admin123"),
            role=UserRole.admin,
        )
        db.add(admin)

        # 3. Create teacher
        teacher = User(
            name="Иванов Пётр Сергеевич",
            email="teacher@edulab.ru",
            password_hash=hash_password("teacher123"),
            role=UserRole.teacher,
        )
        db.add(teacher)
        await db.flush()

        # Update group teacher
        group1.teacher_id = teacher.id
        await db.flush()

        # 4. Create students
        students = [
            ("Петров Алексей", "student1@edulab.ru"),
            ("Сидорова Мария", "student2@edulab.ru"),
            ("Козлов Дмитрий", "student3@edulab.ru"),
        ]
        for name, email in students:
            student = User(
                name=name,
                email=email,
                password_hash=hash_password("student123"),
                role=UserRole.student,
                group_id=group1.id,
            )
            db.add(student)

        # 5. Create labs
        lab1_tests = json.dumps([
            {"name": "test_hello", "input": "", "expected_output": "Hello, World!"},
            {"name": "test_sum", "input": "3 5", "expected_output": "8"},
        ])

        lab1 = Lab(
            title="Введение в Python",
            description="Напишите программу, которая выводит 'Hello, World!' "
                        "и программу, которая считывает два числа и выводит их сумму.",
            language="python",
            template_code='# Задание 1: Выведите "Hello, World!"\nprint("Hello, World!")\n\n'
                          '# Задание 2: Считайте два числа и выведите их сумму\n'
                          'a, b = map(int, input().split())\nprint(a + b)\n',
            tests_json=lab1_tests,
        )

        lab2_tests = json.dumps([
            {"name": "test_factorial", "input": "5", "expected_output": "120"},
            {"name": "test_factorial_zero", "input": "0", "expected_output": "1"},
        ])

        lab2 = Lab(
            title="Функции и рекурсия",
            description="Реализуйте функцию вычисления факториала числа. "
                        "Программа должна считывать число n и выводить n!.",
            language="python",
            template_code='def factorial(n):\n    """Вычислите факториал числа n."""\n'
                          '    # Ваш код здесь\n    pass\n\n'
                          'n = int(input())\nprint(factorial(n))\n',
            tests_json=lab2_tests,
        )

        lab3 = Lab(
            title="Работа со списками",
            description="Напишите программу, которая сортирует список чисел "
                        "и находит медиану.",
            language="python",
            template_code='# Считайте список чисел через пробел\nnums = list(map(int, input().split()))\n\n'
                          '# Отсортируйте и найдите медиану\n',
            tests_json="[]",
        )

        db.add_all([lab1, lab2, lab3])
        await db.commit()

        print("Seed data created successfully!")
        print("=" * 50)
        print("Test accounts:")
        print("  Admin:   admin@edulab.ru / admin123")
        print("  Teacher: teacher@edulab.ru / teacher123")
        print("  Student: student1@edulab.ru / student123")
        print("  Student: student2@edulab.ru / student123")
        print("  Student: student3@edulab.ru / student123")
        print("=" * 50)


if __name__ == "__main__":
    asyncio.run(seed())
