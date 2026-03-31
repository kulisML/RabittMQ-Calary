"""LabResult and ContainerSession models (ТЗ §9.1)."""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.database import Base


class LabResult(Base):
    """Результат сдачи лабораторной работы."""
    __tablename__ = "lab_results"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    lab_id = Column(Integer, ForeignKey("labs.id"), nullable=False, index=True)
    grade = Column(Integer, nullable=False, default=0)
    passed_tests = Column(Integer, nullable=False, default=0)
    failed_tests = Column(Integer, nullable=False, default=0)
    details = Column(Text, nullable=True)  # JSON with test details
    submitted_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    student = relationship("User", back_populates="lab_results")
    lab = relationship("Lab", back_populates="results")


class ContainerSession(Base):
    """Сессия работы в контейнере (привязана к комнате)."""
    __tablename__ = "container_sessions"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False, index=True)
    lab_id = Column(Integer, ForeignKey("labs.id"), nullable=False, index=True)
    container_id = Column(String(100), nullable=True)
    started_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    ended_at = Column(DateTime(timezone=True), nullable=True)
    total_runs = Column(Integer, nullable=False, default=0)

    # Relationships
    room = relationship("Room", back_populates="container_sessions")
    lab = relationship("Lab", back_populates="container_sessions")
