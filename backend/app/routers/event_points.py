from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import supabase
from app.auth import require_admin
from app.schemas.event_points import EventPoints

router = APIRouter()


def _scale_points(placement: int, points_scale: dict | None) -> int:
    """ASG scale: 1st=40, 2nd=38, … (–2 per place, floor 0).
    If the sport defines a points_scale override, use that instead."""
    if points_scale:
        return int(points_scale.get(str(placement), points_scale.get("default", 0)))
    return max(0, 40 - (placement - 1) * 2)


def _compute_points(placement: int, points_scale: dict | None, tied_through: int | None = None) -> int:
    """Points for a placement. When tied_through is set, the placement is shared:
    e.g. two companies tied for 3rd (placement=3, tied_through=4) each receive the
    average of the 3rd- and 4th-place values."""
    if tied_through is None or tied_through <= placement:
        return _scale_points(placement, points_scale)
    values = [_scale_points(p, points_scale) for p in range(placement, tied_through + 1)]
    return round(sum(values) / len(values))


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
    tied_through: int | None = Query(None, description="Last place sharing this placement; points are averaged over the range"),
    _=Depends(require_admin),
):
    """Compute and record points for a final placement.
    Uses the sport's points_scale if set, otherwise falls back to the ASG scale.
    For shared placements (e.g. two companies tied for 3rd), pass tied_through=4
    to award each the average of the 3rd- and 4th-place values."""
    if tied_through is not None and tied_through < placement:
        raise HTTPException(status_code=422, detail="tied_through must be greater than or equal to placement")

    sport = supabase.table("sports").select("points_scale").eq("id", sport_id).limit(1).execute()
    if not sport.data:
        raise HTTPException(status_code=404, detail="Sport not found")

    points = _compute_points(placement, sport.data[0].get("points_scale"), tied_through)
    payload = {"company_id": company_id, "sport_id": sport_id, "placement": placement, "points": points}
    return (
        supabase.table("event_points")
        .upsert(payload, on_conflict="company_id,sport_id")
        .execute()
        .data[0]
    )
