from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.database import supabase
from app.auth import require_admin
from app.schemas.sport import Sport, SportCreate, SportUpdate
from app.bracket_engine import persist_bracket, clear_brackets

router = APIRouter()


class GenerateBracketRequest(BaseModel):
    team_ids: list[str]         # ordered by seed — index 0 is the top seed
    clear_existing: bool = False
    location_ids: list[str] = []  # court UUIDs to cycle round-robin; omit to skip assignment


@router.get("/", response_model=list[Sport])
def list_sports():
    return supabase.table("sports").select("*").order("name").execute().data


@router.get("/{sport_id}", response_model=Sport)
def get_sport(sport_id: str):
    response = supabase.table("sports").select("*").eq("id", sport_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Sport not found")
    return response.data[0]


@router.post("/", response_model=Sport, status_code=201)
def create_sport(body: SportCreate, _=Depends(require_admin)):
    return supabase.table("sports").insert(body.model_dump()).execute().data[0]


@router.patch("/{sport_id}", response_model=Sport)
def update_sport(sport_id: str, body: SportUpdate, _=Depends(require_admin)):
    return supabase.table("sports").update(body.model_dump(exclude_none=True)).eq("id", sport_id).execute().data[0]


@router.delete("/{sport_id}", status_code=204)
def delete_sport(sport_id: str, _=Depends(require_admin)):
    supabase.table("sports").delete().eq("id", sport_id).execute()


@router.delete("/{sport_id}/brackets", status_code=204)
def reset_brackets(sport_id: str, _=Depends(require_admin)):
    """Delete all brackets and matches for a sport without regenerating."""
    sport = supabase.table("sports").select("id").eq("id", sport_id).limit(1).execute()
    if not sport.data:
        raise HTTPException(status_code=404, detail="Sport not found")
    clear_brackets(sport_id, supabase)


@router.post("/{sport_id}/generate-bracket")
def generate_bracket(sport_id: str, body: GenerateBracketRequest, _=Depends(require_admin)):
    """Generate brackets and matches for a sport from a seeded list of team IDs.

    Supports: single_elimination, double_elimination.
    Other bracket types (pool_bracket, pool_swiss, heats, points_based) require
    manual bracket/match entry and return a 422.
    """
    if len(body.team_ids) < 2:
        raise HTTPException(status_code=422, detail="At least 2 teams are required")

    # Verify all teams belong to this sport
    teams = supabase.table("teams").select("id").eq("sport_id", sport_id).execute()
    valid_ids = {t["id"] for t in teams.data}
    invalid = [tid for tid in body.team_ids if tid not in valid_ids]
    if invalid:
        raise HTTPException(status_code=422, detail=f"Teams not found in this sport: {invalid}")

    try:
        result = persist_bracket(
            sport_id=sport_id,
            team_ids=body.team_ids,
            db=supabase,
            clear_existing=body.clear_existing,
            location_ids=body.location_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return result
