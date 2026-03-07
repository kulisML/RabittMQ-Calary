"""Labs API routes (ТЗ §8.2)."""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.database import get_db
from app.models.user import User
from app.schemas.lab import LabCreateRequest, LabDetail, LabOpenResponse, LabOut
from app.services import lab_service
from app.models.lab import Lab

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/labs", tags=["labs"])


@router.get("", response_model=list[LabOut])
async def list_labs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GET /labs — список лаб текущего студента (ТЗ §8.2)."""
    labs = await lab_service.get_student_labs(db, user)
    return labs


@router.get("/{lab_id}", response_model=LabDetail)
async def get_lab(
    lab_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GET /labs/{lab_id} — детали лабы: описание, тесты, шаблон кода (ТЗ §8.2)."""
    lab = await lab_service.get_lab_detail(db, lab_id)
    if lab is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Лабораторная работа не найдена",
        )
    return lab


@router.post("/{lab_id}/open", response_model=LabOpenResponse)
async def open_lab(
    lab_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """POST /labs/{lab_id}/open — открыть лабу, поднять контейнер (ТЗ §8.2).

    Flow (ТЗ §3.2):
    1. Проверяем, есть ли уже контейнер для этого студента
    2. Если нет — публикуем container.start в RabbitMQ
    3. Container Manager получает событие, запускает Docker-контейнер
    4. Возвращаем ws_ticket для подключения через WebSocket
    """
    lab = await lab_service.get_lab_detail(db, lab_id)
    if lab is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Лабораторная работа не найдена",
        )

    result = await lab_service.open_lab(db, user, lab)

    return LabOpenResponse(
        container_id=result["container_id"],
        port=result["port"],
        status=result["status"],
        ws_ticket=result["ws_ticket"],
    )


@router.post("", response_model=LabDetail)
async def create_lab(
    body: LabCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """POST /labs — создать новую лабораторную работу (только препод) (ТЗ §8.4)."""
    if user.role.value not in ("teacher", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только преподаватель может создавать лабораторные работы",
        )

    lab = Lab(
        title=body.title,
        description=body.description,
        language=body.language,
        template_code=body.template_code,
        tests_json=body.tests_json,
        deadline=body.deadline,
    )
    db.add(lab)
    await db.flush()
    await db.refresh(lab)

    logger.info(f"Lab created: {lab.title} by {user.email}")
    return lab
