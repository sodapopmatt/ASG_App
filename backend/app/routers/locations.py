from fastapi import APIRouter, Depends, HTTPException, Query
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
    except Exception:
        raise HTTPException(status_code=409, detail="A location with that name already exists for this sport")


@router.delete("/{location_id}", status_code=204)
def delete_location(location_id: str, _=Depends(require_admin)):
    supabase.table("locations").delete().eq("id", location_id).execute()
