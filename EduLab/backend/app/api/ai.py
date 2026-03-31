"""AI API routes for code review and suggestions."""
import logging
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.dependencies import get_current_user
from app.database import get_db
from app.models.user import User
from app.models.room import Room
from app.models.lab import Lab

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai"])


class AIAnalyzeRequest(BaseModel):
    room_id: int
    lab_id: int
    code: str

@router.post("/analyze")
async def trigger_ai_analysis(
    body: AIAnalyzeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """POST /ai/analyze — trigger asynchronous AI code review."""
    from app.worker.tasks import analyze_code_ai

    # Verify room and lab exist
    result = await db.execute(select(Room).where(Room.id == body.room_id, Room.lab_id == body.lab_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Room or lab not found.")

    result_lab = await db.execute(select(Lab).where(Lab.id == body.lab_id))
    lab = result_lab.scalar_one_or_none()
    language = lab.language if lab else "python"

    # Send to Celery
    analyze_code_ai.delay(
        room_id=body.room_id, 
        lab_id=body.lab_id, 
        code=body.code,
        language=language
    )

    return {"status": "queued"}

@router.get("/plaques/{room_id}/{lab_id}")
async def get_ai_plaques(
    room_id: int,
    lab_id: int,
    user: User = Depends(get_current_user),
):
    """GET /ai/plaques — poll for AI generated plaques."""
    from app.services import lab_service
    if not lab_service.redis_client:
        return {"status": "error", "detail": "Redis not configured"}
        
    import json
    key = f"ai_plaques:room:{room_id}:{lab_id}"
    data = await lab_service.redis_client.get(key)
    
    if data:
        return json.loads(data)
    return {"plaques": [], "timestamp": 0}

