from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from app.routers import (
    companies,
    sports,
    brackets,
    teams,
    matches,
    event_points,
    leaderboard,
    roster_entries,
)
from app.auth import get_current_profile, UserProfile

app = FastAPI(title="Aerospace Summer Games API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(companies.router,    prefix="/companies",    tags=["companies"])
app.include_router(sports.router,       prefix="/sports",       tags=["sports"])
app.include_router(brackets.router,     prefix="/brackets",     tags=["brackets"])
app.include_router(teams.router,        prefix="/teams",        tags=["teams"])
app.include_router(matches.router,      prefix="/matches",      tags=["matches"])
app.include_router(event_points.router, prefix="/event-points", tags=["event-points"])
app.include_router(leaderboard.router,     prefix="/leaderboard",     tags=["leaderboard"])
app.include_router(roster_entries.router, prefix="/roster-entries", tags=["roster-entries"])


@app.get("/me")
def get_me(profile: UserProfile = Depends(get_current_profile)):
    return {"id": profile.id, "role": profile.role, "company_id": profile.company_id}


@app.get("/health")
def health():
    return {"status": "ok"}
