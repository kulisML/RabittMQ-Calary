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
from app.worker.tasks import stop_container

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


@router.post("/{lab_id}/open")
async def open_lab(
    lab_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """POST /labs/{lab_id}/open — deprecated (ТЗ §8.2)."""
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Use /rooms/{room_id}/open to start a lab",
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


@router.post("/{lab_id}/ping")
async def ping_lab(
    lab_id: int,
    user: User = Depends(get_current_user),
):
    """POST /labs/{lab_id}/ping — deprecated."""
    return {"status": "deprecated", "detail": "Use /rooms/{room_id}/ping"}


@router.post("/{lab_id}/stop")
async def stop_lab_endpoint(
    lab_id: int,
    user: User = Depends(get_current_user),
):
    """POST /labs/{lab_id}/stop — deprecated."""
    return {"status": "deprecated", "detail": "Use /rooms/{room_id}/stop"}

