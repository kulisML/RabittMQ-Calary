"""Pydantic schemas for authentication."""
from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    """POST /auth/login request body."""
    email: str
    password: str


class TokenResponse(BaseModel):
    """JWT token response."""
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    """User data returned by GET /auth/me."""
    id: int
    name: str
    email: str
    role: str
    group_id: int | None = None

    class Config:
        from_attributes = True
