"""
Creates teams for all companies based on the ASG-Team-Counts.csv data.
Run from the repo root: python scripts/create_teams.py
"""
import sys
import os
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))

from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

TEAM_LETTERS = ["A", "B", "C", "D", "E"]

# (company_short_id, sport_name, count)
TEAM_DATA = [
    ("TAC", "Basketball", 1), ("TAC", "Cornhole", 4), ("TAC", "Dodgeball", 2), ("TAC", "Human Pyramid", 1), ("TAC", "Pickleball", 2), ("TAC", "Relay Race", 1), ("TAC", "Soccer", 1), ("TAC", "Tug of War", 1), ("TAC", "Ultimate Frisbee", 1), ("TAC", "Volleyball", 1), ("TAC", "Water Ball Toss", 5),
    ("ANDR", "Basketball", 1), ("ANDR", "Cornhole", 4), ("ANDR", "Dodgeball", 2), ("ANDR", "Human Pyramid", 1), ("ANDR", "Pickleball", 2), ("ANDR", "Relay Race", 1), ("ANDR", "Soccer", 1), ("ANDR", "Tug of War", 1), ("ANDR", "Ultimate Frisbee", 1), ("ANDR", "Volleyball", 1), ("ANDR", "Water Ball Toss", 5),
    ("AS-X-HA", "Basketball", 1), ("AS-X-HA", "Cornhole", 4), ("AS-X-HA", "Dodgeball", 2), ("AS-X-HA", "Human Pyramid", 1), ("AS-X-HA", "Pickleball", 2), ("AS-X-HA", "Relay Race", 1), ("AS-X-HA", "Soccer", 1), ("AS-X-HA", "Tug of War", 1), ("AS-X-HA", "Ultimate Frisbee", 1), ("AS-X-HA", "Volleyball", 1), ("AS-X-HA", "Water Ball Toss", 2),
    ("APEX", "Basketball", 1), ("APEX", "Cornhole", 4), ("APEX", "Dodgeball", 2), ("APEX", "Human Pyramid", 1), ("APEX", "Pickleball", 2), ("APEX", "Relay Race", 1), ("APEX", "Soccer", 1), ("APEX", "Tug of War", 1), ("APEX", "Ultimate Frisbee", 1), ("APEX", "Volleyball", 1), ("APEX", "Water Ball Toss", 5),
    ("ARG", "Cornhole", 2), ("ARG", "Dodgeball", 1), ("ARG", "Pickleball", 1), ("ARG", "Tug of War", 1), ("ARG", "Water Ball Toss", 3),
    ("AST", "Basketball", 1), ("AST", "Ultimate Frisbee", 1), ("AST", "Volleyball", 1),
    ("AV", "Basketball", 1), ("AV", "Cornhole", 4), ("AV", "Dodgeball", 2), ("AV", "Human Pyramid", 1), ("AV", "Pickleball", 2), ("AV", "Relay Race", 1), ("AV", "Soccer", 1), ("AV", "Tug of War", 1), ("AV", "Ultimate Frisbee", 1), ("AV", "Volleyball", 1), ("AV", "Water Ball Toss", 1),
    ("BATA", "Basketball", 1), ("BATA", "Cornhole", 4), ("BATA", "Dodgeball", 1), ("BATA", "Human Pyramid", 1), ("BATA", "Pickleball", 2), ("BATA", "Relay Race", 1), ("BATA", "Soccer", 1), ("BATA", "Tug of War", 1), ("BATA", "Volleyball", 1), ("BATA", "Water Ball Toss", 1),
    ("BHSG", "Basketball", 1), ("BHSG", "Cornhole", 1), ("BHSG", "Dodgeball", 1), ("BHSG", "Human Pyramid", 1), ("BHSG", "Pickleball", 1), ("BHSG", "Ultimate Frisbee", 1), ("BHSG", "Volleyball", 1), ("BHSG", "Water Ball Toss", 1),
    ("BALA-X-GB", "Basketball", 1), ("BALA-X-GB", "Cornhole", 4), ("BALA-X-GB", "Dodgeball", 2), ("BALA-X-GB", "Human Pyramid", 1), ("BALA-X-GB", "Pickleball", 2), ("BALA-X-GB", "Relay Race", 1), ("BALA-X-GB", "Soccer", 1), ("BALA-X-GB", "Tug of War", 1), ("BALA-X-GB", "Ultimate Frisbee", 1), ("BALA-X-GB", "Volleyball", 1), ("BALA-X-GB", "Water Ball Toss", 5),
    ("BLU", "Basketball", 1), ("BLU", "Cornhole", 4), ("BLU", "Dodgeball", 2), ("BLU", "Human Pyramid", 1), ("BLU", "Pickleball", 2), ("BLU", "Relay Race", 1), ("BLU", "Soccer", 1), ("BLU", "Tug of War", 1), ("BLU", "Ultimate Frisbee", 1), ("BLU", "Volleyball", 1), ("BLU", "Water Ball Toss", 3),
    ("BOE", "Basketball", 1), ("BOE", "Cornhole", 4), ("BOE", "Dodgeball", 2), ("BOE", "Human Pyramid", 1), ("BOE", "Pickleball", 2), ("BOE", "Relay Race", 1), ("BOE", "Soccer", 1), ("BOE", "Tug of War", 1), ("BOE", "Ultimate Frisbee", 1), ("BOE", "Volleyball", 1), ("BOE", "Water Ball Toss", 5),
    ("BAH", "Basketball", 1), ("BAH", "Cornhole", 2), ("BAH", "Dodgeball", 1), ("BAH", "Human Pyramid", 1), ("BAH", "Pickleball", 2), ("BAH", "Relay Race", 1), ("BAH", "Soccer", 1), ("BAH", "Ultimate Frisbee", 1), ("BAH", "Volleyball", 1),
    ("BMCD", "Basketball", 1), ("BMCD", "Cornhole", 2), ("BMCD", "Dodgeball", 1), ("BMCD", "Human Pyramid", 1), ("BMCD", "Pickleball", 1), ("BMCD", "Soccer", 1),
    ("CAM", "Dodgeball", 2), ("CAM", "Soccer", 1), ("CAM", "Tug of War", 1), ("CAM", "Volleyball", 1), ("CAM", "Water Ball Toss", 5),
    ("CNPY", "Basketball", 1), ("CNPY", "Cornhole", 3), ("CNPY", "Pickleball", 1), ("CNPY", "Tug of War", 1), ("CNPY", "Volleyball", 1), ("CNPY", "Water Ball Toss", 1),
    ("CAS", "Basketball", 1), ("CAS", "Cornhole", 2), ("CAS", "Dodgeball", 1), ("CAS", "Pickleball", 2), ("CAS", "Soccer", 1), ("CAS", "Tug of War", 1), ("CAS", "Volleyball", 1), ("CAS", "Water Ball Toss", 3),
    ("CAE", "Basketball", 1), ("CAE", "Cornhole", 4), ("CAE", "Dodgeball", 2), ("CAE", "Pickleball", 2), ("CAE", "Soccer", 1), ("CAE", "Tug of War", 1), ("CAE", "Volleyball", 1), ("CAE", "Water Ball Toss", 5),
    ("DTT", "Dodgeball", 1), ("DTT", "Human Pyramid", 1), ("DTT", "Pickleball", 2), ("DTT", "Soccer", 1), ("DTT", "Tug of War", 1), ("DTT", "Volleyball", 1), ("DTT", "Water Ball Toss", 5),
    ("DIV", "Basketball", 1), ("DIV", "Cornhole", 3), ("DIV", "Dodgeball", 2), ("DIV", "Human Pyramid", 1), ("DIV", "Pickleball", 2), ("DIV", "Relay Race", 1), ("DIV", "Soccer", 1), ("DIV", "Tug of War", 1), ("DIV", "Ultimate Frisbee", 1), ("DIV", "Volleyball", 1), ("DIV", "Water Ball Toss", 3),
    ("ETN", "Basketball", 1), ("ETN", "Cornhole", 4), ("ETN", "Dodgeball", 1), ("ETN", "Human Pyramid", 1), ("ETN", "Pickleball", 2), ("ETN", "Relay Race", 1), ("ETN", "Soccer", 1), ("ETN", "Tug of War", 1), ("ETN", "Volleyball", 1), ("ETN", "Water Ball Toss", 5),
    ("EPI", "Basketball", 1), ("EPI", "Cornhole", 4), ("EPI", "Dodgeball", 2), ("EPI", "Human Pyramid", 1), ("EPI", "Pickleball", 2), ("EPI", "Relay Race", 1), ("EPI", "Soccer", 1), ("EPI", "Tug of War", 1), ("EPI", "Ultimate Frisbee", 1), ("EPI", "Volleyball", 1), ("EPI", "Water Ball Toss", 5),
    ("GA", "Cornhole", 1), ("GA", "Human Pyramid", 1), ("GA", "Pickleball", 2), ("GA", "Relay Race", 1), ("GA", "Soccer", 1), ("GA", "Tug of War", 1), ("GA", "Ultimate Frisbee", 1), ("GA", "Volleyball", 1), ("GA", "Water Ball Toss", 1),
    ("GDMS", "Cornhole", 1), ("GDMS", "Ultimate Frisbee", 1), ("GDMS", "Volleyball", 1),
    ("GG-X-WS", "Cornhole", 1), ("GG-X-WS", "Dodgeball", 1), ("GG-X-WS", "Ultimate Frisbee", 1), ("GG-X-WS", "Volleyball", 1),
    ("HER", "Basketball", 1), ("HER", "Cornhole", 4), ("HER", "Dodgeball", 2), ("HER", "Pickleball", 2), ("HER", "Tug of War", 1), ("HER", "Volleyball", 1), ("HER", "Water Ball Toss", 5),
    ("HONA", "Basketball", 1), ("HONA", "Cornhole", 4), ("HONA", "Dodgeball", 2), ("HONA", "Human Pyramid", 1), ("HONA", "Pickleball", 2), ("HONA", "Relay Race", 1), ("HONA", "Soccer", 1), ("HONA", "Tug of War", 1), ("HONA", "Ultimate Frisbee", 1), ("HONA", "Volleyball", 1), ("HONA", "Water Ball Toss", 5),
    ("HFS", "Basketball", 1), ("HFS", "Cornhole", 2), ("HFS", "Dodgeball", 1), ("HFS", "Human Pyramid", 1), ("HFS", "Pickleball", 2), ("HFS", "Soccer", 1), ("HFS", "Tug of War", 1), ("HFS", "Volleyball", 1), ("HFS", "Water Ball Toss", 4),
    ("ITT", "Cornhole", 4), ("ITT", "Dodgeball", 2), ("ITT", "Pickleball", 2), ("ITT", "Soccer", 1),
    ("JPL", "Basketball", 1), ("JPL", "Cornhole", 4), ("JPL", "Dodgeball", 2), ("JPL", "Human Pyramid", 1), ("JPL", "Pickleball", 2), ("JPL", "Relay Race", 1), ("JPL", "Soccer", 1), ("JPL", "Tug of War", 1), ("JPL", "Ultimate Frisbee", 1), ("JPL", "Volleyball", 1), ("JPL", "Water Ball Toss", 5),
    ("KRMN", "Basketball", 1), ("KRMN", "Cornhole", 4), ("KRMN", "Dodgeball", 1), ("KRMN", "Human Pyramid", 1), ("KRMN", "Pickleball", 2), ("KRMN", "Soccer", 1), ("KRMN", "Tug of War", 1), ("KRMN", "Volleyball", 1), ("KRMN", "Water Ball Toss", 3),
    ("KH", "Basketball", 1), ("KH", "Cornhole", 4), ("KH", "Dodgeball", 2), ("KH", "Human Pyramid", 1), ("KH", "Pickleball", 2), ("KH", "Relay Race", 1), ("KH", "Soccer", 1), ("KH", "Tug of War", 1), ("KH", "Ultimate Frisbee", 1), ("KH", "Volleyball", 1), ("KH", "Water Ball Toss", 5),
    ("L3", "Basketball", 1), ("L3", "Cornhole", 2), ("L3", "Dodgeball", 1), ("L3", "Human Pyramid", 1), ("L3", "Pickleball", 2), ("L3", "Relay Race", 1), ("L3", "Soccer", 1), ("L3", "Tug of War", 1), ("L3", "Ultimate Frisbee", 1), ("L3", "Volleyball", 1), ("L3", "Water Ball Toss", 3),
    ("L3HA", "Basketball", 1), ("L3HA", "Cornhole", 4), ("L3HA", "Pickleball", 2), ("L3HA", "Soccer", 1), ("L3HA", "Tug of War", 1), ("L3HA", "Volleyball", 1), ("L3HA", "Water Ball Toss", 4),
    ("LA", "Basketball", 1), ("LA", "Cornhole", 4), ("LA", "Dodgeball", 1), ("LA", "Human Pyramid", 1), ("LA", "Pickleball", 1), ("LA", "Relay Race", 1), ("LA", "Soccer", 1), ("LA", "Tug of War", 1), ("LA", "Ultimate Frisbee", 1), ("LA", "Volleyball", 1), ("LA", "Water Ball Toss", 4),
    ("LMSW", "Basketball", 1), ("LMSW", "Cornhole", 4), ("LMSW", "Dodgeball", 2), ("LMSW", "Human Pyramid", 1), ("LMSW", "Pickleball", 2), ("LMSW", "Relay Race", 1), ("LMSW", "Soccer", 1), ("LMSW", "Tug of War", 1), ("LMSW", "Ultimate Frisbee", 1), ("LMSW", "Volleyball", 1), ("LMSW", "Water Ball Toss", 5),
    ("MACH", "Basketball", 1), ("MACH", "Cornhole", 4), ("MACH", "Dodgeball", 2), ("MACH", "Human Pyramid", 1), ("MACH", "Pickleball", 2), ("MACH", "Relay Race", 1), ("MACH", "Soccer", 1), ("MACH", "Tug of War", 1), ("MACH", "Ultimate Frisbee", 1), ("MACH", "Volleyball", 1), ("MACH", "Water Ball Toss", 5),
    ("MSS", "Basketball", 1), ("MSS", "Cornhole", 4), ("MSS", "Dodgeball", 2), ("MSS", "Pickleball", 2), ("MSS", "Relay Race", 1), ("MSS", "Soccer", 1), ("MSS", "Tug of War", 1), ("MSS", "Ultimate Frisbee", 1), ("MSS", "Volleyball", 1), ("MSS", "Water Ball Toss", 5),
    ("MOOG", "Basketball", 1), ("MOOG", "Cornhole", 4), ("MOOG", "Dodgeball", 1), ("MOOG", "Human Pyramid", 1), ("MOOG", "Pickleball", 2), ("MOOG", "Relay Race", 1), ("MOOG", "Soccer", 1), ("MOOG", "Tug of War", 1), ("MOOG", "Ultimate Frisbee", 1), ("MOOG", "Volleyball", 1), ("MOOG", "Water Ball Toss", 5),
    ("NGC", "Basketball", 1), ("NGC", "Cornhole", 4), ("NGC", "Dodgeball", 2), ("NGC", "Human Pyramid", 1), ("NGC", "Pickleball", 2), ("NGC", "Relay Race", 1), ("NGC", "Soccer", 1), ("NGC", "Tug of War", 1), ("NGC", "Ultimate Frisbee", 1), ("NGC", "Volleyball", 1), ("NGC", "Water Ball Toss", 5),
    ("ODYS", "Cornhole", 3), ("ODYS", "Dodgeball", 1), ("ODYS", "Human Pyramid", 1), ("ODYS", "Pickleball", 2), ("ODYS", "Relay Race", 1), ("ODYS", "Volleyball", 1), ("ODYS", "Water Ball Toss", 4),
    ("ONT", "Basketball", 1), ("ONT", "Cornhole", 4), ("ONT", "Dodgeball", 2), ("ONT", "Human Pyramid", 1), ("ONT", "Pickleball", 1), ("ONT", "Relay Race", 1), ("ONT", "Soccer", 1), ("ONT", "Tug of War", 1), ("ONT", "Ultimate Frisbee", 1), ("ONT", "Volleyball", 1), ("ONT", "Water Ball Toss", 4),
    ("OOPS", "Dodgeball", 1), ("OOPS", "Tug of War", 1),
    ("PAS", "Basketball", 1), ("PAS", "Cornhole", 4), ("PAS", "Dodgeball", 2), ("PAS", "Human Pyramid", 1), ("PAS", "Pickleball", 2), ("PAS", "Relay Race", 1), ("PAS", "Soccer", 1), ("PAS", "Tug of War", 1), ("PAS", "Ultimate Frisbee", 1), ("PAS", "Volleyball", 1), ("PAS", "Water Ball Toss", 5),
    ("PCC", "Basketball", 1), ("PCC", "Cornhole", 3), ("PCC", "Dodgeball", 1), ("PCC", "Pickleball", 1), ("PCC", "Relay Race", 1), ("PCC", "Soccer", 1), ("PCC", "Tug of War", 1), ("PCC", "Volleyball", 1), ("PCC", "Water Ball Toss", 2),
    ("PPG", "Basketball", 1), ("PPG", "Cornhole", 3), ("PPG", "Dodgeball", 1), ("PPG", "Human Pyramid", 1), ("PPG", "Pickleball", 2), ("PPG", "Soccer", 1), ("PPG", "Tug of War", 1), ("PPG", "Ultimate Frisbee", 1), ("PPG", "Volleyball", 1), ("PPG", "Water Ball Toss", 3),
    ("RO", "Dodgeball", 1), ("RO", "Pickleball", 1), ("RO", "Soccer", 1), ("RO", "Ultimate Frisbee", 1), ("RO", "Volleyball", 1),
    ("RS", "Basketball", 1), ("RS", "Cornhole", 4), ("RS", "Dodgeball", 2), ("RS", "Human Pyramid", 1), ("RS", "Pickleball", 2), ("RS", "Relay Race", 1), ("RS", "Soccer", 1), ("RS", "Tug of War", 1), ("RS", "Ultimate Frisbee", 1), ("RS", "Volleyball", 1), ("RS", "Water Ball Toss", 4),
    ("RKL", "Basketball", 1), ("RKL", "Cornhole", 4), ("RKL", "Dodgeball", 2), ("RKL", "Human Pyramid", 1), ("RKL", "Pickleball", 2), ("RKL", "Relay Race", 1), ("RKL", "Soccer", 1), ("RKL", "Tug of War", 1), ("RKL", "Ultimate Frisbee", 1), ("RKL", "Volleyball", 1), ("RKL", "Water Ball Toss", 5),
    ("RR-X-TSC", "Basketball", 1), ("RR-X-TSC", "Cornhole", 3), ("RR-X-TSC", "Dodgeball", 1), ("RR-X-TSC", "Human Pyramid", 1), ("RR-X-TSC", "Pickleball", 2), ("RR-X-TSC", "Relay Race", 1), ("RR-X-TSC", "Soccer", 1), ("RR-X-TSC", "Tug of War", 1), ("RR-X-TSC", "Volleyball", 1), ("RR-X-TSC", "Water Ball Toss", 1),
    ("RTX", "Basketball", 1), ("RTX", "Cornhole", 4), ("RTX", "Dodgeball", 2), ("RTX", "Human Pyramid", 1), ("RTX", "Pickleball", 2), ("RTX", "Soccer", 1), ("RTX", "Tug of War", 1), ("RTX", "Ultimate Frisbee", 1), ("RTX", "Volleyball", 1), ("RTX", "Water Ball Toss", 1),
    ("WWS", "Basketball", 1), ("WWS", "Cornhole", 3), ("WWS", "Pickleball", 1), ("WWS", "Soccer", 1), ("WWS", "Volleyball", 1),
    ("SC", "Cornhole", 2), ("SC", "Dodgeball", 1), ("SC", "Human Pyramid", 1), ("SC", "Tug of War", 1), ("SC", "Water Ball Toss", 2),
    ("SSI", "Basketball", 1), ("SSI", "Cornhole", 4), ("SSI", "Pickleball", 1), ("SSI", "Soccer", 1), ("SSI", "Water Ball Toss", 2),
    ("SIFT", "Basketball", 1), ("SIFT", "Pickleball", 2), ("SIFT", "Tug of War", 1), ("SIFT", "Volleyball", 1),
    ("SKY", "Basketball", 1), ("SKY", "Cornhole", 2), ("SKY", "Dodgeball", 1), ("SKY", "Human Pyramid", 1), ("SKY", "Pickleball", 2), ("SKY", "Soccer", 1), ("SKY", "Volleyball", 1), ("SKY", "Water Ball Toss", 3),
    ("SPCX", "Basketball", 1), ("SPCX", "Cornhole", 4), ("SPCX", "Dodgeball", 2), ("SPCX", "Human Pyramid", 1), ("SPCX", "Pickleball", 2), ("SPCX", "Relay Race", 1), ("SPCX", "Soccer", 1), ("SPCX", "Tug of War", 1), ("SPCX", "Ultimate Frisbee", 1), ("SPCX", "Volleyball", 1), ("SPCX", "Water Ball Toss", 5),
    ("STRT", "Cornhole", 4), ("STRT", "Dodgeball", 1), ("STRT", "Human Pyramid", 1), ("STRT", "Pickleball", 2), ("STRT", "Relay Race", 1), ("STRT", "Soccer", 1), ("STRT", "Tug of War", 1), ("STRT", "Volleyball", 1), ("STRT", "Water Ball Toss", 3),
    ("EDW", "Basketball", 1), ("EDW", "Cornhole", 4), ("EDW", "Dodgeball", 2), ("EDW", "Pickleball", 2), ("EDW", "Relay Race", 1), ("EDW", "Tug of War", 1), ("EDW", "Volleyball", 1), ("EDW", "Water Ball Toss", 5),
    ("TDY", "Basketball", 1), ("TDY", "Cornhole", 4), ("TDY", "Dodgeball", 2), ("TDY", "Human Pyramid", 1), ("TDY", "Pickleball", 2), ("TDY", "Relay Race", 1), ("TDY", "Soccer", 1), ("TDY", "Tug of War", 1), ("TDY", "Volleyball", 1), ("TDY", "Water Ball Toss", 5),
    ("VRD", "Basketball", 1), ("VRD", "Cornhole", 4), ("VRD", "Dodgeball", 2), ("VRD", "Human Pyramid", 1), ("VRD", "Pickleball", 2), ("VRD", "Relay Race", 1), ("VRD", "Soccer", 1), ("VRD", "Tug of War", 1), ("VRD", "Ultimate Frisbee", 1), ("VRD", "Volleyball", 1), ("VRD", "Water Ball Toss", 5),
    ("VG", "Basketball", 1), ("VG", "Cornhole", 3), ("VG", "Dodgeball", 1), ("VG", "Human Pyramid", 1), ("VG", "Pickleball", 2), ("VG", "Soccer", 1), ("VG", "Volleyball", 1), ("VG", "Water Ball Toss", 2),
    ("WWD", "Basketball", 1), ("WWD", "Cornhole", 4), ("WWD", "Dodgeball", 2), ("WWD", "Human Pyramid", 1), ("WWD", "Pickleball", 2), ("WWD", "Relay Race", 1), ("WWD", "Soccer", 1), ("WWD", "Tug of War", 1), ("WWD", "Ultimate Frisbee", 1), ("WWD", "Volleyball", 1), ("WWD", "Water Ball Toss", 5),
]


def main():
    sb = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

    # Fetch companies: short_id -> id
    companies_resp = sb.table("companies").select("id, short_id").execute()
    company_map = {row["short_id"]: row["id"] for row in companies_resp.data}
    print(f"Loaded {len(company_map)} companies.")

    # Fetch sports: name -> id
    sports_resp = sb.table("sports").select("id, name").execute()
    sport_map = {row["name"]: row["id"] for row in sports_resp.data}
    print(f"Loaded {len(sport_map)} sports: {sorted(sport_map.keys())}")

    # Validate all references before inserting
    missing_companies = set()
    missing_sports = set()
    for short_id, sport_name, _ in TEAM_DATA:
        if short_id not in company_map:
            missing_companies.add(short_id)
        if sport_name not in sport_map:
            missing_sports.add(sport_name)

    if missing_companies:
        print(f"\nERROR - missing companies: {sorted(missing_companies)}")
    if missing_sports:
        print(f"\nERROR - missing sports: {sorted(missing_sports)}")
    if missing_companies or missing_sports:
        print("Aborting — fix the above before inserting teams.")
        return

    # Build team rows
    rows = []
    for short_id, sport_name, count in TEAM_DATA:
        company_id = company_map[short_id]
        sport_id = sport_map[sport_name]
        for i in range(count):
            rows.append({
                "company_id": company_id,
                "sport_id": sport_id,
                "name": TEAM_LETTERS[i],
            })

    print(f"\nInserting {len(rows)} teams...")

    # Insert in batches of 200
    batch_size = 200
    inserted = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        result = sb.table("teams").insert(batch).execute()
        inserted += len(result.data)
        print(f"  {inserted}/{len(rows)}")

    print(f"\nDone. {inserted} teams inserted.")

    # Spot-check
    total = sb.table("teams").select("id", count="exact").execute()
    print(f"Total teams in DB: {total.count}")


if __name__ == "__main__":
    main()
