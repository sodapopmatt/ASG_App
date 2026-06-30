from fastapi import APIRouter, Depends, HTTPException
from app.database import supabase
from app.auth import UserProfile, require_team_manager
from app.schemas.roster_entry import RosterEntry, RosterEntryCreate

router = APIRouter()


def _assert_team_access(team_id: str, profile: UserProfile):
    if profile.role == "team_manager":
        team = supabase.table("teams").select("company_id").eq("id", team_id).limit(1).execute()
        if not team.data or team.data[0]["company_id"] != profile.company_id:
            raise HTTPException(status_code=403, detail="Not authorized for this team")


@router.get("", response_model=list[RosterEntry])
def list_roster_entries(team_id: str):
    return (
        supabase.table("roster_entries")
        .select("*")
        .eq("team_id", team_id)
        .order("created_at")
        .execute()
        .data
    )


@router.post("", response_model=RosterEntry, status_code=201)
def add_roster_entry(body: RosterEntryCreate, profile: UserProfile = Depends(require_team_manager)):
    _assert_team_access(str(body.team_id), profile)
    return (
        supabase.table("roster_entries")
        .insert(body.model_dump(mode="json"))
        .execute()
        .data[0]
    )


@router.delete("/{entry_id}", status_code=204)
def remove_roster_entry(entry_id: str, profile: UserProfile = Depends(require_team_manager)):
    existing = supabase.table("roster_entries").select("team_id").eq("id", entry_id).limit(1).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Roster entry not found")
    _assert_team_access(existing.data[0]["team_id"], profile)
    supabase.table("roster_entries").delete().eq("id", entry_id).execute()
