from dataclasses import dataclass, field


@dataclass
class MatchSlot:
    """A single match slot produced by a bracket generator.
    winner_next_idx / loser_next_idx are indices into the flat all_matches list
    returned by the generator — resolved to DB IDs during persistence."""
    home_team_id: str | None
    away_team_id: str | None
    match_round: int
    bracket_phase: str          # "bracket" | "winners" | "losers" | "finals"
    is_bye: bool = False
    winner_next_idx: int | None = None
    loser_next_idx: int | None = None
    db_id: str | None = field(default=None, repr=False)
