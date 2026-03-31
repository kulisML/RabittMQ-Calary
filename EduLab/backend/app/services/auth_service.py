"""Authentication service."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User, UserRole


async def authenticate_user(
    db: AsyncSession, email: str, password: str
) -> User | None:
    """Verify user credentials. Returns User or None."""
    import logging
    logger = logging.getLogger("auth_service")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None:
        logger.warning(f"Login failed: User {email} not found")
        return None
    
    if not verify_password(password, user.password_hash):
        logger.warning(f"Login failed: Password mismatch for user {email}")
        return None
    
    logger.info(f"Successful login: {email}")
    return user


def create_user_token(user: User) -> str:
    """Create a JWT token for the given user."""
    return create_access_token(
        data={
            "sub": str(user.id),
            "role": user.role.value,
            "email": user.email,
        }
    )


async def create_user(
    db: AsyncSession,
    name: str,
    email: str,
    password: str,
    role: UserRole = UserRole.student,
    group_id: int | None = None,
) -> User:
    """Create a new user in the database."""
    user = User(
        name=name,
        email=email,
        password_hash=hash_password(password),
        role=role,
        group_id=group_id,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user
