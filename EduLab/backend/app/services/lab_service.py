"""Lab service — business logic for laboratory work management."""
import json
import secrets
from datetime import datetime, timezone

import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.lab import Lab
from app.models.result import ContainerSession, LabResult
from app.models.user import User

# Redis client (initialized on app startup)
redis_client: aioredis.Redis | None = None

# Celery app for sending tasks (synchronous — safe to use from async context)
from app.worker.celery_app import celery_app


async def init_redis() -> None:
    """Initialize Redis connection."""
    global redis_client
    redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)


async def close_redis() -> None:
    """Close Redis connection."""
    global redis_client
    if redis_client:
        await redis_client.close()
        redis_client = None


async def get_student_labs(db: AsyncSession, student: User) -> list[dict]:
    """Get all labs with status for a student (ТЗ §3.2)."""
    result = await db.execute(select(Lab))
    labs = result.scalars().all()

    lab_list = []
    for lab in labs:
        # Check if student has submitted
        sub_result = await db.execute(
            select(LabResult)
            .where(LabResult.student_id == student.id, LabResult.lab_id == lab.id)
        )
        submission = sub_result.scalar_one_or_none()

        # Check if container is active in Redis
        container_key = f"container:{student.id}:{lab.id}"
        container_data = await redis_client.hgetall(container_key) if redis_client else {}

        if submission:
            status = "submitted"
        elif container_data and container_data.get("status") in ("running", "starting"):
            status = "in_progress"
        else:
            status = "not_started"

        lab_list.append({
            "id": lab.id,
            "title": lab.title,
            "language": lab.language,
            "deadline": lab.deadline.isoformat() if lab.deadline else None,
            "status": status,
        })

    return lab_list


async def get_lab_detail(db: AsyncSession, lab_id: int) -> Lab | None:
    """Get lab by id."""
    result = await db.execute(select(Lab).where(Lab.id == lab_id))
    return result.scalar_one_or_none()


async def open_lab(
    db: AsyncSession, student: User, lab: Lab
) -> dict:
    """Open a lab — send Celery task to start container (ТЗ §3.2).

    1. Check if container already exists in Redis
    2. If not — send Celery task container.start
    3. Write "starting" to Redis immediately
    4. Generate WS ticket
    5. Return connection info
    """
    container_key = f"container:{student.id}:{lab.id}"

    # Check if container already running or starting
    existing = await redis_client.hgetall(container_key) if redis_client else {}
    if existing and existing.get("status") in ("running", "starting"):
        # Container already exists — generate new ticket and return
        ws_ticket = await _generate_ws_ticket(student.id, lab.id)
        return {
            "container_id": existing.get("container_id", "pending"),
            "port": int(existing.get("port", "0")),
            "status": existing.get("status", "starting"),
            "ws_ticket": ws_ticket,
        }

    # Determine Docker image based on language
    image_map = {
        "python": settings.DEFAULT_PYTHON_IMAGE,
        "java": "edulab-java:17",
        "cpp": "edulab-cpp:gcc13",
        "nodejs": "edulab-nodejs:20",
    }
    image = image_map.get(lab.language, settings.DEFAULT_PYTHON_IMAGE)

    # Send Celery task to start container (CRITICAL: use send_task, NOT raw publish)
    celery_app.send_task(
        "app.worker.tasks.start_container",
        kwargs={
            "student_id": student.id,
            "lab_id": lab.id,
            "language": lab.language,
            "image": image,
            "template_code": lab.template_code or "",
        },
        queue="container.start",
    )

    # Write "starting" status to Redis IMMEDIATELY
    if redis_client:
        await redis_client.hset(container_key, mapping={
            "container_id": "pending",
            "port": "0",
            "status": "starting",
            "started_at": datetime.now(timezone.utc).isoformat(),
        })
        await redis_client.expire(container_key, 600)  # 10 min TTL

    # Record session in DB
    session = ContainerSession(
        student_id=student.id,
        lab_id=lab.id,
    )
    db.add(session)
    await db.flush()

    # Generate WS ticket for browser connection
    ws_ticket = await _generate_ws_ticket(student.id, lab.id)

    # Update online set (ТЗ §9.2)
    if student.group_id and redis_client:
        await redis_client.setex(f"online_user:{student.group_id}:{student.id}", 120, "1")

    return {
        "container_id": "pending",
        "port": 0,
        "status": "starting",
        "ws_ticket": ws_ticket,
    }


async def _generate_ws_ticket(student_id: int, lab_id: int) -> str:
    """Generate a one-time WebSocket ticket (TTL 120 sec, stored in Redis)."""
    ticket = secrets.token_urlsafe(32)
    ticket_key = f"ws_ticket:{ticket}"

    if redis_client:
        await redis_client.hset(ticket_key, mapping={
            "student_id": str(student_id),
            "lab_id": str(lab_id),
        })
        await redis_client.expire(ticket_key, 120)  # 120 seconds TTL

    return ticket


async def get_container_info(student_id: int, lab_id: int) -> dict | None:
    """Get container info from Redis (ТЗ §9.2)."""
    if not redis_client:
        return None
    container_key = f"container:{student_id}:{lab_id}"
    data = await redis_client.hgetall(container_key)
    return data if data else None
