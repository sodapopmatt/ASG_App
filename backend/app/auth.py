import logging
import time
from dataclasses import dataclass
from threading import Lock

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

from app.config import settings
from app.database import supabase

logger = logging.getLogger(__name__)

security = HTTPBearer()

PROFILE_CACHE_TTL_SECONDS = 60
_profile_cache: dict[str, tuple[float, "UserProfile"]] = {}
_profile_cache_lock = Lock()


@dataclass
class UserProfile:
    id: str
    role: str
    company_id: str | None


@dataclass
class AuthUser:
    id: str


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> AuthUser:
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
    except JWTError as exc:
        logger.warning("JWT decode failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user_id = payload.get("sub")
    if not user_id:
        logger.warning("JWT missing sub claim; keys=%s", list(payload.keys()))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    return AuthUser(id=user_id)


def get_current_profile(user: AuthUser = Depends(get_current_user)) -> UserProfile:
    now = time.monotonic()
    with _profile_cache_lock:
        cached = _profile_cache.get(user.id)
        if cached and cached[0] > now:
            return cached[1]

    try:
        response = supabase.table("user_profiles").select("role, company_id").eq("id", user.id).limit(1).execute()
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
