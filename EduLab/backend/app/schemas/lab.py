"""Pydantic schemas for labs."""
from datetime import datetime

from pydantic import BaseModel


class LabOut(BaseModel):
    """Lab in list view."""
    id: int
    title: str
    language: str
    deadline: datetime | None = None
    status: str = "not_started"  # not_started / in_progress / submitted

    class Config:
        from_attributes = True


class LabDetail(BaseModel):
    """Full lab details."""
    id: int
    title: str
    description: str
    language: str
    template_code: str
    tests_json: str
    deadline: datetime | None = None

    class Config:
        from_attributes = True


class LabCreateRequest(BaseModel):
    """POST /labs — create a new lab (teacher/admin only)."""
    title: str
    description: str
    language: str = "python"
    template_code: str = ""
    tests_json: str = "[]"
    deadline: datetime | None = None


class LabOpenResponse(BaseModel):
    """Response from POST /labs/{id}/open."""
    container_id: str
    port: int
    status: str
    ws_ticket: str  # One-time ticket for WebSocket auth
