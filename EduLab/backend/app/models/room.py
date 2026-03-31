"""Room and RoomParticipant models for collaborative sessions."""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import relationship

from app.database import Base


class Room(Base):
    """Комната для совместного выполнения лабораторной работы."""
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    lab_id = Column(Integer, ForeignKey("labs.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    lab = relationship("Lab", back_populates="rooms")
    participants = relationship("RoomParticipant", back_populates="room")
    container_sessions = relationship("ContainerSession", back_populates="room")


class RoomParticipant(Base):
    """Участник комнаты."""
    __tablename__ = "room_participants"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    room = relationship("Room", back_populates="participants")
    user = relationship("User", back_populates="room_participations")
