from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import supabase
from app.auth import require_admin
from app.schemas.match import Match, MatchCreate, MatchResult, MatchForfeit, MatchDoubleForfeit
from app.bracket_engine.generator import advance_winner, settle_bracket, retract_winner

router = APIRouter()


@router.get("/", response_model=list[Match])
def list_matches(
    sport_id: str | None = Query(None),
    bracket_id: str | None = Query(None),
    status: str | None = Query(None),
):
    q = supabase.table("matches").select("*, locations(name)")
    if sport_id:
        q = q.eq("sport_id", sport_id)
    if bracket_id:
        q = q.eq("bracket_id", bracket_id)
    if status:
        q = q.eq("status", status)
    return q.order("match_round").order("scheduled_at").execute().data


@router.get("/{match_id}", response_model=Match)
def get_match(match_id: str):
    response = supabase.table("matches").select("*, locations(name)").eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")
    return response.data[0]


@router.post("/", response_model=Match, status_code=201)
def create_match(body: MatchCreate, _=Depends(require_admin)):
    return supabase.table("matches").insert(body.model_dump(mode="json")).execute().data[0]


@router.post("/{match_id}/start", response_model=Match)
def start_match(match_id: str, _=Depends(require_admin)):
    response = supabase.table("matches").select("id, status").eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")
    if response.data[0]["status"] != "scheduled":
        raise HTTPException(status_code=422, detail="Only scheduled matches can be started")
    return supabase.table("matches").update({"status": "in_progress"}).eq("id", match_id).execute().data[0]


@router.post("/{match_id}/result", response_model=Match)
def post_result(match_id: str, result: MatchResult, _=Depends(require_admin)):
    response = supabase.table("matches").select(
        "sport_id, home_team_id, away_team_id, winner_id, winner_next_match_id"
    ).eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")

    match = response.data[0]
    winner_id = str(result.winner_id)

    if winner_id not in (match["home_team_id"], match["away_team_id"]):
        raise HTTPException(status_code=422, detail="winner_id must be home_team_id or away_team_id")

    # If result is being changed, retract the previous advancement first.
    if match["winner_id"]:
        # Guard: if the downstream match already has its own result, refuse the change.
        if match.get("winner_next_match_id"):
            downstream = supabase.table("matches").select("status").eq(
                "id", match["winner_next_match_id"]
            ).limit(1).execute()
            if downstream.data and downstream.data[0]["status"] not in ("scheduled", "in_progress"):
                raise HTTPException(
                    status_code=409,
                    detail="Cannot change result: the advanced team has already played further in the bracket.",
                )
        prev_winner = match["winner_id"]
        prev_loser = match["away_team_id"] if prev_winner == match["home_team_id"] else match["home_team_id"]
        retract_winner(match_id, prev_winner, prev_loser, supabase)

    update: dict = {"winner_id": winner_id, "status": "completed"}
    if result.played_at:
        update["played_at"] = result.played_at.isoformat()
    if result.notes:
        update["notes"] = result.notes

    updated = supabase.table("matches").update(update).eq("id", match_id).execute().data[0]

    loser_id = match["away_team_id"] if winner_id == match["home_team_id"] else match["home_team_id"]
    advance_winner(match_id, winner_id, loser_id, supabase)
    settle_bracket(match["sport_id"], supabase)

    return updated


@router.post("/{match_id}/forfeit", response_model=Match)
def post_forfeit(match_id: str, body: MatchForfeit, _=Depends(require_admin)):
    response = supabase.table("matches").select(
        "sport_id, home_team_id, away_team_id, winner_id, winner_next_match_id"
    ).eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")

    match = response.data[0]
    forfeiting_id = str(body.forfeiting_team_id)

    if forfeiting_id not in (match["home_team_id"], match["away_team_id"]):
        raise HTTPException(status_code=422, detail="forfeiting_team_id must be home_team_id or away_team_id")

    winner_id = match["away_team_id"] if forfeiting_id == match["home_team_id"] else match["home_team_id"]

    if match["winner_id"]:
        if match.get("winner_next_match_id"):
            downstream = supabase.table("matches").select("status").eq(
                "id", match["winner_next_match_id"]
            ).limit(1).execute()
            if downstream.data and downstream.data[0]["status"] not in ("scheduled", "in_progress"):
                raise HTTPException(
                    status_code=409,
                    detail="Cannot change result: the advanced team has already played further in the bracket.",
                )
        prev_winner = match["winner_id"]
        prev_loser = match["away_team_id"] if prev_winner == match["home_team_id"] else match["home_team_id"]
        retract_winner(match_id, prev_winner, prev_loser, supabase)

    update: dict = {"winner_id": winner_id, "status": "forfeit"}
    if body.notes:
        update["notes"] = body.notes

    updated = supabase.table("matches").update(update).eq("id", match_id).execute().data[0]

    advance_winner(match_id, winner_id, forfeiting_id, supabase)
    settle_bracket(match["sport_id"], supabase)

    return updated


@router.post("/{match_id}/double-forfeit", response_model=Match)
def post_double_forfeit(match_id: str, body: MatchDoubleForfeit | None = None, _=Depends(require_admin)):
    response = supabase.table("matches").select(
        "id, sport_id, status"
    ).eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")

    match = response.data[0]
    if match["status"] not in ("scheduled", "in_progress"):
        raise HTTPException(status_code=422, detail="Match is already resolved")

    update: dict = {"status": "double_forfeit", "winner_id": None}
    if body and body.notes:
        update["notes"] = body.notes

    updated = supabase.table("matches").update(update).eq("id", match_id).execute().data[0]
    settle_bracket(match["sport_id"], supabase)
    return updated


@router.delete("/{match_id}", status_code=204)
def delete_match(match_id: str, _=Depends(require_admin)):
    supabase.table("matches").delete().eq("id", match_id).execute()
