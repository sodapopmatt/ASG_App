from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class RosterEntryCreate(BaseModel):
    team_id: UUID
    player_name: str


class RosterEntry(BaseModel):
    id: UUID
    team_id: UUID
    player_name: str
    created_at: datetime
