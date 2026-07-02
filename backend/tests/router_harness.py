"""Drives the real FastAPI endpoint functions against the in-memory fake DB by
patching each router module's `supabase` global. This exercises the exact
production code paths — guards, retraction, advancement, settlement — not a
reimplementation of them."""

from uuid import UUID

import app.routers.matches as matches_router
import app.routers.sports as sports_router
from app.schemas.match import MatchResult, MatchForfeit, MatchDoubleForfeit, MatchDraw
from app.routers.sports import GenerateBracketRequest, DivisionSpec, PoolSpec, HeatSpec


class RouterHarness:
    def __init__(self, db, monkeypatch):
        monkeypatch.setattr(matches_router, "supabase", db)
        monkeypatch.setattr(sports_router, "supabase", db)
        self.db = db

    def result(self, match_id: str, winner_id: str, **kw):
        return matches_router.post_result(match_id, MatchResult(winner_id=UUID(winner_id), **kw))

    def forfeit(self, match_id: str, forfeiting_team_id: str):
        return matches_router.post_forfeit(match_id, MatchForfeit(forfeiting_team_id=UUID(forfeiting_team_id)))

    def double_forfeit(self, match_id: str):
        return matches_router.post_double_forfeit(match_id, MatchDoubleForfeit())

    def draw(self, match_id: str, home_score=None, away_score=None):
        return matches_router.post_draw(match_id, MatchDraw(home_score=home_score, away_score=away_score))

    def generate(self, sport_id: str, **kw):
        return sports_router.generate_bracket(sport_id, GenerateBracketRequest(**kw))

    def standings(self, sport_id: str):
        return sports_router.get_standings(sport_id)


__all__ = ["RouterHarness", "DivisionSpec", "PoolSpec", "HeatSpec"]
