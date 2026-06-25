"""
Compares actual DB team counts against CSV expectations.
Run from repo root: python scripts/verify_teams.py
"""
import os, sys
from dotenv import load_dotenv
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))
from supabase import create_client

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

all_teams = []
page = 0
while True:
    batch = sb.table("teams").select("company_id, sport_id").range(page * 1000, page * 1000 + 999).execute().data
    all_teams.extend(batch)
    if len(batch) < 1000:
        break
    page += 1
teams = all_teams
sports = sb.table("sports").select("id, name").execute().data
companies = sb.table("companies").select("id, short_id").execute().data

sport_map = {s["id"]: s["name"] for s in sports}
company_map = {c["id"]: c["short_id"] for c in companies}

db = defaultdict(lambda: defaultdict(int))
for t in teams:
    c = company_map.get(t["company_id"], "?")
    s = sport_map.get(t["sport_id"], "?")
    db[c][s] += 1

CSV = {
  "TAC":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "ANDR":     {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "AS-X-HA":  {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":2},
  "APEX":     {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "ARG":      {"Cornhole":2,"Dodgeball":1,"Pickleball":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":3},
  "AST":      {"Basketball":1,"Ultimate Frisbee":1,"Volleyball":1},
  "AV":       {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "BATA":     {"Basketball":1,"Cornhole":4,"Dodgeball":1,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":1},
  "BHSG":     {"Basketball":1,"Cornhole":1,"Dodgeball":1,"Executive Golf":1,"Pickleball":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":1},
  "BALA-X-GB":{"Basketball":1,"Cornhole":4,"Dodgeball":2,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "BLU":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":3},
  "BOE":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "BAH":      {"Basketball":1,"Cornhole":2,"Dodgeball":1,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Ultimate Frisbee":1,"Volleyball":1},
  "BMCD":     {"Basketball":1,"Cornhole":2,"Dodgeball":1,"Executive Golf":1,"Pickleball":1,"Soccer":1},
  "CAM":      {"Dodgeball":2,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":5},
  "CNPY":     {"Basketball":1,"Cornhole":3,"Executive Golf":1,"Pickleball":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":1},
  "CAS":      {"Basketball":1,"Cornhole":2,"Dodgeball":1,"Pickleball":2,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":3},
  "CAE":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Pickleball":2,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":5},
  "DTT":      {"Dodgeball":1,"Human Pyramid":1,"Pickleball":2,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":5},
  "DIV":      {"Basketball":1,"Cornhole":3,"Dodgeball":2,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":3},
  "ETN":      {"Basketball":1,"Cornhole":4,"Dodgeball":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":5},
  "EPI":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "GA":       {"Cornhole":1,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":1},
  "GDMS":     {"Basketball":1,"Cornhole":4,"Dodgeball":1,"Pickleball":1,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":1},
  "GG-X-WS":  {"Cornhole":1,"Dodgeball":1,"Executive Golf":1,"Ultimate Frisbee":1,"Volleyball":1},
  "HAD":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Pickleball":2,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":5},
  "HER":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Pickleball":2,"Tug of War":1,"Volleyball":1,"Water Ball Toss":5},
  "HONA":     {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "HFS":      {"Basketball":1,"Cornhole":2,"Dodgeball":1,"Executive Golf":1,"Pickleball":2,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":4},
  "ITT":      {"Cornhole":4,"Dodgeball":2,"Pickleball":2,"Soccer":1},
  "JPL":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "KRMN":     {"Basketball":1,"Cornhole":4,"Dodgeball":1,"Human Pyramid":1,"Pickleball":2,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":3},
  "KH":       {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "L3":       {"Basketball":1,"Cornhole":2,"Dodgeball":1,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":3},
  "L3HA":     {"Basketball":1,"Cornhole":4,"Executive Golf":1,"Pickleball":2,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":4},
  "LA":       {"Basketball":1,"Cornhole":4,"Dodgeball":1,"Executive Golf":1,"Pickleball":1,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":4},
  "LMSW":     {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "MACH":     {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "MSS":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "MOOG":     {"Basketball":1,"Cornhole":4,"Dodgeball":1,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "NGC":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "ODYS":     {"Cornhole":3,"Dodgeball":1,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Volleyball":1,"Water Ball Toss":4},
  "ONT":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Human Pyramid":1,"Pickleball":1,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":4},
  "OOPS":     {"Dodgeball":1,"Tug of War":1},
  "PAS":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "PCC":      {"Basketball":1,"Cornhole":3,"Dodgeball":1,"Pickleball":1,"Relay Race":1,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":2},
  "PPG":      {"Basketball":1,"Cornhole":3,"Dodgeball":1,"Executive Golf":1,"Pickleball":2,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":3},
  "RO":       {"Dodgeball":1,"Pickleball":1,"Soccer":1,"Ultimate Frisbee":1,"Volleyball":1},
  "RS":       {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":4},
  "RKL":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "RR-X-TSC": {"Basketball":1,"Cornhole":3,"Dodgeball":1,"Executive Golf":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":1},
  "RTX":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Human Pyramid":1,"Pickleball":2,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":1},
  "WWS":      {"Basketball":1,"Cornhole":3,"Pickleball":1,"Soccer":1,"Volleyball":1},
  "SC":       {"Cornhole":2,"Dodgeball":1,"Executive Golf":1,"Tug of War":1,"Water Ball Toss":2},
  "SSI":      {"Basketball":1,"Cornhole":4,"Pickleball":1,"Soccer":1,"Water Ball Toss":2},
  "SIFT":     {"Basketball":1,"Pickleball":2,"Tug of War":1,"Volleyball":1},
  "SKY":      {"Basketball":1,"Cornhole":2,"Dodgeball":1,"Executive Golf":1,"Pickleball":2,"Soccer":1,"Volleyball":1,"Water Ball Toss":3},
  "SPCX":     {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "STRT":     {"Cornhole":4,"Dodgeball":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":3},
  "EDW":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Pickleball":2,"Relay Race":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":5},
  "TDY":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Volleyball":1,"Water Ball Toss":5},
  "TOC":      {"Basketball":1,"Cornhole":4,"Dodgeball":1,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "TKS":      {"Cornhole":3,"Dodgeball":1,"Pickleball":1,"Relay Race":1,"Soccer":1,"Volleyball":1,"Water Ball Toss":4},
  "VRD":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "VAST":     {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
  "VG":       {"Basketball":1,"Cornhole":3,"Dodgeball":1,"Human Pyramid":1,"Pickleball":2,"Soccer":1,"Volleyball":1,"Water Ball Toss":2},
  "WWD":      {"Basketball":1,"Cornhole":4,"Dodgeball":2,"Executive Golf":1,"Human Pyramid":1,"Pickleball":2,"Relay Race":1,"Soccer":1,"Tug of War":1,"Ultimate Frisbee":1,"Volleyball":1,"Water Ball Toss":5},
}

print(f"{'Company':<14} {'Sport':<22} {'DB':>4} {'CSV':>4}")
print("-" * 48)
any_diff = False
for company in sorted(CSV.keys()):
    for sport, expected in sorted(CSV[company].items()):
        actual = db[company][sport]
        if actual != expected:
            print(f"{company:<14} {sport:<22} {actual:>4} {expected:>4}")
            any_diff = True

if not any_diff:
    print("All match!")
