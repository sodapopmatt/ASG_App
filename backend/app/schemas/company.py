from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime

SHORT_ID_PATTERN = r"^[A-Z0-9-]+$"


class CompanyCreate(BaseModel):
    name: str
    short_id: str = Field(pattern=SHORT_ID_PATTERN)
    logo_url: str | None = None


class CompanyUpdate(BaseModel):
    name: str | None = None
    short_id: str | None = Field(default=None, pattern=SHORT_ID_PATTERN)
    logo_url: str | None = None


class Company(CompanyCreate):
    id: UUID
    created_at: datetime
