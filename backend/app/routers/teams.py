from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import supabase
from app.auth import require_admin
from app.schemas.team import Team, TeamCreate, TeamUpdate

router = APIRouter()


@router.get("/", response_model=list[Team])
def list_teams(
    company_id: str | None = Query(None),
    sport_id: str | None = Query(None),
):
    q = supabase.table("teams").select("*")
    if company_id:
        q = q.eq("company_id", company_id)
    if sport_id:
        q = q.eq("sport_id", sport_id)
    return q.order("name").execute().data


@router.get("/{team_id}", response_model=Team)
def get_team(team_id: str):
    response = supabase.table("teams").select("*").eq("id", team_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Team not found")
    return response.data[0]


@router.post("/", response_model=Team, status_code=201)
def create_team(body: TeamCreate, _=Depends(require_admin)):
    return supabase.table("teams").insert(body.model_dump(mode="json")).execute().data[0]


@router.patch("/{team_id}", response_model=Team)
def update_team(team_id: str, body: TeamUpdate, _=Depends(require_admin)):
    return supabase.table("teams").update(body.model_dump(exclude_none=True)).eq("id", team_id).execute().data[0]


@router.delete("/{team_id}", status_code=204)
def delete_team(team_id: str, _=Depends(require_admin)):
    supabase.table("teams").delete().eq("id", team_id).execute()

