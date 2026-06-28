from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
from typing import Literal, Optional

BracketType = Literal[
    "double_elimination",
    "single_elimination",
    "pool_bracket",
    "pool_swiss",
    "heats",
    "points_based",
]

ScoringDirection = Literal["high_wins", "low_wins"]
MultiTeamRule = Literal["best_placement", "average_score"]
ScoringMode = Literal["placement", "donation_count"]


class SportCreate(BaseModel):
    name: str
    bracket_type: BracketType
    teams_per_company: int = 1
    scoring_direction: ScoringDirection = "high_wins"
    multi_team_rule: MultiTeamRule = "best_placement"
    points_scale: dict | None = None  # None = use ASG scale; e.g. {"1": 15, "2": 10, "default": 5}
    scoring_mode: ScoringMode = "placement"
    match_duration_minutes: Optional[int] = None
    schedule_start: Optional[datetime] = None
    schedule_end: Optional[datetime] = None
    location_label: str = "Court"


class SportUpdate(BaseModel):
    name: str | None = None
    bracket_type: BracketType | None = None
    teams_per_company: int | None = None
    scoring_direction: ScoringDirection | None = None
    multi_team_rule: MultiTeamRule | None = None
    points_scale: dict | None = None
    scoring_mode: ScoringMode | None = None
    match_duration_minutes: Optional[int] = None
    schedule_start: Optional[datetime] = None
    schedule_end: Optional[datetime] = None
    location_label: str | None = None


class Sport(SportCreate):
    id: UUID
    created_at: datetime
