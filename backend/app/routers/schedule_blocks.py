from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from uuid import UUID
from app.database import supabase
from app.auth import require_admin
from app.routers.matches import invalidate_blocks_cache

router = APIRouter()


class ScheduleBlockCreate(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    start_time: datetime
    end_time: datetime
    sport_ids: list[UUID] | None = None

    @model_validator(mode="after")
    def _check_order(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class ScheduleBlockUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=100)
    start_time: datetime | None = None
    end_time: datetime | None = None
    sport_ids: list[UUID] | None = None


class ScheduleBlock(BaseModel):
    id: UUID
    label: str
    start_time: datetime
    end_time: datetime
    sport_ids: list[UUID] | None = None


@router.get("", response_model=list[ScheduleBlock])
def list_schedule_blocks():
    return (
        supabase.table("schedule_blocks")
        .select("*")
        .order("start_time")
        .execute()
        .data
    )


@router.post("", response_model=ScheduleBlock, status_code=201)
def create_schedule_block(body: ScheduleBlockCreate, _=Depends(require_admin)):
    payload = body.model_dump(mode="json")
    result = supabase.table("schedule_blocks").insert(payload).execute().data[0]
    invalidate_blocks_cache()
    return result


@router.patch("/{block_id}", response_model=ScheduleBlock)
def update_schedule_block(block_id: str, body: ScheduleBlockUpdate, _=Depends(require_admin)):
    # exclude_unset (not exclude_none): a caller explicitly sending sport_ids:
    # null means "clear back to all sports", which must survive the payload.
    payload = body.model_dump(exclude_unset=True, mode="json")
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update")

    existing = supabase.table("schedule_blocks").select("start_time, end_time").eq("id", block_id).limit(1).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Schedule block not found")

    def _parse(value) -> datetime:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))

    new_start = _parse(payload.get("start_time", existing.data[0]["start_time"]))
    new_end = _parse(payload.get("end_time", existing.data[0]["end_time"]))
    if new_end <= new_start:
        raise HTTPException(status_code=422, detail="end_time must be after start_time")

    result = supabase.table("schedule_blocks").update(payload).eq("id", block_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Schedule block not found")
    invalidate_blocks_cache()
    return result.data[0]


@router.delete("/{block_id}", status_code=204)
def delete_schedule_block(block_id: str, _=Depends(require_admin)):
    supabase.table("schedule_blocks").delete().eq("id", block_id).execute()
    invalidate_blocks_cache()
