from fastapi import APIRouter, Depends, HTTPException, Query
from postgrest.exceptions import APIError
from pydantic import BaseModel
from uuid import UUID
from app.database import supabase
from app.auth import require_admin

router = APIRouter()


class LocationCreate(BaseModel):
    sport_id: UUID
    court_number: int | None = None  # For numbered locations (regular sports)
    name: str | None = None           # For free-text locations (donation sports)


class Location(BaseModel):
    id: UUID
    sport_id: UUID
    name: str
    court_number: int | None = None
    pool_index: int | None = None  # manual pool-assignment override; -1 = shared across all pools


class LocationUpdate(BaseModel):
    court_number: int | None = None  # For regular sports â€” re-derives name
    name: str | None = None           # For donation sports free-text
    pool_index: int | None = None     # manual pool-assignment override; -1 = shared across all pools


def _derive_name(label: str, court_number: int) -> str:
    return f"{label} {court_number}"


def _get_sport_label(sport_id: str) -> str:
    result = supabase.table("sports").select("location_label").eq("id", sport_id).limit(1).execute()
    if result.data:
        return result.data[0].get("location_label") or "Court"
    return "Court"


@router.get("", response_model=list[Location])
def list_locations(sport_id: str | None = Query(None)):
    q = supabase.table("locations").select("id, sport_id, name, court_number, pool_index").order("court_number", nullsfirst=False)
    if sport_id:
        q = q.eq("sport_id", sport_id)
    return q.execute().data


@router.post("", response_model=Location, status_code=201)
def create_location(body: LocationCreate, _=Depends(require_admin)):
    sport = supabase.table("sports").select("id").eq("id", str(body.sport_id)).limit(1).execute()
    if not sport.data:
        raise HTTPException(status_code=404, detail="Sport not found")

    if body.court_number is not None:
        label = _get_sport_label(str(body.sport_id))
        name = _derive_name(label, body.court_number)
        payload = {"sport_id": str(body.sport_id), "court_number": body.court_number, "name": name}
    elif body.name is not None:
        payload = {"sport_id": str(body.sport_id), "name": body.name}
    else:
        raise HTTPException(status_code=422, detail="Provide either court_number or name")

    try:
        return supabase.table("locations").insert(payload).execute().data[0]
    except APIError as exc:
        if getattr(exc, "code", None) == "23505":
            raise HTTPException(status_code=409, detail="A location with that court number already exists for this sport")
        raise HTTPException(status_code=502, detail=f"Database error: {getattr(exc, 'message', exc)}")


@router.patch("/{location_id}", response_model=Location)
def update_location(location_id: str, body: LocationUpdate, _=Depends(require_admin)):
    loc = supabase.table("locations").select("id, sport_id, court_number").eq("id", location_id).limit(1).execute()
    if not loc.data:
        raise HTTPException(status_code=404, detail="Location not found")

    updates: dict = {}
    if body.court_number is not None:
        label = _get_sport_label(loc.data[0]["sport_id"])
        updates["court_number"] = body.court_number
        updates["name"] = _derive_name(label, body.court_number)
    elif body.name is not None:
        updates["name"] = body.name

    if body.pool_index is not None:
        updates["pool_index"] = body.pool_index

    if not updates:
        raise HTTPException(status_code=422, detail="Provide either court_number, name, or pool_index")

    try:
        result = (
            supabase.table("locations")
            .update(updates)
            .eq("id", location_id)
            .execute()
        )
    except APIError as exc:
        if getattr(exc, "code", None) == "23505":
            raise HTTPException(status_code=409, detail="A location with that court number already exists for this sport")
        raise HTTPException(status_code=502, detail=f"Database error: {getattr(exc, 'message', exc)}")
    if not result.data:
        raise HTTPException(status_code=404, detail="Location not found")
    return result.data[0]


@router.delete("/{location_id}", status_code=204)
def delete_location(location_id: str, _=Depends(require_admin)):
    supabase.table("locations").delete().eq("id", location_id).execute()
