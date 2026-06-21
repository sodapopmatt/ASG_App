from fastapi import APIRouter, Depends, HTTPException, Query
from postgrest.exceptions import APIError
from pydantic import BaseModel
from uuid import UUID
from app.database import supabase
from app.auth import require_admin

router = APIRouter()


class LocationCreate(BaseModel):
    sport_id: UUID
    name: str


class Location(BaseModel):
    id: UUID
    sport_id: UUID
    name: str


@router.get("/", response_model=list[Location])
def list_locations(sport_id: str | None = Query(None)):
    q = supabase.table("locations").select("id, sport_id, name").order("name")
    if sport_id:
        q = q.eq("sport_id", sport_id)
    return q.execute().data


@router.post("/", response_model=Location, status_code=201)
def create_location(body: LocationCreate, _=Depends(require_admin)):
    sport = supabase.table("sports").select("id").eq("id", str(body.sport_id)).limit(1).execute()
    if not sport.data:
        raise HTTPException(status_code=404, detail="Sport not found")
    try:
        return supabase.table("locations").insert(body.model_dump(mode="json")).execute().data[0]
    except APIError as exc:
        if getattr(exc, "code", None) == "23505":  # Postgres unique_violation
            raise HTTPException(status_code=409, detail="A location with that name already exists for this sport")
        raise HTTPException(status_code=502, detail=f"Database error: {getattr(exc, 'message', exc)}")


class LocationUpdate(BaseModel):
    name: str


@router.patch("/{location_id}", response_model=Location)
def update_location(location_id: str, body: LocationUpdate, _=Depends(require_admin)):
    try:
        result = (
            supabase.table("locations")
            .update({"name": body.name})
            .eq("id", location_id)
            .execute()
        )
    except APIError as exc:
        if getattr(exc, "code", None) == "23505":
            raise HTTPException(status_code=409, detail="A location with that name already exists for this sport")
        raise HTTPException(status_code=502, detail=f"Database error: {getattr(exc, 'message', exc)}")
    if not result.data:
        raise HTTPException(status_code=404, detail="Location not found")
    return result.data[0]


@router.delete("/{location_id}", status_code=204)
def delete_location(location_id: str, _=Depends(require_admin)):
    supabase.table("locations").delete().eq("id", location_id).execute()
