"""
Applies team count changes from the updated ASG-Team-Counts.csv.

Changes vs the original create_teams.py:
  ADD teams:
    HAD  - Bball×1, Corn×4, Dodge×2, Pick×2, Soccer×1, ToW×1, Volley×1, WBT×5
    TOC  - Bball×1, Corn×4, Dodge×1, HumPyr×1, Pick×2, Relay×1, Soccer×1, ToW×1, UltFris×1, Volley×1, WBT×5
    TKS  - Corn×3, Dodge×1, Pick×1, Relay×1, Soccer×1, Volley×1, WBT×4
    VAST - Bball×1, Corn×4, Dodge×2, HumPyr×1, Pick×2, Relay×1, Soccer×1, ToW×1, UltFris×1, Volley×1, WBT×5
    AV   - Water Ball Toss +4 (1→5)
    ARG  - Volleyball +1 (0→1)
    GDMS - Basketball +1, Cornhole +3 (1→4), Dodgeball +1, Pickleball +1,
           Soccer +1, Tug of War +1, Water Ball Toss +1

  DELETE teams (1 team each):
    GDMS - Ultimate Frisbee (1→0)
    BHSG, BMCD, HFS, LA, PPG, RR-X-TSC, SC, SKY - Human Pyramid (1→0)

  NOTE: Executive Golf teams for TOC and VAST are handled separately
        by create_executive_golf.py — add them there and re-run if needed.

Run from repo root: python scripts/update_teams.py
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

# Teams to add: (short_id, sport_name, count)
ADD = [
    # HAD
    ("HAD", "Basketball", 1), ("HAD", "Cornhole", 4), ("HAD", "Dodgeball", 2),
    ("HAD", "Pickleball", 2), ("HAD", "Soccer", 1), ("HAD", "Tug of War", 1),
    ("HAD", "Volleyball", 1), ("HAD", "Water Ball Toss", 5),
    # TOC
    ("TOC", "Basketball", 1), ("TOC", "Cornhole", 4), ("TOC", "Dodgeball", 1),
    ("TOC", "Human Pyramid", 1), ("TOC", "Pickleball", 2), ("TOC", "Relay Race", 1),
    ("TOC", "Soccer", 1), ("TOC", "Tug of War", 1), ("TOC", "Ultimate Frisbee", 1),
    ("TOC", "Volleyball", 1), ("TOC", "Water Ball Toss", 5),
    # TKS
    ("TKS", "Cornhole", 3), ("TKS", "Dodgeball", 1), ("TKS", "Pickleball", 1),
    ("TKS", "Relay Race", 1), ("TKS", "Soccer", 1), ("TKS", "Volleyball", 1),
    ("TKS", "Water Ball Toss", 4),
    # VAST
    ("VAST", "Basketball", 1), ("VAST", "Cornhole", 4), ("VAST", "Dodgeball", 2),
    ("VAST", "Human Pyramid", 1), ("VAST", "Pickleball", 2), ("VAST", "Relay Race", 1),
    ("VAST", "Soccer", 1), ("VAST", "Tug of War", 1), ("VAST", "Ultimate Frisbee", 1),
    ("VAST", "Volleyball", 1), ("VAST", "Water Ball Toss", 5),
    # AV - Water Ball Toss goes 1→5, so add 4 more (B, C, D, E)
    ("AV", "Water Ball Toss", 4),
    # ARG - Volleyball 0→1
    ("ARG", "Volleyball", 1),
    # GDMS additions
    ("GDMS", "Basketball", 1), ("GDMS", "Cornhole", 3), ("GDMS", "Dodgeball", 1),
    ("GDMS", "Pickleball", 1), ("GDMS", "Soccer", 1), ("GDMS", "Tug of War", 1),
    ("GDMS", "Water Ball Toss", 1),
]

# Teams to delete: (short_id, sport_name, count_to_delete)
# Deletes the last N teams (by name, descending) for the given company+sport.
DELETE = [
    ("GDMS", "Ultimate Frisbee", 1),
    ("BHSG", "Human Pyramid", 1),
    ("BMCD", "Human Pyramid", 1),
    ("HFS",  "Human Pyramid", 1),
    ("LA",   "Human Pyramid", 1),
    ("PPG",  "Human Pyramid", 1),
    ("RR-X-TSC", "Human Pyramid", 1),
    ("SC",   "Human Pyramid", 1),
    ("SKY",  "Human Pyramid", 1),
]


def main():
    sb = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

    companies_resp = sb.table("companies").select("id, short_id").execute()
    company_map = {row["short_id"]: row["id"] for row in companies_resp.data}

    sports_resp = sb.table("sports").select("id, name").execute()
    sport_map = {row["name"]: row["id"] for row in sports_resp.data}

    # Validate
    missing_c = {s for s, _, _ in ADD + DELETE if s not in company_map}
    missing_s = {sp for _, sp, _ in ADD + DELETE if sp not in sport_map}
    if missing_c:
        print(f"ERROR - missing companies: {sorted(missing_c)}")
    if missing_s:
        print(f"ERROR - missing sports: {sorted(missing_s)}")
    if missing_c or missing_s:
        print("Aborting.")
        return

    # --- Additions ---
    # For each (short_id, sport, count) in ADD, figure out existing team count
    # so we name new teams correctly (continuing the letter sequence).
    existing_resp = sb.table("teams").select("company_id, sport_id, name").execute()
    # Build a set of (company_id, sport_id) -> sorted list of names
    from collections import defaultdict
    existing = defaultdict(list)
    for row in existing_resp.data:
        existing[(row["company_id"], row["sport_id"])].append(row["name"])

    rows_to_insert = []
    for short_id, sport_name, count in ADD:
        company_id = company_map[short_id]
        sport_id = sport_map[sport_name]
        current_names = sorted(existing[(company_id, sport_id)])
        start_idx = len(current_names)
        for i in range(count):
            letter_idx = start_idx + i
            if letter_idx >= len(TEAM_LETTERS):
                print(f"WARNING: {short_id}/{sport_name} exceeds 5 teams, skipping extra")
                break
            rows_to_insert.append({
                "company_id": company_id,
                "sport_id": sport_id,
                "name": TEAM_LETTERS[letter_idx],
            })

    if rows_to_insert:
        print(f"Inserting {len(rows_to_insert)} teams...")
        batch_size = 200
        inserted = 0
        for i in range(0, len(rows_to_insert), batch_size):
            batch = rows_to_insert[i:i + batch_size]
            result = sb.table("teams").insert(batch).execute()
            inserted += len(result.data)
        print(f"  Inserted {inserted} teams.")
    else:
        print("No teams to insert.")

    # --- Deletions ---
    deleted = 0
    for short_id, sport_name, count in DELETE:
        company_id = company_map[short_id]
        sport_id = sport_map[sport_name]
        # Fetch existing teams for this company+sport, delete last N by name desc
        resp = sb.table("teams") \
            .select("id, name") \
            .eq("company_id", company_id) \
            .eq("sport_id", sport_id) \
            .order("name", desc=True) \
            .limit(count) \
            .execute()
        if len(resp.data) < count:
            print(f"WARNING: {short_id}/{sport_name} has {len(resp.data)} team(s), expected {count} to delete")
        for row in resp.data:
            sb.table("teams").delete().eq("id", row["id"]).execute()
            print(f"  Deleted {short_id}/{sport_name} team '{row['name']}'")
            deleted += 1

    print(f"\nDone. {len(rows_to_insert)} teams added, {deleted} teams deleted.")
    total = sb.table("teams").select("id", count="exact").execute()
    print(f"Total teams in DB: {total.count}")


if __name__ == "__main__":
    main()
