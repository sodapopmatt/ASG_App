import logging
import time
from dataclasses import dataclass
from threading import Lock

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

from app.config import settings
from app.database import supabase, db_call

logger = logging.getLogger(__name__)

security = HTTPBearer()

PROFILE_CACHE_TTL_SECONDS = 60
_profile_cache: dict[str, tuple[float, "UserProfile"]] = {}
_profile_cache_lock = Lock()

# Token → user_id cache. When Supabase projects migrate to asymmetric JWT
# signing (ES256/RS256), our legacy HS256 decode fails; we fall back to
# supabase.auth.get_user (a network call) and cache the result to keep that
# path cheap under load. TTL well under Supabase's 1h access-token lifetime.
TOKEN_CACHE_TTL_SECONDS = 300
_token_cache: dict[str, tuple[float, str]] = {}
_token_cache_lock = Lock()


@dataclass
class UserProfile:
    id: str
    role: str
    company_id: str | None


@dataclass
class AuthUser:
    id: str


def _verify_via_supabase(token: str) -> str:
    """Fallback: ask Supabase to verify. Cached to avoid rate-limit storms."""
    now = time.monotonic()
    with _token_cache_lock:
        cached = _token_cache.get(token)
        if cached and cached[0] > now:
            return cached[1]

    try:
        response = supabase.auth.get_user(token)
    except Exception as exc:
        logger.warning("supabase.auth.get_user failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    if not response or not response.user or not response.user.id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user_id = str(response.user.id)
    with _token_cache_lock:
        _token_cache[token] = (now + TOKEN_CACHE_TTL_SECONDS, user_id)
    return user_id


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> AuthUser:
    token = credentials.credentials

    # Fast path: local HS256 decode (works for legacy Supabase JWT secret).
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
        user_id = payload.get("sub")
        if user_id:
            return AuthUser(id=user_id)
        logger.warning("JWT missing sub claim; keys=%s", list(payload.keys()))
    except JWTError as exc:
        logger.info("Local JWT decode failed, falling back to Supabase: %s", exc)

    # Fallback: verify via Supabase Auth (handles new asymmetric-key projects).
    user_id = _verify_via_supabase(token)
    return AuthUser(id=user_id)


def get_current_profile(user: AuthUser = Depends(get_current_user)) -> UserProfile:
    now = time.monotonic()
    with _profile_cache_lock:
        cached = _profile_cache.get(user.id)
        if cached and cached[0] > now:
            return cached[1]

    try:
        response = db_call(
            lambda: supabase.table("user_profiles").select("role, company_id").eq("id", user.id).limit(1).execute()
        )
    except Exception:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not verify user profile, please retry")
    if not response.data:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No profile found for this user")
    row = response.data[0]
    profile = UserProfile(id=user.id, role=row["role"], company_id=row.get("company_id"))

    with _profile_cache_lock:
        _profile_cache[user.id] = (now + PROFILE_CACHE_TTL_SECONDS, profile)

    return profile


def require_admin(profile: UserProfile = Depends(get_current_profile)) -> UserProfile:
    if profile.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return profile


def require_team_manager(profile: UserProfile = Depends(get_current_profile)) -> UserProfile:
    """Team manager or admin. Routes that are company-scoped must also verify profile.company_id."""
    if profile.role not in ("admin", "team_manager"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Team manager role required")
    return profile
