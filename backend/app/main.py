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
    golf_results,
    schedule_blocks,
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

# ── Edge-cache control ────────────────────────────────────────────────────────
# Every public viewer requests the SAME read-only data (schedule, brackets,
# leaderboard, …), so we let a CDN serve those from the edge instead of every
# request hitting this single origin. These Cache-Control headers are what the
# CDN obeys. The design is safe-by-default:
#   - Only the explicit allowlist below is ever cacheable.
#   - Any request carrying an Authorization header (i.e. a logged-in admin) is
#     always `no-store`, so admins see their own writes immediately and the CDN
#     is configured to bypass cache for them too.
#   - Writes, errors, and everything not on the allowlist are `no-store`.
# Anonymous viewers never send an Authorization header (see frontend
# apiFetch), so public GETs collapse to one shared cached copy per interval.
_PUBLIC_CACHE_RULES: list[tuple[str, int]] = [
    # (path prefix, max-age seconds)
    ("/matches", 10),
    ("/brackets", 15),
    ("/sports", 20),
    ("/companies", 60),
    ("/teams", 30),
    ("/locations", 60),
    ("/leaderboard", 15),
    ("/event-points", 15),
    ("/donation-counts", 15),
    ("/schedule-blocks", 30),
]


def _public_cache_maxage(path: str) -> int | None:
    """Max-age for a public GET path, or None if it must not be edge-cached."""
    normalized = path.rstrip("/")
    # /alerts is admin-only EXCEPT /alerts/active (the public banner feed).
    if normalized == "/alerts/active":
        return 20
    if normalized == "/alerts" or normalized.startswith("/alerts/"):
        return None
    for prefix, ttl in _PUBLIC_CACHE_RULES:
        if normalized == prefix or normalized.startswith(prefix + "/"):
            return ttl
    return None


@app.middleware("http")
async def cache_control_middleware(request: Request, call_next):
    response = await call_next(request)
    # Never cache writes, non-success responses, or authenticated (admin)
    # requests — those must always reflect the live origin state.
    if (
        request.method != "GET"
        or response.status_code >= 300
        or request.headers.get("authorization")
    ):
        response.headers["Cache-Control"] = "no-store"
        return response
    maxage = _public_cache_maxage(request.url.path)
    if maxage is None:
        response.headers["Cache-Control"] = "no-store"
    else:
        # stale-while-revalidate lets the edge serve a slightly-stale copy while
        # it refreshes in the background, smoothing traffic spikes.
        response.headers["Cache-Control"] = (
            f"public, max-age={maxage}, stale-while-revalidate={maxage}"
        )
    return response


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
app.include_router(golf_results.router,     prefix="/golf-results",     tags=["golf-results"])
app.include_router(schedule_blocks.router,  prefix="/schedule-blocks",  tags=["schedule-blocks"])


@app.get("/me")
def get_me(profile: UserProfile = Depends(get_current_profile)):
    return {"id": profile.id, "role": profile.role, "company_id": profile.company_id}


@app.get("/health")
def health():
    return {"status": "ok"}
