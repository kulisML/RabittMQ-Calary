"""Lab model (ТЗ §9.1)."""
from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class Lab(Base):
    """Лабораторная работа."""
    __tablename__ = "labs"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(300), nullable=False)
    description = Column(Text, nullable=False)
    language = Column(String(50), nullable=False)  # python, java, cpp, nodejs
    template_code = Column(Text, nullable=False, default="")
    tests_json = Column(Text, nullable=False, default="[]")  # JSON string
    deadline = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    results = relationship("LabResult", back_populates="lab")
    container_sessions = relationship("ContainerSession", back_populates="lab")
    rooms = relationship("Room", back_populates="lab")

