from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import supabase
from app.auth import require_admin
from app.schemas.event_points import EventPoints

router = APIRouter()


def _compute_points(placement: int, points_scale: dict | None) -> int:
    """ASG scale: 1st=40, 2nd=38, … (–2 per place, floor 0).
    If the sport defines a points_scale override, use that instead."""
    if points_scale:
        return int(points_scale.get(str(placement), points_scale.get("default", 0)))
    return max(0, 40 - (placement - 1) * 2)


@router.get("/", response_model=list[EventPoints])
def list_event_points(
    company_id: str | None = Query(None),
    sport_id: str | None = Query(None),
):
    q = supabase.table("event_points").select("*")
    if company_id:
        q = q.eq("company_id", company_id)
    if sport_id:
        q = q.eq("sport_id", sport_id)
    return q.order("points", desc=True).execute().data


@router.post("/award-placement", response_model=EventPoints)
def award_placement(
    company_id: str,
    sport_id: str,
    placement: int,
    _=Depends(require_admin),
):
    """Compute and record points for a final placement.
    Uses the sport's points_scale if set, otherwise falls back to the ASG scale."""
    sport = supabase.table("sports").select("points_scale").eq("id", sport_id).limit(1).execute()
    if not sport.data:
        raise HTTPException(status_code=404, detail="Sport not found")

    points = _compute_points(placement, sport.data[0].get("points_scale"))
    payload = {"company_id": company_id, "sport_id": sport_id, "placement": placement, "points": points}
    return (
        supabase.table("event_points")
        .upsert(payload, on_conflict="company_id,sport_id")
        .execute()
        .data[0]
    )
