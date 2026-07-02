from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import supabase
from app.auth import require_admin
from app.schemas.team import Team, TeamCreate, TeamUpdate

router = APIRouter()


@router.get("", response_model=list[Team])
def list_teams(
    company_id: str | None = Query(None),
    sport_id: str | None = Query(None),
):
    results = []
    page_size = 1000
    page = 0
    while True:
        q = supabase.table("teams").select("*")
        if company_id:
            q = q.eq("company_id", company_id)
        if sport_id:
            q = q.eq("sport_id", sport_id)
        batch = q.order("name").range(page * page_size, (page + 1) * page_size - 1).execute().data
        results.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
    return results


@router.get("/{team_id}", response_model=Team)
def get_team(team_id: str):
    response = supabase.table("teams").select("*").eq("id", team_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Team not found")
    return response.data[0]


@router.post("", response_model=Team, status_code=201)
def create_team(body: TeamCreate, _=Depends(require_admin)):
    # Check for duplicate team name within the same company and sport
    existing = supabase.table("teams").select("id").eq("company_id", str(body.company_id)).eq("sport_id", str(body.sport_id)).eq("name", body.name).execute()
    if existing.data:
        raise HTTPException(status_code=422, detail=f"A team named '{body.name}' already exists for this company and sport")

    return supabase.table("teams").insert(body.model_dump(mode="json")).execute().data[0]


@router.patch("/{team_id}", response_model=Team)
def update_team(team_id: str, body: TeamUpdate, _=Depends(require_admin)):
    if body.name is not None:
        current = supabase.table("teams").select("company_id, sport_id").eq("id", team_id).limit(1).execute()
        if not current.data:
            raise HTTPException(status_code=404, detail="Team not found")
        row = current.data[0]
        existing = (
            supabase.table("teams").select("id")
            .eq("company_id", row["company_id"]).eq("sport_id", row["sport_id"]).eq("name", body.name)
            .neq("id", team_id)
            .execute()
        )
        if existing.data:
            raise HTTPException(status_code=422, detail=f"A team named '{body.name}' already exists for this company and sport")

    return supabase.table("teams").update(body.model_dump(exclude_none=True)).eq("id", team_id).execute().data[0]



@router.delete("/{team_id}", status_code=204)
def delete_team(team_id: str, _=Depends(require_admin)):
    supabase.table("teams").delete().eq("id", team_id).execute()

