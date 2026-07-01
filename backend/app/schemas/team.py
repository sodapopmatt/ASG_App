from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class TeamCreate(BaseModel):
    company_id: UUID
    sport_id: UUID
    name: str | None = None  # e.g. "Dodgeball Team B"


class TeamUpdate(BaseModel):
    name: str | None = None
    seed: int | None = None        # bracket seed rank, 0 = top seed
    pool_index: int | None = None  # manual pool-assignment override; -2 = unassigned


class Team(TeamCreate):
    id: UUID
    created_at: datetime
    seed: int | None = None
    pool_index: int | None = None
