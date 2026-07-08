import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.database import supabase
from app.auth import require_admin
from app.routers.event_points import _compute_points

router = APIRouter()

ROUND_2_NAME = "Round 2"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_golf_mode(sport_id: str) -> dict:
    sport = (
        supabase.table("sports")
        .select("scoring_mode,points_scale")
        .eq("id", sport_id)
        .limit(1)
        .execute()
    )
    if not sport.data:
        raise HTTPException(status_code=404, detail="Sport not found")
    if sport.data[0].get("scoring_mode") != "executive_golf":
        raise HTTPException(status_code=422, detail="Sport is not in executive_golf scoring mode")
    return sport.data[0]


class GolfResult(BaseModel):
    hole_scores: list[int] | None = None  # one stroke count per hole; mutually exclusive with forfeit
    forfeit: bool = False


@router.post("/matches/{match_id}/result")
def post_golf_result(match_id: str, body: GolfResult, _=Depends(require_admin)):
    """Record a company's per-hole scores (or a no-show forfeit) for one
    Executive Golf round. Hole scores are stored as a JSON array in
    matches.notes and their sum in matches.home_score. No advancement — golf
    matches are flat (one per team, no opponent), like Human Pyramid."""
    if body.forfeit and body.hole_scores is not None:
        raise HTTPException(status_code=422, detail="Provide either hole_scores or forfeit, not both")
    if not body.forfeit and not body.hole_scores:
        raise HTTPException(status_code=422, detail="Provide hole_scores or set forfeit=true")
    if body.hole_scores is not None and any(s < 0 for s in body.hole_scores):
        raise HTTPException(status_code=422, detail="hole_scores must be non-negative")

    row = supabase.table("matches").select("id, sport_id").eq("id", match_id).limit(1).execute()
    if not row.data:
        raise HTTPException(status_code=404, detail="Match not found")
    _ensure_golf_mode(row.data[0]["sport_id"])

    if body.forfeit:
        update: dict = {
            "status": "forfeit",
            "winner_id": None,
            "notes": None,
            "home_score": None,
            "played_at": _now_iso(),
        }
    else:
        update = {
            "status": "completed",
            "winner_id": None,
            "notes": json.dumps(body.hole_scores),
            "home_score": sum(body.hole_scores),
            "played_at": _now_iso(),
        }

    return supabase.table("matches").update(update).eq("id", match_id).execute().data[0]


def _round_total(m: dict) -> int | None:
    """A completed round's total strokes (home_score, or the sum of the notes
    JSON as a fallback). None if the match hasn't been played. Forfeits are
    handled separately by the ranking (they sort last)."""
    if m.get("status") != "completed":
        return None
    if m.get("home_score") is not None:
        return m["home_score"]
    if m.get("notes"):
        try:
            return sum(json.loads(m["notes"]))
        except (TypeError, ValueError):
            return None
    return None


def _recompute_event_points(sport_id: str, points_scale: dict | None) -> None:
    """Rebuild event_points for an Executive Golf sport. Final ranking is the
    Round-2 total strokes only (lowest wins); the Round-2 companies take
    placements 1..N (ties share averaged points). Every other company that
    competed in Round 1 gets a single shared participation placement after the
    Round-2 group (points_scale default). Companies with no played match at all
    are excluded."""
    brackets = (
        supabase.table("brackets")
        .select("id,name")
        .eq("sport_id", sport_id)
        .execute()
        .data
    )
    round2_bracket_ids = {b["id"] for b in brackets if b.get("name") == ROUND_2_NAME}

    matches = (
        supabase.table("matches")
        .select("home_team_id,bracket_id,home_score,notes,status")
        .eq("sport_id", sport_id)
        .execute()
        .data
    )
    supabase.table("event_points").delete().eq("sport_id", sport_id).execute()

    matches = [m for m in matches if m.get("home_team_id")]
    if not matches:
        return

    team_ids = [m["home_team_id"] for m in matches]
    teams = (
        supabase.table("teams")
        .select("id,company_id")
        .in_("id", team_ids)
        .execute()
        .data
    )
    company_by_team = {t["id"]: t["company_id"] for t in teams}

    # Round-2 finishing score per company: the lowest completed total among its
    # teams; forfeit-only companies get a sentinel so they rank last but still
    # place within the Round-2 group.
    FORFEIT_SENTINEL = float("inf")
    round2_scores: dict[str, float] = {}
    competed: set[str] = set()  # any company with a played match in any round
    for m in matches:
        company_id = company_by_team.get(m["home_team_id"])
        if company_id is None:
            continue
        played = m.get("status") in ("completed", "forfeit", "double_forfeit")
        if played:
            competed.add(company_id)
        if m.get("bracket_id") in round2_bracket_ids:
            total = _round_total(m)
            if total is not None:
                round2_scores[company_id] = min(total, round2_scores.get(company_id, FORFEIT_SENTINEL))
            elif m.get("status") in ("forfeit", "double_forfeit"):
                round2_scores.setdefault(company_id, FORFEIT_SENTINEL)

    if not competed:
        return

    payload = []
    placement = 1
    # Rank the Round-2 group by total strokes ascending; ties share points.
    for score in sorted(set(round2_scores.values())):
        tied = [c for c, s in round2_scores.items() if s == score]
        tied_through = placement + len(tied) - 1
        points = _compute_points(placement, points_scale, tied_through)
        for company_id in tied:
            payload.append({
                "company_id": company_id,
                "sport_id": sport_id,
                "placement": placement,
                "points": points,
            })
        placement = tied_through + 1

    # Everyone else who competed shares one participation placement.
    participants = [c for c in competed if c not in round2_scores]
    if participants:
        points = _compute_points(placement, points_scale)
        for company_id in participants:
            payload.append({
                "company_id": company_id,
                "sport_id": sport_id,
                "placement": placement,
                "points": points,
            })

    if payload:
        supabase.table("event_points").insert(payload).execute()


@router.post("/sports/{sport_id}/recompute", status_code=204)
def recompute_for_sport(sport_id: str, _=Depends(require_admin)):
    sport = _ensure_golf_mode(sport_id)
    _recompute_event_points(sport_id, sport.get("points_scale"))
