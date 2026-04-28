from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class EventPointsCreate(BaseModel):
    company_id: UUID
    sport_id: UUID
    placement: int | None = None
    points: int
    notes: str | None = None


class EventPointsUpdate(BaseModel):
    placement: int | None = None
    points: int | None = None
    notes: str | None = None


class EventPoints(EventPointsCreate):
    id: UUID
    created_at: datetime
