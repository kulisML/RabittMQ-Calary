from datetime import datetime
from pydantic import BaseModel

class RoomParticipantBase(BaseModel):
    user_id: int
    joined_at: datetime

    class Config:
        from_attributes = True

class RoomParticipantOut(RoomParticipantBase):
    id: int
    user_name: str | None = None  # To fetch and display the participant name

class RoomBase(BaseModel):
    lab_id: int
    name: str

class RoomCreate(RoomBase):
    pass

class RoomOut(RoomBase):
    id: int
    created_at: datetime
    participants: list[RoomParticipantOut] = []

    class Config:
        from_attributes = True
