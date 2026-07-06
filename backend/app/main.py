from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.routers import (
    companies,
    sports,
    brackets,
    teams,
    matches,
    event_points,
    leaderboard,
    roster_entries,
    locations,
    alerts,
    donation_counts,
    waterball_results,
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

@app.exception_handler(Exception)
def unhandled_exception_handler(request: Request, exc: Exception):
    # Registering this handler keeps the response inside CORSMiddleware's scope,
    # so the browser sees a real 500 + message instead of an opaque CORS/network failure.
    return JSONResponse(status_code=500, content={"detail": f"Internal server error: {exc}"})


app.include_router(companies.router,    prefix="/companies",    tags=["companies"])
app.include_router(sports.router,       prefix="/sports",       tags=["sports"])
app.include_router(brackets.router,     prefix="/brackets",     tags=["brackets"])
app.include_router(teams.router,        prefix="/teams",        tags=["teams"])
app.include_router(matches.router,      prefix="/matches",      tags=["matches"])
app.include_router(event_points.router, prefix="/event-points", tags=["event-points"])
app.include_router(leaderboard.router,     prefix="/leaderboard",     tags=["leaderboard"])
app.include_router(roster_entries.router, prefix="/roster-entries", tags=["roster-entries"])
app.include_router(locations.router,      prefix="/locations",      tags=["locations"])
app.include_router(alerts.router,         prefix="/alerts",         tags=["alerts"])
app.include_router(donation_counts.router, prefix="/donation-counts", tags=["donation-counts"])
app.include_router(waterball_results.router, prefix="/waterball-results", tags=["waterball-results"])


@app.get("/me")
def get_me(profile: UserProfile = Depends(get_current_profile)):
    return {"id": profile.id, "role": profile.role, "company_id": profile.company_id}


@app.get("/health")
def health():
    return {"status": "ok"}
