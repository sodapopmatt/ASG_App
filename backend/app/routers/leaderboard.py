from fastapi import APIRouter
from app.database import supabase

router = APIRouter()


@router.get("/")
def get_leaderboard():
    return supabase.rpc("get_leaderboard").execute().data
