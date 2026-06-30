from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import supabase
from app.auth import require_admin
from app.schemas.bracket import Bracket, BracketCreate, BracketUpdate

router = APIRouter()


@router.get("", response_model=list[Bracket])
def list_brackets(sport_id: str | None = Query(None)):
    q = supabase.table("brackets").select("*")
    if sport_id:
        q = q.eq("sport_id", sport_id)
    return q.order("phase").execute().data


@router.get("/{bracket_id}", response_model=Bracket)
def get_bracket(bracket_id: str):
    response = supabase.table("brackets").select("*").eq("id", bracket_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Bracket not found")
    return response.data[0]


@router.post("", response_model=Bracket, status_code=201)
def create_bracket(body: BracketCreate, _=Depends(require_admin)):
    return supabase.table("brackets").insert(body.model_dump(mode="json")).execute().data[0]


@router.patch("/{bracket_id}", response_model=Bracket)
def update_bracket(bracket_id: str, body: BracketUpdate, _=Depends(require_admin)):
    return supabase.table("brackets").update(body.model_dump(exclude_none=True)).eq("id", bracket_id).execute().data[0]


@router.delete("/{bracket_id}", status_code=204)
def delete_bracket(bracket_id: str, _=Depends(require_admin)):
    supabase.table("brackets").delete().eq("id", bracket_id).execute()
