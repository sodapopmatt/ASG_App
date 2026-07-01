from dataclasses import dataclass
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.database import supabase

security = HTTPBearer()


@dataclass
class UserProfile:
    id: str
    role: str
    company_id: str | None


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        response = supabase.auth.get_user(credentials.credentials)
        return response.user
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")


def get_current_profile(user=Depends(get_current_user)) -> UserProfile:
    try:
        response = supabase.table("user_profiles").select("role, company_id").eq("id", str(user.id)).limit(1).execute()
    except Exception:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not verify user profile, please retry")
    if not response.data:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No profile found for this user")
    row = response.data[0]
    return UserProfile(id=str(user.id), role=row["role"], company_id=row.get("company_id"))


def require_admin(profile: UserProfile = Depends(get_current_profile)) -> UserProfile:
    if profile.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return profile


def require_team_manager(profile: UserProfile = Depends(get_current_profile)) -> UserProfile:
    """Team manager or admin. Routes that are company-scoped must also verify profile.company_id."""
    if profile.role not in ("admin", "team_manager"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Team manager role required")
    return profile
