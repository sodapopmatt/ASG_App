from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from app.database import supabase
from app.auth import require_admin
from app.schemas.company import Company, CompanyCreate, CompanyUpdate

router = APIRouter()


@router.get("", response_model=list[Company])
def list_companies():
    return supabase.table("companies").select("*").order("name").execute().data


@router.get("/{company_id}", response_model=Company)
def get_company(company_id: str):
    response = supabase.table("companies").select("*").eq("id", company_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Company not found")
    return response.data[0]


def _handle_unique_violation(exc: APIError):
    if getattr(exc, "code", None) == "23505":
        raise HTTPException(status_code=409, detail="A company with that name or short_id already exists")
    raise HTTPException(status_code=502, detail=f"Database error: {getattr(exc, 'message', exc)}")


@router.post("", response_model=Company, status_code=201)
def create_company(body: CompanyCreate, _=Depends(require_admin)):
    try:
        return supabase.table("companies").insert(body.model_dump()).execute().data[0]
    except APIError as exc:
        _handle_unique_violation(exc)


@router.patch("/{company_id}", response_model=Company)
def update_company(company_id: str, body: CompanyUpdate, _=Depends(require_admin)):
    try:
        return supabase.table("companies").update(body.model_dump(exclude_none=True)).eq("id", company_id).execute().data[0]
    except APIError as exc:
        _handle_unique_violation(exc)


@router.delete("/{company_id}", status_code=204)
def delete_company(company_id: str, _=Depends(require_admin)):
    supabase.table("companies").delete().eq("id", company_id).execute()
