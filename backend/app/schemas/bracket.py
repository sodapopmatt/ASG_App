from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class BracketCreate(BaseModel):
    sport_id: UUID
    name: str
    phase: str | None = None  # pool | bracket | heats | finals
    division: str | None = None  # e.g. "Main Gym" when a sport is split across venues


class BracketUpdate(BaseModel):
    name: str | None = None
    phase: str | None = None


class Bracket(BracketCreate):
    id: UUID
    created_at: datetime
