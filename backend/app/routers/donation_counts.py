from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from app.database import supabase
from app.auth import require_admin

router = APIRouter()


class DonationCount(BaseModel):
    id: UUID
    company_id: UUID
    sport_id: UUID
    item_count: int
    created_at: datetime
    updated_at: datetime


class DonationCountUpsert(BaseModel):
    company_id: UUID
    sport_id: UUID
    item_count: int = Field(ge=0)


def _bucket_points(counts: list[int]) -> dict[int, int]:
    """Given the distinct sorted-desc item_counts in play, return {item_count: points}.

    Rules:
      - Top distinct count bucket â†’ 15 pts each
      - Second distinct count bucket â†’ 10 pts each
      - Any remaining count â‰¥ 10 â†’ 5 pts each
      - Count < 10 â†’ 0 pts
    """
    distinct = sorted({c for c in counts}, reverse=True)
    mapping: dict[int, int] = {}
    for i, c in enumerate(distinct):
        if i == 0:
            mapping[c] = 15
        elif i == 1:
            mapping[c] = 10
        elif c >= 10:
            mapping[c] = 5
        else:
            mapping[c] = 0
    return mapping


def _recompute_event_points(sport_id: str) -> None:
    """Rebuild event_points rows for a donation-mode sport from donation_counts.

    Stores synthetic placement (1 for top bucket, 2 for second, 3 for everyone else)
    so the existing leaderboard rollup keeps working.
    """
    rows = (
        supabase.table("donation_counts")
        .select("company_id,item_count")
        .eq("sport_id", sport_id)
        .execute()
        .data
    )
    # Only companies with at least one item count toward scoring.
    rows = [r for r in rows if r["item_count"] > 0]

    # Clear existing event_points for this sport, then re-insert from scratch.
    supabase.table("event_points").delete().eq("sport_id", sport_id).execute()

    if not rows:
        return

    point_map = _bucket_points([r["item_count"] for r in rows])
    distinct_desc = sorted(point_map.keys(), reverse=True)
    placement_for_count: dict[int, int] = {}
    for i, c in enumerate(distinct_desc):
        if i == 0:
            placement_for_count[c] = 1
        elif i == 1:
            placement_for_count[c] = 2
        else:
            placement_for_count[c] = 3

    payload = []
    for r in rows:
        points = point_map[r["item_count"]]
        payload.append({
            "company_id": r["company_id"],
            "sport_id": sport_id,
            "placement": placement_for_count[r["item_count"]],
            "points": points,
        })

    if payload:
        supabase.table("event_points").insert(payload).execute()


def _ensure_donation_mode(sport_id: str) -> None:
    sport = (
        supabase.table("sports")
        .select("scoring_mode")
        .eq("id", sport_id)
        .limit(1)
        .execute()
    )
    if not sport.data:
        raise HTTPException(status_code=404, detail="Sport not found")
    if sport.data[0].get("scoring_mode") != "donation_count":
        raise HTTPException(status_code=422, detail="Sport is not in donation_count scoring mode")


@router.get("", response_model=list[DonationCount])
def list_donation_counts(sport_id: str | None = Query(None), company_id: str | None = Query(None)):
    q = supabase.table("donation_counts").select("*")
    if sport_id:
        q = q.eq("sport_id", sport_id)
    if company_id:
        q = q.eq("company_id", company_id)
    return q.order("item_count", desc=True).execute().data


@router.put("/", response_model=DonationCount)
def upsert_donation_count(body: DonationCountUpsert, _=Depends(require_admin)):
    _ensure_donation_mode(str(body.sport_id))
    payload = {
        "company_id": str(body.company_id),
        "sport_id": str(body.sport_id),
        "item_count": body.item_count,
        "updated_at": datetime.utcnow().isoformat(),
    }
    result = (
        supabase.table("donation_counts")
        .upsert(payload, on_conflict="company_id,sport_id")
        .execute()
    )
    _recompute_event_points(str(body.sport_id))
    return result.data[0]


@router.delete("/{donation_id}", status_code=204)
def delete_donation_count(donation_id: str, _=Depends(require_admin)):
    existing = (
        supabase.table("donation_counts")
        .select("sport_id")
        .eq("id", donation_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        return
    sport_id = existing.data[0]["sport_id"]
    supabase.table("donation_counts").delete().eq("id", donation_id).execute()
    _recompute_event_points(sport_id)


@router.post("/sports/{sport_id}/recompute", status_code=204)
def recompute_for_sport(sport_id: str, _=Depends(require_admin)):
    _ensure_donation_mode(sport_id)
    _recompute_event_points(sport_id)
