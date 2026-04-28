from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class CompanyCreate(BaseModel):
    name: str
    short_id: str | None = None
    logo_url: str | None = None


class CompanyUpdate(BaseModel):
    name: str | None = None
    short_id: str | None = None
    logo_url: str | None = None


class Company(CompanyCreate):
    id: UUID
    created_at: datetime
