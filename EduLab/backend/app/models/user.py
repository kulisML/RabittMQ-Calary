"""User and Group models (ТЗ §9.1)."""
import enum

from sqlalchemy import Column, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class UserRole(str, enum.Enum):
    student = "student"
    teacher = "teacher"
    admin = "admin"


class Group(Base):
    """Учебная группа."""
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    year = Column(Integer, nullable=False)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Relationships
    teacher = relationship("User", back_populates="taught_groups", foreign_keys=[teacher_id])
    students = relationship("User", back_populates="group", foreign_keys="[User.group_id]")


class User(Base):
    """Пользователь системы: студент, преподаватель или администратор."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    email = Column(String(200), unique=True, nullable=False, index=True)
    password_hash = Column(String(200), nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.student)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True)
    
    # Gamification
    xp = Column(Integer, nullable=False, default=0)
    level = Column(Integer, nullable=False, default=1)

    # Relationships
    group = relationship("Group", back_populates="students", foreign_keys=[group_id])
    taught_groups = relationship("Group", back_populates="teacher", foreign_keys="[Group.teacher_id]")
    lab_results = relationship("LabResult", back_populates="student")
    room_participations = relationship("RoomParticipant", back_populates="user")
    achievements = relationship("UserAchievement", back_populates="user")


