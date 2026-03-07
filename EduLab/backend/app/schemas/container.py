"""Pydantic schemas for RabbitMQ messages (ТЗ §2.2)."""
from datetime import datetime

from pydantic import BaseModel


class ContainerStartMsg(BaseModel):
    """Message published to container.start queue."""
    student_id: int
    lab_id: int
    language: str
    image: str
    timestamp: datetime


class ContainerStopMsg(BaseModel):
    """Message published to container.stop queue."""
    student_id: int
    lab_id: int
    reason: str  # browser_closed, timeout, manual
    timestamp: datetime


class LabSubmitMsg(BaseModel):
    """Message published to lab.submit queue."""
    student_id: int
    lab_id: int
    code_snapshot: str
    timestamp: datetime


class LabResultMsg(BaseModel):
    """Message published to lab.results queue."""
    student_id: int
    lab_id: int
    grade: int
    passed_tests: int
    failed_tests: int
    details: list[dict] = []
    timestamp: datetime
