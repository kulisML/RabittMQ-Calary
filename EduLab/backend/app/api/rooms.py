"""Rooms API routes for collaborative sessions."""
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.database import get_db
from app.models.user import User
from app.models.room import Room, RoomParticipant
from app.models.lab import Lab
from app.schemas.room import RoomCreate, RoomOut, RoomParticipantOut

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/rooms", tags=["rooms"])


@router.get("/lab/{lab_id}", response_model=list[RoomOut])
async def list_lab_rooms(
    lab_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GET /rooms/lab/{lab_id} — list active rooms for a specific lab."""
    result = await db.execute(
        select(Room).where(Room.lab_id == lab_id).options(selectinload(Room.participants).selectinload(RoomParticipant.user))
    )
    rooms = result.scalars().all()
    
    out_rooms = []
    for r in rooms:
        parts = [
            RoomParticipantOut(
                id=p.id, 
                user_id=p.user_id, 
                joined_at=p.joined_at, 
                user_name=p.user.name if p.user else "Unknown"
            ) for p in r.participants
        ]
        out_rooms.append(RoomOut(id=r.id, lab_id=r.lab_id, name=r.name, created_at=r.created_at, participants=parts))
        
    return out_rooms


@router.post("", response_model=RoomOut)
async def create_room(
    body: RoomCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """POST /rooms — create a new room for a lab."""
    lab_result = await db.execute(select(Lab).where(Lab.id == body.lab_id))
    if not lab_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Lab not found")

    room = Room(lab_id=body.lab_id, name=body.name)
    db.add(room)
    await db.flush()
    await db.refresh(room)

    # Automatically add creator as participant
    participant = RoomParticipant(room_id=room.id, user_id=user.id)
    db.add(participant)
    await db.flush()
    
    # Reload with relationships
    result = await db.execute(
        select(Room).where(Room.id == room.id).options(selectinload(Room.participants).selectinload(RoomParticipant.user))
    )
    room_reloaded = result.scalar_one()

    parts = [
        RoomParticipantOut(
            id=p.id, 
            user_id=p.user_id, 
            joined_at=p.joined_at, 
            user_name=p.user.name if p.user else "Unknown"
        ) for p in room_reloaded.participants
    ]
    return RoomOut(id=room_reloaded.id, lab_id=room_reloaded.lab_id, name=room_reloaded.name, created_at=room_reloaded.created_at, participants=parts)


@router.post("/{room_id}/join")
async def join_room(
    room_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """POST /rooms/{room_id}/join — join an existing room."""
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # Check if already a participant
    part_result = await db.execute(select(RoomParticipant).where(RoomParticipant.room_id == room_id, RoomParticipant.user_id == user.id))
    if not part_result.scalar_one_or_none():
        participant = RoomParticipant(room_id=room_id, user_id=user.id)
        db.add(participant)
        await db.commit()

    return {"status": "joined", "room_id": room_id}
@router.post("/{room_id}/open")
async def open_room(
    room_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """POST /rooms/{room_id}/open — open a lab for a room."""
    result = await db.execute(select(Room).where(Room.id == room_id).options(selectinload(Room.lab)))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    from app.services import lab_service
    res = await lab_service.open_room_lab(db, room, user, room.lab)
    return res

@router.post("/{room_id}/ping")
async def ping_room(
    room_id: int,
    user: User = Depends(get_current_user),
):
    """POST /rooms/{room_id}/ping — update container TTL."""
    from app.services import lab_service
    if not lab_service.redis_client:
        return {"status": "error", "detail": "Redis not configured"}

    await lab_service.redis_client.setex(f"container_ping_room:{room_id}:1", 90, "1")
    return {"status": "ok"}

@router.post("/{room_id}/stop")
async def stop_room(
    room_id: int,
    user: User = Depends(get_current_user),
):
    """POST /rooms/{room_id}/stop — explicitly stop room container."""
    from app.worker.tasks import stop_container
    stop_container.delay(room_id=room_id, lab_id=1, reason="user_closed_tab")
    return {"status": "stopping"}
