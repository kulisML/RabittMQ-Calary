"""Auth API routes (ТЗ §8.1)."""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.database import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse, UserOut
from app.services import auth_service, lab_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    """POST /auth/login — авторизация, возвращает JWT-токен (ТЗ §8.1)."""
    user = await auth_service.authenticate_user(db, body.email, body.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
        )

    token = auth_service.create_user_token(user)

    # Save session in Redis (ТЗ §9.2)
    if lab_service.redis_client:
        await lab_service.redis_client.hset(f"session:{token}", mapping={
            "user_id": str(user.id),
            "role": user.role.value,
        })
        await lab_service.redis_client.expire(f"session:{token}", 86400)  # 24 hours

    logger.info(f"User {user.email} logged in")
    return TokenResponse(access_token=token)


@router.post("/logout")
async def logout(user: User = Depends(get_current_user)):
    """POST /auth/logout — завершение сессии (ТЗ §8.1)."""
    # Remove from online individual key
    if user.group_id and lab_service.redis_client:
        await lab_service.redis_client.delete(f"online_user:{user.group_id}:{user.id}")

    return {"detail": "Сессия завершена"}


@router.post("/ping")
async def ping(user: User = Depends(get_current_user)):
    """POST /auth/ping — поддержание онлайн-статуса (ТЗ §8.1)."""
    if user.group_id and lab_service.redis_client:
        await lab_service.redis_client.setex(f"online_user:{user.group_id}:{user.id}", 120, "1")
    return {"detail": "pong"}

@router.get("/me", response_model=UserOut)
async def get_me(user: User = Depends(get_current_user)):
    """GET /auth/me — данные текущего пользователя (ТЗ §8.1)."""
    return UserOut(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role.value,
        group_id=user.group_id,
    )
