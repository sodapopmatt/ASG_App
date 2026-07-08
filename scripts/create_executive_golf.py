"""
Creates the Executive Golf sport and one team per participating company.
Run from the repo root: python scripts/create_executive_golf.py
"""
import sys
import os
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))

from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# Companies with Executive Golf = 1 (from ASG-Team-Counts.csv)
GOLF_COMPANIES = [
    "TAC", "ANDR", "APEX", "AV", "BATA", "BHSG", "BLU", "BOE", "BAH", "BMCD",
    "CNPY", "CAE", "EPI", "GA", "GG-X-WS", "HFS", "JPL", "KH", "L3", "L3HA",
    "LA", "LMSW", "MACH", "MSS", "MOOG", "NGC", "ODYS", "PAS", "PPG", "RS",
    "RKL", "RR-X-TSC", "SC", "SKY", "TOC", "VAST", "VRD", "WWD",
]


def main():
    sb = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

    # Create the sport
    sport_payload = {
        "name": "Executive Golf",
        "bracket_type": "heats",
        "teams_per_company": 1,
        "scoring_direction": "low_wins",
        "multi_team_rule": "best_placement",
        "points_scale": {"1": 20, "2": 15, "3": 10, "default": 5},
        "scoring_mode": "executive_golf",
        "match_duration_minutes": 3,
    }
    sport_resp = sb.table("sports").insert(sport_payload).execute()
    sport_id = sport_resp.data[0]["id"]
    print(f"Created sport 'Executive Golf' with id {sport_id}")

    # Fetch companies
    companies_resp = sb.table("companies").select("id, short_id").execute()
    company_map = {row["short_id"]: row["id"] for row in companies_resp.data}

    missing = [s for s in GOLF_COMPANIES if s not in company_map]
    if missing:
        print(f"ERROR - missing companies: {missing}")
        return

    # Create one team per company
    rows = [{"company_id": company_map[s], "sport_id": sport_id, "name": "A"} for s in GOLF_COMPANIES]
    result = sb.table("teams").insert(rows).execute()
    print(f"Inserted {len(result.data)} teams.")
    print(f"Done. Total: 1 sport + {len(result.data)} teams.")


if __name__ == "__main__":
    main()
