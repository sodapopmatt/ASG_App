"""
Deletes all existing companies (and cascading data) then inserts the 2026 company list.
Run from the repo root: python scripts/reset_companies.py
"""
import re
import sys
import os
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))

from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

COMPANIES = [
    ("Aerospace Corporation", "TAC"),
    ("Allied Machine & Engineering", "AMEC"),
    ("Anduril Industries, Inc.", "ANDR"),
    ("AnySignal, Inc. x Heart Aerospace", "AS-X-HA"),
    ("Apex", "APEX"),
    ("Argo Space", "ARG"),
    ("Astrolab", "AST"),
    ("AeroVironment", "AV"),
    ("Bay Area Team x TransAstra", "BATA"),
    ("Beacon Hill Technologies", "BHSG"),
    ("Beckhoff Automation x Glenair", "BALA-X-GB"),
    ("Blue Origin", "BLU"),
    ("Boeing", "BOE"),
    ("Booz Allen Hamilton", "BAH"),
    ("Burns & McDonnell", "BMCD"),
    ("Cambium", "CAM"),
    ("Canopy Aerospace & Defense", "CNPY"),
    ("Castelion Corporation", "CAS"),
    ("Crane Aerospace & Electronics", "CAE"),
    ("Deloitte", "DTT"),
    ("Divergent Technologies", "DIV"),
    ("Eaton", "ETN"),
    ("Epirus", "EPI"),
    ("General Atomics", "GA"),
    ("General Dynamics Mission Systems", "GDMS"),
    ("General Galactic x Wardstone", "GG-X-WS"),
    ("Hadrian", "HAD"),
    ("Hermeus", "HER"),
    ("Honeywell Aerospace", "HONA"),
    ("Howmet Aerospace", "HFS"),
    ("ITT Aerospace Controls", "ITT"),
    ("JPL", "JPL"),
    ("Karman Space & Defense", "KRMN"),
    ("Kirkhill Inc.", "KH"),
    ("L3Harris", "L3"),
    ("L3Harris Anaheim", "L3HA"),
    ("Lisi Aerospace", "LA"),
    ("Lockheed Martin Skunk Works", "LMSW"),
    ("Mach Industries", "MACH"),
    ("Millennium Space Systems", "MSS"),
    ("Moog", "MOOG"),
    ("Northrop Grumman", "NGC"),
    ("Odys Aviation", "ODYS"),
    ("Ontic", "ONT"),
    ("Orbital Operations", "OOPS"),
    ("Parker Hannifin", "PAS"),
    ("PCC Permaswage", "PCC"),
    ("PPG Industries", "PPG"),
    ("Reflect Orbital", "RO"),
    ("Relativity Space", "RS"),
    ("Rocket Lab", "RKL"),
    ("Rolls Royce x Turion Space", "RR-X-TSC"),
    ("RTX", "RTX"),
    ("Safran Cabin - WWS", "WWS"),
    ("Scaled Composites", "SC"),
    ("Sensor Systems Inc", "SSI"),
    ("Sift", "SIFT"),
    ("Skyryse Inc.", "SKY"),
    ("SpaceX", "SPCX"),
    ("Stratolaunch", "STRT"),
    ("Team Edwards", "EDW"),
    ("Teledyne", "TDY"),
    ("Terran Orbital", "TOC"),
    ("ThinKom Solutions Inc", "TKS"),
    ("Varda Space Industries", "VRD"),
    ("Vast", "VAST"),
    ("Virgin Galactic", "VG"),
    ("Woodward", "WWD"),
]

SHORT_ID_RE = re.compile(r"^[A-Z0-9-]+$")

def validate():
    for name, short_id in COMPANIES:
        if not SHORT_ID_RE.match(short_id):
            raise ValueError(f"Invalid short_id '{short_id}' for '{name}'")
    print(f"All {len(COMPANIES)} short_ids valid.")

def main():
    validate()

    sb = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

    # Delete in dependency order to avoid FK violations
    print("Deleting roster_entries...")
    sb.table("roster_entries").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    print("Deleting matches...")
    sb.table("matches").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    print("Deleting brackets...")
    sb.table("brackets").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    print("Deleting event_points...")
    sb.table("event_points").delete().neq("company_id", "00000000-0000-0000-0000-000000000000").execute()

    print("Deleting donation_counts...")
    sb.table("donation_counts").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    print("Deleting teams...")
    sb.table("teams").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    print("Deleting companies...")
    sb.table("companies").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    # Verify clean
    remaining = sb.table("companies").select("id", count="exact").execute()
    print(f"Companies remaining after delete: {remaining.count}")

    # Insert new companies
    print(f"\nInserting {len(COMPANIES)} companies...")
    rows = [{"name": name, "short_id": short_id} for name, short_id in COMPANIES]
    result = sb.table("companies").insert(rows).execute()
    print(f"Inserted {len(result.data)} companies.")

    # Spot-check
    check = sb.table("companies").select("name, short_id").order("name").execute()
    print("\nSample (first 5):")
    for row in check.data[:5]:
        print(f"  {row['short_id']:12} {row['name']}")
    print(f"\nDone. Total companies in DB: {len(check.data)}")

if __name__ == "__main__":
    main()
