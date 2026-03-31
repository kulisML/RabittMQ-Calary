"""Gamification API routes (Achievements, Leaderboard)."""
import logging
from typing import List, Optional
from datetime import datetime, timezone
from pydantic import BaseModel, ConfigDict
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select, desc

from app.core.dependencies import get_current_user
from app.database import get_db
from app.models.user import User
from app.models.achievement import Achievement, UserAchievement

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gamification", tags=["gamification"])


# --- Schemas ---
class AchievementOut(BaseModel):
    id: int
    slug: str
    name: str
    description: str
    icon_url: Optional[str]
    xp_reward: int
    
    model_config = ConfigDict(from_attributes=True)

class UserAchievementOut(BaseModel):
    id: int
    unlocked_at: datetime
    achievement: AchievementOut

    model_config = ConfigDict(from_attributes=True)

class GamerProfileOut(BaseModel):
    user_id: int
    name: str
    xp: int
    level: int
    unlocked_achievements: List[UserAchievementOut]

    model_config = ConfigDict(from_attributes=True)


# --- Endpoints ---
@router.get("/me", response_model=GamerProfileOut)
async def get_my_profile(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GET /gamification/me — Get user's gamification profile and achievements."""
    result = await db.execute(
        select(User)
        .where(User.id == user.id)
        .options(
            selectinload(User.achievements).selectinload(UserAchievement.achievement)
        )
    )
    user_db = result.scalar_one_or_none()
    if not user_db:
        raise HTTPException(status_code=404, detail="User not found")

    return GamerProfileOut(
        user_id=user_db.id,
        name=user_db.name,
        xp=user_db.xp,
        level=user_db.level,
        unlocked_achievements=user_db.achievements
    )


@router.get("/leaderboard")
async def get_leaderboard(
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
):
    """GET /gamification/leaderboard — Get top users by XP."""
    result = await db.execute(
        select(User).order_by(desc(User.xp)).limit(limit)
    )
    users = result.scalars().all()
    return [{"id": u.id, "name": u.name, "xp": u.xp, "level": u.level} for u in users]


@router.post("/internal/grant")
async def grant_achievement(
    user_id: int,
    achievement_slug: str,
    db: AsyncSession = Depends(get_db),
):
    """POST /gamification/internal/grant — Internal route to award achievement.
    In a real system, this would be protected by a service token.
    For MVP, we leave it open or simple.
    """
    # 1. Check if user exists
    user_res = await db.execute(select(User).where(User.id == user_id).options(selectinload(User.achievements)))
    user = user_res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 2. Check achievement exists
    ach_res = await db.execute(select(Achievement).where(Achievement.slug == achievement_slug))
    achievement = ach_res.scalar_one_or_none()
    if not achievement:
        # Auto-create for Demo
        achievement = Achievement(
            slug=achievement_slug,
            name=achievement_slug.replace("-", " ").title(),
            description=f"Generated achievement for {achievement_slug}",
            xp_reward=50
        )
        db.add(achievement)
        await db.flush()

    # 3. Check if already unlocked
    if any(ua.achievement_id == achievement.id for ua in user.achievements):
        return {"status": "already_unlocked", "achievement": achievement.slug}

    # 4. Grant
    ua = UserAchievement(user_id=user.id, achievement_id=achievement.id)
    db.add(ua)

    # Add XP and calculate level (Every 100 XP = 1 level)
    user.xp += achievement.xp_reward
    user.level = (user.xp // 100) + 1

    await db.commit()
    
    logger.info(f"Granted {achievement.slug} to User {user.id}. New XP: {user.xp}")
    return {"status": "granted", "achievement": achievement.slug, "new_xp": user.xp, "new_level": user.level}
