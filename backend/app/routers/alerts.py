from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Literal
from uuid import UUID
from app.database import supabase
from app.auth import require_admin, UserProfile

router = APIRouter()

Severity = Literal["info", "warning", "critical"]


class AlertCreate(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    severity: Severity = "info"
    expires_at: datetime | None = None


class AlertUpdate(BaseModel):
    message: str | None = Field(default=None, min_length=1, max_length=500)
    severity: Severity | None = None
    active: bool | None = None
    expires_at: datetime | None = None


class Alert(BaseModel):
    id: UUID
    message: str
    severity: Severity
    active: bool
    expires_at: datetime | None = None
    created_by: UUID | None = None
    created_at: datetime


@router.get("/log", response_model=list[Alert])
def list_alert_log():
    """Public alert history — all alerts ordered newest first. Used by the notifications log page."""
    return (
        supabase.table("alerts")
        .select("*")
        .order("created_at", desc=True)
        .limit(100)
        .execute()
        .data
    )


@router.get("/active", response_model=list[Alert])
def list_active_alerts():
    now_iso = datetime.utcnow().isoformat()
    rows = (
        supabase.table("alerts")
        .select("*")
        .eq("active", True)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return [r for r in rows if not r.get("expires_at") or r["expires_at"] > now_iso]


@router.get("/", response_model=list[Alert])
def list_alerts(_: UserProfile = Depends(require_admin)):
    return (
        supabase.table("alerts")
        .select("*")
        .order("created_at", desc=True)
        .execute()
        .data
    )


@router.post("/", response_model=Alert, status_code=201)
def create_alert(body: AlertCreate, profile: UserProfile = Depends(require_admin)):
    payload = body.model_dump(mode="json")
    payload["created_by"] = profile.id
    return supabase.table("alerts").insert(payload).execute().data[0]


@router.patch("/{alert_id}", response_model=Alert)
def update_alert(alert_id: str, body: AlertUpdate, _: UserProfile = Depends(require_admin)):
    payload = {k: v for k, v in body.model_dump(mode="json").items() if v is not None}
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = supabase.table("alerts").update(payload).eq("id", alert_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Alert not found")
    return result.data[0]


@router.delete("/{alert_id}", status_code=204)
def delete_alert(alert_id: str, _: UserProfile = Depends(require_admin)):
    supabase.table("alerts").delete().eq("id", alert_id).execute()
