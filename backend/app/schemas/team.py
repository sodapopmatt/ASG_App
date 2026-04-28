from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class TeamCreate(BaseModel):
    company_id: UUID
    sport_id: UUID
    name: str | None = None  # e.g. "Dodgeball Team B"


class TeamUpdate(BaseModel):
    name: str | None = None


class Team(TeamCreate):
    id: UUID
    created_at: datetime
