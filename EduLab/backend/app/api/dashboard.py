"""Dashboard API routes for teachers (ТЗ §8.4, Этап 2).

Endpoints:
- GET /dashboard/groups/{group_id}   — студенты группы со статусами
- GET /dashboard/containers          — все активные контейнеры
- GET /dashboard/student/{id}/stats  — статистика студента по лабе
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.database import get_db
from app.models.user import User, Group, UserRole
from app.services import lab_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/groups/{group_id}")
async def get_group_students(
    group_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GET /dashboard/groups/{group_id} — список студентов со статусами (ТЗ §8.4).

    Показывает:
    - Имя студента
    - Онлайн / оффлайн (из Redis online:{group_id})
    - Активный контейнер (если есть)
    """
    if user.role.value not in ("teacher", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только для преподавателей")

    # Get group
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="Группа не найдена")

    # Get students in group
    result = await db.execute(
        select(User).where(User.group_id == group_id, User.role == UserRole.student)
    )
    students = result.scalars().all()

    # Get online set from Redis (ТЗ §9.2)
    online_ids = set()
    if lab_service.redis_client:
        try:
            online_ids = await lab_service.redis_client.smembers(f"online:{group_id}")
        except Exception:
            pass

    student_list = []
    for s in students:
        # Check if student has active container
        active_container = None
        if lab_service.redis_client:
            try:
                # Scan for any active container for this student
                keys = []
                async for key in lab_service.redis_client.scan_iter(f"container:{s.id}:*"):
                    keys.append(key)
                for key in keys:
                    data = await lab_service.redis_client.hgetall(key)
                    if data and data.get("status") in ("running", "starting"):
                        lab_id = key.split(":")[-1]
                        active_container = {
                            "lab_id": int(lab_id),
                            "container_id": data.get("container_id", ""),
                            "started_at": data.get("started_at", ""),
                        }
                        break
            except Exception:
                pass

        student_list.append({
            "id": s.id,
            "name": s.name,
            "email": s.email,
            "is_online": str(s.id) in online_ids,
            "active_container": active_container,
        })

    return {
        "group": {"id": group.id, "name": group.name, "year": group.year},
        "students": student_list,
    }


@router.get("/containers")
async def get_all_containers(
    user: User = Depends(get_current_user),
):
    """GET /dashboard/containers — все активные контейнеры (ТЗ §8.4)."""
    if user.role.value not in ("teacher", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только для преподавателей")

    containers = []
    if lab_service.redis_client:
        try:
            async for key in lab_service.redis_client.scan_iter("container:*"):
                parts = key.split(":")
                if len(parts) != 3:
                    continue
                data = await lab_service.redis_client.hgetall(key)
                if data and data.get("status") in ("running", "starting"):
                    containers.append({
                        "student_id": int(parts[1]),
                        "lab_id": int(parts[2]),
                        "container_id": data.get("container_id", ""),
                        "port": data.get("port", ""),
                        "started_at": data.get("started_at", ""),
                        "status": data.get("status", ""),
                    })
        except Exception as exc:
            logger.error(f"Error scanning containers: {exc}")

    return {"containers": containers, "total": len(containers)}


@router.get("/student/{student_id}/stats")
async def get_student_stats(
    student_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GET /dashboard/student/{id}/stats — статистика работы студента (ТЗ §8.4)."""
    if user.role.value not in ("teacher", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только для преподавателей")

    # Get student info
    result = await db.execute(select(User).where(User.id == student_id))
    student = result.scalar_one_or_none()
    if student is None:
        raise HTTPException(status_code=404, detail="Студент не найден")

    # Get stats from Redis (ТЗ §9.2)
    lab_stats = []
    if lab_service.redis_client:
        try:
            async for key in lab_service.redis_client.scan_iter(f"stats:{student_id}:*"):
                parts = key.split(":")
                lab_id = int(parts[2])
                data = await lab_service.redis_client.hgetall(key)
                lab_stats.append({
                    "lab_id": lab_id,
                    "runs_count": int(data.get("runs_count", 0)),
                    "errors_count": int(data.get("errors_count", 0)),
                    "last_run": data.get("last_run", ""),
                })
        except Exception as exc:
            logger.error(f"Error getting stats: {exc}")

    # Get container sessions from DB
    from app.models.result import ContainerSession
    result = await db.execute(
        select(ContainerSession).where(ContainerSession.student_id == student_id)
    )
    sessions = result.scalars().all()

    return {
        "student": {"id": student.id, "name": student.name, "email": student.email},
        "lab_stats": lab_stats,
        "total_sessions": len(sessions),
    }
