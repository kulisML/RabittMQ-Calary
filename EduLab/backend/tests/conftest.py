"""Pytest configuration and fixtures."""
import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.main import app
from app.models import User, Group, Lab, UserRole
from app.core.security import hash_password


# Use sqlite for testing
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
async def db_engine():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db_session(db_engine):
    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest.fixture
async def client(db_session):
    """AsyncClient with overridden database dependency."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    # Mock RabbitMQ and Redis
    import app.services.rabbitmq_service as rmq
    import app.services.lab_service as lab_svc

    rmq.publish = AsyncMock()
    lab_svc.redis_client = MagicMock()
    lab_svc.redis_client.hgetall = AsyncMock(return_value={})
    lab_svc.redis_client.hset = AsyncMock()
    lab_svc.redis_client.expire = AsyncMock()
    lab_svc.redis_client.sadd = AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()


@pytest.fixture
async def seed_data(db_session):
    """Create test users and labs."""
    group = Group(name="Test Group", year=2024)
    db_session.add(group)
    await db_session.flush()

    student = User(
        name="Test Student",
        email="student@test.ru",
        password_hash=hash_password("password123"),
        role=UserRole.student,
        group_id=group.id,
    )
    teacher = User(
        name="Test Teacher",
        email="teacher@test.ru",
        password_hash=hash_password("password123"),
        role=UserRole.teacher,
    )
    db_session.add_all([student, teacher])
    await db_session.flush()

    lab = Lab(
        title="Test Lab",
        description="Test description",
        language="python",
        template_code="print('hello')",
        tests_json='[{"name": "test_1", "input": "", "expected_output": "hello"}]',
    )
    db_session.add(lab)
    await db_session.commit()

    return {"student": student, "teacher": teacher, "lab": lab, "group": group}
