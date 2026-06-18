from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
from typing import Literal

MatchStatus = Literal["scheduled", "in_progress", "completed", "forfeit", "double_forfeit"]


class MatchCreate(BaseModel):
    sport_id: UUID
    bracket_id: UUID | None = None
    home_team_id: UUID | None = None
    away_team_id: UUID | None = None
    location_id: UUID | None = None
    scheduled_at: datetime | None = None
    match_round: int | None = None


class MatchResult(BaseModel):
    winner_id: UUID
    home_score: int | None = None
    away_score: int | None = None
    played_at: datetime | None = None
    notes: str | None = None


class MatchForfeit(BaseModel):
    forfeiting_team_id: UUID
    notes: str | None = None


class MatchDoubleForfeit(BaseModel):
    notes: str | None = None


class HeatResult(BaseModel):
    time_ms: int | None = None  # total milliseconds; mutually exclusive with forfeit
    forfeit: bool = False


class MatchUpdate(BaseModel):
    scheduled_at: datetime | None = None
    location_id: UUID | None = None


class LocationBrief(BaseModel):
    name: str


class Match(BaseModel):
    id: UUID
    sport_id: UUID
    bracket_id: UUID | None
    home_team_id: UUID | None
    away_team_id: UUID | None
    location_id: UUID | None
    locations: LocationBrief | None = None
    winner_id: UUID | None
    home_score: int | None = None
    away_score: int | None = None
    status: MatchStatus
    match_round: int | None
    winner_next_match_id: UUID | None
    loser_next_match_id: UUID | None
    home_slot_state: str = "tbd"
    away_slot_state: str = "tbd"
    scheduled_at: datetime | None
    actual_start: datetime | None = None
    played_at: datetime | None
    notes: str | None
    created_at: datetime
    estimated_start: datetime | None = None
