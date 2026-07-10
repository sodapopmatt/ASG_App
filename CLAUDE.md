# CLAUDE.md

## Purpose
This file defines how to build and modify the system.  
It is a developer + AI execution guide, not a product spec.

---

## Source of Truth
- /docs/SRS.md

**Rule:** If anything here conflicts with the SRS, follow the SRS.

---

## Current System State (CRITICAL)

### Locked Data Model Decisions
Do NOT change these without explicit migration updates.

#### Rosters
- Use `roster_entries`
- Names are plain text only
- No player model exists
- Relationship:
  - team → roster_entries

---

#### Companies
- `companies.short_id` is:
  - NOT NULL
  - UNIQUE
  - Format: `^[A-Z0-9-]+$`

---

#### Matches
- Use:
  - `home_team_id`
  - `away_team_id`
  - `winner_id`
- Use `location_id` (UUID FK)
- Status enum:
  - `scheduled`
  - `in_progress`
  - `completed`
  - `forfeit`
  - `double_forfeit`
  - `draw` — pool play only; no winner_id; both teams earn a draw; scores recorded via `home_score`/`away_score`

---

#### Scores
- Matches carry optional `home_score` / `away_score` (nullable INT)
- Supplementary only — admin still explicitly selects `winner_id`; scores do NOT auto-derive the outcome
- NULL on forfeit / double_forfeit (cleared on those endpoints)
- No score-based logic in standings/advancement (pool tiebreakers remain manual)

---

#### Company Scoring
- Derived from placements (not manually entered)
- Updated via backend-controlled endpoints only
- Not directly editable
- Enforced by:
  - UNIQUE(company_id, sport_id)

---

## Migration Status

V1 migration is complete.

- Deprecated tables and columns have been removed
- Application code is fully aligned with schema

### Removed (Do Not Reintroduce)

- `players`
- `team_rosters`

---

## Backend Architecture

### Stack
- FastAPI (Python)
- Supabase (Postgres + Auth + RLS)

### Rules
- Backend is the source of truth for business logic
- Supabase is data + auth only
- Do not rely on frontend for validation

---

## Core Entities

### companies
- `id` (UUID)
- `name` (TEXT, UNIQUE)
- `short_id` (TEXT, UNIQUE, `^[A-Z0-9-]+$`)
- `logo_url` (TEXT, nullable)

---

### sports
- `id` (UUID)
- `name` (TEXT, UNIQUE)
- `bracket_type` (TEXT) — see Bracket System section
- `teams_per_company` (INT, default 1)
- `scoring_direction` (TEXT) — `high_wins` | `low_wins`
- `multi_team_rule` (TEXT) — `best_placement` | `average_score`
- `points_scale` (JSONB, nullable) — NULL = ASG default scale
- `scoring_mode` (TEXT) — `placement` (default; admin awards via `/event-points/award-placement`) | `donation_count` (admin enters per-company item counts via `/donation-counts`; points derived: top=15, second=10, ≥10 items=5, else=0; ties share points) | `water_ball_toss` (real per-team matches, `bracket_type='heats'`; rounds survived entered via the generic heat-result endpoint; a company's score is the best of its own teams; standings are NOT live — an admin reviews computed placements on ScoringPage and explicitly saves via `POST /waterball-results/sports/{id}/recompute`, ties share points) | `executive_golf` (real per-team matches, `bracket_type='heats'`, in two heat brackets "Round 1"/"Round 2"; 3 hole scores per company entered via `/golf-results` — stored as a JSON array in `matches.notes`, total in `matches.home_score`; ranked by Round-2 total, lowest wins; standings NOT live — an admin reviews and saves via `POST /golf-results/sports/{id}/recompute`, ties share points)
- `match_duration_minutes` (INT, nullable)
- `schedule_start` (TIMESTAMPTZ, nullable)
- `pool_play_rounds` (INT, nullable) — pool-play sports only; NULL = full round robin (every team plays every other in its pool once); N = truncate each pool to N rounds, i.e. each team plays N distinct opponents (odd pool sizes sit one team out per round, so those teams may play slightly fewer). Set via SportConfigPage's "Games per team (pool stage)" field. Used when there isn't time for a full round robin (e.g. large Pickleball pools).

---

### teams
- `id` (UUID)
- `company_id` (UUID, FK → companies)
- `sport_id` (UUID, FK → sports)
- `name` (TEXT, optional)

---

### locations
- `id` (UUID)
- `sport_id` (UUID, FK → sports)
- `name` (TEXT) — e.g., "Court 1", "Field A"
- UNIQUE(sport_id, name)
- Court count for scheduling = COUNT(locations WHERE sport_id = ?)

---

### roster_entries
- `id` (UUID)
- `team_id` (FK → teams.id)
- `player_name` (TEXT)

---

### brackets
- `id` (UUID)
- `sport_id` (UUID, FK → sports)
- `name` (TEXT) — e.g., "Winners Bracket", "Pool A"
- `phase` (TEXT) — `pool` | `bracket` | `heats` | `finals`
- `division` (TEXT, nullable) — venue split label (e.g., "Main Gym"); NULL for single-bracket sports and the cross-division championship bracket

---

### matches
- `id` (UUID)
- `sport_id` (UUID, FK → sports)
- `bracket_id` (UUID, FK → brackets, nullable)
- `home_team_id` (UUID, FK → teams, nullable)
- `away_team_id` (UUID, FK → teams, nullable)
- `location_id` (UUID, FK → locations, nullable)
- `winner_id` (UUID, FK → teams, nullable)
- `home_score` (INT, nullable) — optional, supplementary to `winner_id`
- `away_score` (INT, nullable) — optional, supplementary to `winner_id`
- `winner_next_match_id` (UUID, self-ref → matches, nullable)
- `loser_next_match_id` (UUID, self-ref → matches, nullable)
- `status` (TEXT) — see locked decisions above
- `match_round` (INT, nullable)
- `scheduled_at` (TIMESTAMPTZ, nullable)
- `actual_start` (TIMESTAMPTZ, nullable) — set by `/matches/{id}/start`
- `played_at` (TIMESTAMPTZ, nullable) — set when result submitted
- `notes` (TEXT, nullable)

---

### alerts
- `id` (UUID)
- `message` (TEXT, 1–500 chars)
- `severity` (TEXT) — `info` | `warning` | `critical`
- `active` (BOOL, default true)
- `expires_at` (TIMESTAMPTZ, nullable) — alerts auto-hide once past this time
- `created_by` (UUID, nullable FK → auth.users)
- `created_at` (TIMESTAMPTZ)

Admin-issued broadcast banners. Public can read active+unexpired via `GET /alerts/active`; the frontend polls this every 30s and renders dismissable banners at the top of every page (dismissal is client-side, stored in `localStorage`). Admin-only writes.

---

### event_points
- `company_id` (UUID, FK → companies)
- `sport_id` (UUID, FK → sports)
- `placement` (INT)
- `points` (INT)
- UNIQUE(company_id, sport_id)

---

### donation_counts
- `id` (UUID)
- `company_id` (UUID, FK → companies)
- `sport_id` (UUID, FK → sports) — must have `scoring_mode = 'donation_count'`
- `item_count` (INT, ≥0)
- UNIQUE(company_id, sport_id)

Per-company donation totals for donation-style sports (Canned Food Drive). Writes to `/donation-counts` automatically recompute `event_points` for the sport using the bucket rules (top=15, second=10, ≥10 items=5, else=0; ties share points). `event_points.placement` is set to a synthetic 1/2/3 corresponding to the bucket.

---

### Water Ball Toss (scoring_mode = water_ball_toss)
No dedicated table — Water Ball Toss is `bracket_type = 'heats'` with real `matches` rows, one per team (flat, no opponent — same shape as Human Pyramid), grouped into two heat `brackets` ("Group A"/"Group B"). It reuses existing generic infrastructure end-to-end:
- **Groups**: built from `teams.pool_index` (0/1), set via `PUT /sports/{id}/pool-setup` — the same mechanism pool play uses. SportConfigPage (`/manage/brackets/:sportId`) shows a "Groups" section using the same `PoolBuckets` UI as pool play (default: alternating split by company, manual override, "Save Groups" button), just with 2 fixed groups and no courts. Group assignment is purely organizational and does not affect scoring.
- **Generate**: "Generate Matches" button builds `HeatSpec[]` from the two groups and calls the existing `POST /sports/{id}/generate-bracket` (heats path) — creates one `brackets` row per group and one flat match per team, same bulk-insert code Relay Race's preliminary heats use.
- **Start**: the generic `POST /matches/{id}/start` (no changes needed).
- **Enter result**: the generic `POST /matches/{id}/heat-result` (`{time_ms}` or `{forfeit: true}`) — the same endpoint Human Pyramid/Relay Race use for their time, just holding "rounds survived" instead of milliseconds, stored as a string in `matches.notes`.
- **Reset**: the generic `DELETE /sports/{id}/brackets` — already clears `event_points` too when `bracket_type == 'heats'`.
- **Scoring** (the one genuinely bespoke piece, in `backend/app/routers/waterball_results.py`): points per team = `rounds_survived + 1` (showing up and dropping on the first toss = 1 pt), or 0 if forfeited, else excluded (not yet played). A company's score is the **best** of its own teams' points (not an average — refs only track whichever team went furthest; heats' generic ranking is deliberately NOT used here since it hardcodes lowest-wins and has no per-company aggregation). `POST /waterball-results/sports/{id}/recompute` rebuilds `event_points` from all of the sport's matches: companies ranked by that best-of score, awarded the sport's placement scale (default ASG 40/38/36/34…), tied companies sharing the averaged points.
- **Not live**: unlike `donation_count`, entering a result on `WaterballResultsPage` does NOT call recompute — it only updates the match. Standings only update when an admin opens ScoringPage's Water Ball Toss section (shows a live preview of best-of-company scores computed client-side from the same matches, alongside the last-saved `event_points`) and taps **Save Placements**, which is what actually calls `recompute`. This is a deliberate review step before the leaderboard changes.

---

### Executive Golf (scoring_mode = executive_golf)
No dedicated table — Executive Golf is `bracket_type = 'heats'` with real `matches` rows, one per company (flat, no opponent — same shape as Human Pyramid / Water Ball Toss), grouped into two heat `brackets` named **"Round 1"** and **"Round 2"**. Each company plays the same 3 holes per round; an admin enters 3 hole scores and the app sums them. Round 1 is the whole field; the 6 lowest totals advance (manually selected) to Round 2, which ranks those 6 by lowest total. It reuses generic infrastructure except for score entry and scoring:
- **Generate Round 1**: SportConfigPage's "Generate Round 1" button calls the existing `POST /sports/{id}/generate-bracket` (heats path) with a single `HeatSpec {name:'Round 1', team_ids: all, phase:'heats'}` — one bracket, one flat match per company. Unlike other heats sports (which share one `scheduled_at` per heat and race simultaneously), the golf path in `generate_bracket` stores a **distinct per-company `scheduled_at`** staggered by `match_duration_minutes` (set to 3) from `schedule_start` — companies tee off individually, not as a group. A court/tee location is optional (used only as a schedule display header, like Human Pyramid's venue label); the stagger is baked into `scheduled_at` at generation, so it does not depend on the court ripple. Relatedly, `_attach_estimated_starts` (matches.py) excludes `executive_golf` from the "concurrent heat" shared-start treatment so `estimated_start` matches the staggered `scheduled_at`.
- **Enter results**: on `GolfResultsPage` (Round 1/Round 2 tabs), enter each company's 3 hole scores directly (no separate Start step — a company's row is ready as soon as its tee time comes up) or mark it forfeit via the bespoke `POST /golf-results/matches/{id}/result` (`{hole_scores:[..]}` or `{forfeit:true}`) — the generic `heat-result` can't be reused because it stores a single value. Scores are stored as a JSON array in `matches.notes`; the total is mirrored to `matches.home_score`. Once saved, the row greys out with an **Edit** link to unlock it for a correction.
- **Advance to Round 2**: once every Round-1 match is played, GolfResultsPage's Round 2 tab shows a top-6 selection panel (companies ranked by Round-1 total ascending; the closest-to-the-hole tiebreak at the cut line is done offline). Selecting 6 and tapping "Generate Round 2" calls the same `generate-bracket` heats path with `{name:'Round 2', team_ids:[6], phase:'heats'}`.
- **Reset**: the generic `DELETE /sports/{id}/brackets` (clears `event_points` too, `bracket_type='heats'`).
- **Scoring** (auto-computed with editable overrides, ScoringPage's `GolfScoringSection`): mirrors the Round-2-totals ranking Relay Race style — a live preview ranks the Round-2 field by lowest total (forfeits last), everyone else who competed in Round 1 defaults to one shared participation placement. Each row's placement is editable before saving (defaults to the auto-computed rank), and points are independently editable too (default to the placement-derived `points_scale` value — `{"1":20,"2":15,"3":10,"default":5}` → 1st=20, 2nd=15, 3rd=10, everyone else=5 — but a typed override replaces that for one company as a manual exception). **Save Placements** writes each company via the generic `POST /event-points/award-placement` (one call per row, passing its current placement and, if set, an explicit `points` override), the same mechanism Relay Race and standard sports use; there is no bulk recompute in this path.
- **Not live**: entering a result does not touch `event_points` — standings only update when an admin explicitly reviews and saves from the Scoring page. `POST /golf-results/sports/{id}/recompute` (`backend/app/routers/golf_results.py`) still exists and rebuilds `event_points` the same way in one bulk call, but the ScoringPage UI no longer calls it now that placements are editable per row.

---

## Bracket System

### Supported Types
| bracket_type | Auto-Generated | Frontend Support |
|---|---|---|
| `single_elimination` | Yes | Full |
| `double_elimination` | Yes | Full |
| `pool_bracket` | Yes — pools + seeded bracket phase | Full — pool setup, standings, results entry, bracket view |
| `pool_swiss` | Pools only (Swiss rounds manual) | Partial — pool UI works; no Swiss round UI |
| `heats` | Yes — flat (one entry per team) OR grouped multi-phase (one bracket per heat) | Full for Relay Race (multi-phase: prelims → semis → final); flat for Human Pyramid; grouped single-phase ("Group A"/"Group B") for Water Ball Toss (`scoring_mode='water_ball_toss'` — bespoke best-of-company scoring instead of the generic heats ranking/ScoringPage flow); grouped two-round ("Round 1"/"Round 2") for Executive Golf (`scoring_mode='executive_golf'` — bespoke 3-hole totals + lowest-wins Round-2 ranking) |
| `points_based` | N/A — no matches | Partial — placement entry via Scoring page only |

### Auto-Generation Rules (elimination only)
- `single_elimination`: standard seeding (1 vs N, 2 vs N-1), byes for non-power-of-2
- `double_elimination`: winners bracket + losers bracket + grand final; WB losers drop to LB on schedule
  - 2-team edge case: no losers bracket; the WB match's loser drops straight into the grand final
- Court assignment is done at generation time using subtree grouping (WB) and round-robin (LB)
- Grand final gets no pre-assigned court; inherits from first semifinal winner

### Divisions (venue split — Basketball only, across two gyms)
- `generate-bracket` accepts optional `divisions: [{name, team_ids, location_ids}]` (elimination types only, ≥2 divisions, ≥2 teams each; teams/courts cannot repeat across divisions)
- Restricted to the Basketball sport specifically (by `sports.name`) — enforced both in the frontend (SportConfigPage hides the "Split into two divisions" toggle for all other sports) and the backend (`generate-bracket` returns 422 if `divisions` is set for a non-Basketball sport)
- Each division gets its own independent bracket on its own courts; bracket rows are tagged with `division` and names are prefixed (e.g., "Main Gym — Winners Bracket")
- A single championship match (bracket "Championship", phase `finals`, division NULL) is created; each division's root match gets `winner_next_match_id` pointed at it, so division winners advance into it automatically via the existing engine
- Championship court is unassigned (dynamic claim by first division to finish; admin can PATCH `location_id`)
- Frontend (public Brackets + BracketResultsPage) renders one bracket per division plus a championship card when any bracket has a non-null `division`

### Pool Play (pool_bracket / pool_swiss)
- `generate-bracket` accepts optional `pools: [{name, team_ids, location_ids}]` (pool types only, ≥1 pool, ≥2 teams each; teams/courts cannot repeat across pools)
- Each pool = one `brackets` row with `phase='pool'`; matches are a single round robin (circle method, `bracket_engine/round_robin.py`); odd team counts sit out one round (no bye rows); no advancement links
- **Truncated round robin** (`sports.pool_play_rounds`, nullable, any pool-play sport): NULL = full round robin (default, unchanged). N = `generate_round_robin(teams, max_rounds=N)` keeps only the first N circle-method rounds, so each team plays exactly N distinct opponents, balanced and non-repeating (odd pool sizes sit one team out per round → those teams may play slightly fewer). N ≥ the natural round count falls back to a full round robin. Standings/seeding are unaffected (already computed from whatever terminal matches exist; tiebreaks already manual). Threaded sport → `_generate_pool_play` → `persist_pools(max_rounds=...)`. Set in SportConfigPage as "Games per team (pool stage)".
- Courts round-robin within each pool's courts; times sequential per court from `schedule_start`
- `GET /sports/{id}/standings` computes W-L per pool from terminal matches (completed/forfeit → winner W / opponent L; double_forfeit → both L); rank by wins desc, losses asc; identical records share a rank
- **No score-based tiebreakers** — V1 has no scores; admins break ties manually when seeding the bracket phase
- "Assumed boards/courts per group" scheduling field (`sports.assumed_courts_per_group`) is `pool_swiss`-only (Cornhole) in SportConfigPage — `pool_bracket` sports (Soccer, Ultimate Frisbee, Pickleball) use real named `locations` (Courts section) instead
- Bracket phase (`pool_bracket` only): calling `generate-bracket` again with `team_ids` (no `pools`) generates a single-elimination bracket via `persist_bracket(bracket_type_override="single_elimination", shuffle=False)` — seed order is preserved exactly (frontend pre-fills it from standings: pool winners first, then runners-up); pool matches are kept; `clear_existing=true` is rejected on this path; bracket-phase start time = last scheduled match + one duration slot
- `pool_swiss`: pools generate the same way; calling with `team_ids` returns 422 (Swiss rounds not built — Cornhole championship is manual)

### Heats (multi-phase — Relay Race)
- `generate-bracket` accepts optional `heats: [{name, team_ids, phase, scheduled_at?}]` for grouped heat generation
  - `phase` values: `heats` (preliminary), `bracket` (semi-finals), `finals`
  - One `brackets` row per heat with `phase` set; one match per team with `bracket_id` set
  - `scheduled_at` derived from heat index × `match_duration_minutes` if omitted
- Flat mode (Human Pyramid): pass `team_ids` without `heats`; creates matches with no bracket row, no `bracket_id`
- Discrimination: grouped = brackets exist with non-null phase; flat = no brackets
- **Relay Race multi-phase flow:**
  1. Admin generates 7 preliminary heats from SportConfigPage (sets custom `points_scale` on sport)
  2. After all prelim heats complete, admin opens Semi-Finals tab → "Generate Semi-Finals" card appears; snake-distributes top 2 per prelim heat into 2 semi-final heats
  3. After both semi-finals complete, admin opens Final tab → "Generate Final Heat" card appears; top 3 per semi advance
  4. Final ranks 1–6 get gold/silver/bronze treatment in UI
- **Relay Race custom scoring scale (official ASG table):** 1st–6th: 40/38/36/34/32/30; 7th: 26; 8th: 24; 9th: 22; 10th–11th: 18 each; 12th–13th: 14 each; 14th+: 4 each; forfeit/DQ: 0
  - Auto-applied to `sport.points_scale` when generating grouped heats from SportConfigPage
  - ScoringPage auto-computes placements from heat results; admin can override before saving

### Seeding Constraint
- No two teams from the same company may meet in **Winners Bracket Round 1**
- Enforced via exhaustive greedy scan in `_shuffle_avoiding_same_company()` (bracket_engine/generator.py)
- Same-company matchups in WB R2+, LB rounds, and later stages are accepted as structurally inevitable when companies field multiple teams
- If no valid swap exists (one company holds more than half the slots), the conflict is left silently
- Skipped entirely for the pool_bracket bracket phase (`shuffle=False`) — standings seeding takes priority

### Match Advancement
- Happens automatically after result or forfeit submission
- `advance_winner()` slots winner into `winner_next_match_id`
- `loser_next_match_id` used for double elimination only
- Result retraction supported if downstream matches haven't started — either implicitly (resubmitting `/result` with a different winner) or explicitly via `POST /matches/{id}/reset`, which undoes the result entirely and returns the match to `scheduled`/`in_progress`
- `settle_bracket()` called after every result to check if all matches are resolved

### Scheduling
- `match_duration_minutes`, `schedule_start` are stored on the sport
- Court count is derived from the sport's named `locations` rows — not stored as an integer
- `estimated_start` is computed dynamically at read time (GET /matches) — not stored
  - **Pass 1:** per-court ripple — shifts matches forward if their court isn't free yet
  - **Pass 2:** feeder adjustment — `estimated_start` is at least as late as the finish time of both upstream feeder matches; processed in round order so feeders are always resolved first
- `actual_start` anchors a court's timeline when a match is marked in_progress
- Both `GET /matches` (list) and `GET /matches/{id}` (single) fetch all sport matches to ensure Pass 2 has full feeder visibility

---

## Preset Sport Configurations

| Sport | bracket_type | teams_per_company | scoring_direction | multi_team_rule | points_scale |
|---|---|---|---|---|---|
| Volleyball | double_elimination | 1 | high_wins | best_placement | ASG default |
| Basketball | double_elimination | 1 | high_wins | best_placement | ASG default |
| Dodgeball | double_elimination | 3 | high_wins | best_placement | ASG default |
| Soccer | pool_bracket | 1 | high_wins | best_placement | ASG default |
| Tug of War | single_elimination | 1 | high_wins | best_placement | ASG default |
| Ultimate Frisbee | pool_bracket | 1 | high_wins | best_placement | ASG default |
| Pickleball | pool_bracket | 2 | high_wins | best_placement | ASG default |
| Cornhole | pool_swiss | 4 | high_wins | best_placement | ASG default |
| Relay Race | heats | 1 | high_wins | best_placement | Custom (see Heats section) |
| Human Pyramid | heats | 1 | low_wins | best_placement | ASG default |
| Water Ball Toss | heats | 5 | high_wins | average_score¹ | ASG default |
| Executive Golf | heats | 1 | low_wins | best_placement | Custom `{1:20,2:15,3:10,default:5}` (uses `scoring_mode='executive_golf'`) |
| Canned Food Drive | points_based | 1 | high_wins | best_placement | n/a (uses `scoring_mode='donation_count'`) |

ASG default scale: 1st = 40, 2nd = 38, 3rd = 36, −2 per place; 20th and beyond all earn 2 (floor 2, per the official rulebook). SQL: `asg_points(placement INTEGER)`.

¹ `multi_team_rule` isn't read by any code — it's a leftover DB value, not the active rule. Water Ball Toss's real behavior (bespoke, in `waterball_results.py`) is **best of its teams**, not an average — see the Water Ball Toss entity section below.

---

## API Endpoints (Quick Reference)

### Companies — `/companies`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | public | List all |
| GET | `/{id}` | public | Get one |
| POST | `/` | admin | Create |
| PATCH | `/{id}` | admin | Update |
| DELETE | `/{id}` | admin | Delete |

### Sports — `/sports`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | public | List all |
| GET | `/{id}` | public | Get one |
| POST | `/` | admin | Create |
| PATCH | `/{id}` | admin | Update (including scheduling config) |
| DELETE | `/{id}` | admin | Delete |
| POST | `/{id}/generate-bracket` | admin | Generate bracket; accepts `team_ids`, `clear_existing`, optional `divisions` (venue split + auto championship match), optional `pools` (round-robin pool play), optional `heats` (grouped heat generation for heats sports); for pool_bracket sports, `team_ids` alone generates the seeded bracket phase |
| GET | `/{id}/standings` | public | W-L standings per pool (pool types; computed from terminal matches) |
| DELETE | `/{id}/brackets` | admin | Clear all matches/brackets for a sport |

### Teams — `/teams`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | public | List; filters: `company_id`, `sport_id` |
| GET | `/{id}` | public | Get one |
| POST | `/` | admin | Create |
| PATCH | `/{id}` | admin | Update |
| DELETE | `/{id}` | admin | Delete |

### Brackets — `/brackets`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | public | List; filter: `sport_id` |
| GET | `/{id}` | public | Get one |
| POST | `/` | admin | Create manually |
| PATCH | `/{id}` | admin | Update |
| DELETE | `/{id}` | admin | Delete |

### Matches — `/matches`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | public | List with `estimated_start`; filters: `sport_id`, `bracket_id`, `status` |
| GET | `/{id}` | public | Get one with `estimated_start` |
| POST | `/` | admin | Create manually |
| PATCH | `/{id}` | admin | Update `scheduled_at` or `location_id` |
| POST | `/{id}/start` | admin | Mark in_progress; sets `actual_start` |
| POST | `/{id}/result` | admin | Submit winner; advances bracket |
| POST | `/{id}/forfeit` | admin | Forfeit; accepts `forfeiting_team_id`; advances bracket |
| POST | `/{id}/double-forfeit` | admin | Both teams forfeit; no advancement |
| POST | `/{id}/draw` | admin | Record a draw; pool play only (no `winner_next_match_id`); accepts optional `home_score`/`away_score` |
| POST | `/{id}/reset` | admin | Undo a completed/forfeit/double_forfeit/draw result back to `scheduled` (or `in_progress` if already started). Reuses `retract_winner` for decided winners (same 409 guard as changing a result); double forfeits reset only if neither downstream slot has progressed past the byes it created |
| DELETE | `/{id}` | admin | Delete |

### Event Points — `/event-points`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | public | List; filters: `company_id`, `sport_id` |
| POST | `/award-placement` | admin | Award placement to company; upserts record; applies points_scale. Optional `tied_through` shares a placement: points = average of the tied places' values (e.g., tied 3rd/4th → 35 each). Optional `points` overrides the scale-derived value outright for this one company (a manual exception; ignores `tied_through` when set; may be **negative** — the rulebook's −10 no-show deduction for bracketed games is applied this way) |

### Leaderboard — `/leaderboard`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | public | Total points per company via SQL RPC `get_leaderboard()` |

### Roster Entries — `/roster-entries`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | public | List by `team_id` |
| POST | `/` | team_manager | Add player name |
| DELETE | `/{id}` | team_manager | Remove player |

### Alerts — `/alerts`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/active` | public | Active, non-expired alerts (used by the global banner) |
| GET | `/` | admin | List all (active + past) |
| POST | `/` | admin | Create alert |
| PATCH | `/{id}` | admin | Update `message`, `severity`, `active`, `expires_at` |
| DELETE | `/{id}` | admin | Delete alert |

### Locations — `/locations`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | public | List; filter: `sport_id` |
| POST | `/` | admin | Create location for a sport |
| DELETE | `/{id}` | admin | Delete location |

### Donation Counts — `/donation-counts`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | public | List; filters: `sport_id`, `company_id` |
| PUT | `/` | admin | Upsert `(company_id, sport_id, item_count)`; recomputes `event_points` for the sport |
| DELETE | `/{id}` | admin | Remove a row; recomputes `event_points` for the sport |
| POST | `/sports/{sport_id}/recompute` | admin | Force recompute of `event_points` from `donation_counts` |

---

### Waterball Results — `/waterball-results`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/sports/{sport_id}/recompute` | admin | Rebuild `event_points` for a `water_ball_toss` sport from its `matches` (best-of-company rounds survived, ranked, placement scale awarded) |

This is the only endpoint specific to Water Ball Toss — generating matches, starting them, entering results, and resetting all reuse the generic `sports`/`matches` endpoints (see the Water Ball Toss entity section above).

---

### Golf Results — `/golf-results`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/matches/{match_id}/result` | admin | Enter one Executive Golf round for a company: `{hole_scores:[int,..]}` (stored as JSON in `notes`, sum in `home_score`) or `{forfeit:true}` (clears both). 422 unless the sport is `executive_golf`. |
| POST | `/sports/{sport_id}/recompute` | admin | Bulk-rebuilds `event_points` for an `executive_golf` sport from Round-2 totals (lowest wins; participants get the default scale; ties share points). Not currently called by the frontend — ScoringPage saves per-company via the generic `/event-points/award-placement` instead, so admins can override placements before saving; this endpoint remains available for a straight auto-recompute if ever needed. |

Golf reuses the generic `sports`/`matches` endpoints for generating both rounds (heats path) and resetting; only score entry is bespoke (see the Executive Golf entity section above).

---

## Frontend Pages

| Page | Route | What it does |
|---|---|---|
| Schedule | `/schedule` | All matches grouped by sport+round or timeline view. Does NOT vary by `bracket_type` — Water Ball Toss flows through this like any other match-based sport. Sports with no `matches` at all (`donation_count`) get a plain event card/timeline row instead, driven by the sport's own `schedule_start`/`schedule_end`. |
| BracketsSportIndex / BracketView (public "Games" tab) | `/brackets`, `/brackets/:sportId` | Public read-only per-sport results. `BracketView.renderContent()` branches on `scoring_mode`/`bracket_type`: `donation_count` → ranked items table; `water_ball_toss` → Group A/B tabs of real matches (team + rounds survived/forfeit/TBD, via `WaterBallGroupTable`) plus a company standings table from `event_points`; `executive_golf` → Round 1/Round 2 tabs (company + total strokes/forfeit/TBD, via `GolfRoundTable`) plus a company standings table from `event_points`; other `heats`/`pool_bracket`/`pool_swiss`/elimination → their respective bracket views; else a fallback match list. All rank/points values come from `event_points` — no scoring logic is duplicated client-side. |
| BracketsPage | `/manage/brackets` | Generate elimination brackets, set scheduling config, manually adjust match times. Labels non-generatable sports as "Manual entry". |
| SportConfigPage | `/manage/brackets/:sportId` | Per-sport config: scheduling, courts, bracket/pool generation; pool sports get pool setup (snake auto-split + overrides) and a post-pool "Generate Bracket Phase" card seeded from standings; `water_ball_toss` sports get a "Groups" section (same team-grouping UI, 2 fixed groups, no courts) and a "Generate Matches"/"Reset All Results" flow that reuses the generic heats-generation and `resetBrackets` endpoints; `executive_golf` sports show a Courts section (the tee) plus a "Generate Round 1"/"Reset All Results" flow (single "Round 1" heat of all companies via the generic heats-generation). |
| ResultsPage | `/manage/results` | Lists pending matches; links to bracket visualization for elimination sports, pool results for pool sports, heats entry for heats, and golf entry for `executive_golf`. |
| PoolResultsPage | `/manage/results/pools/:sportId` | Pool matches grouped by pool+round; tap to enter result via shared MatchResultModal; links to bracket phase view. |
| WaterballResultsPage | `/manage/results/waterball/:sportId` | Water Ball Toss: Group A/B tabs (real `brackets`/`matches`, generated from SportConfigPage); Start each team's match, then enter rounds survived or mark forfeit via the generic `startMatch`/`submitHeatResult`. Does NOT touch `event_points` — standings are reviewed and saved from Scoring. |
| GolfResultsPage | `/manage/results/golf/:sportId` | Executive Golf: Round 1/Round 2 tabs; bulk-Start a round, then enter each company's 3 hole scores or mark forfeit via `submitGolfResult` (`/golf-results`). After Round 1 is complete, a "top 6" selection panel (ranked by Round-1 total) generates Round 2 via the generic `generate-bracket` heats path. Does NOT touch `event_points` — reviewed/saved from Scoring. |
| ScoringPage | `/manage/scoring` | Sport card list (tap to drill in). Every match-based sport (elimination, pool, heats — including Relay Race and Human Pyramid) gets an auto-computed final company ranking (`ComputedScoringSection` + the pure rankers in `frontend/src/lib/ranking.ts`: bracket sports by elimination round, pool sports by bracket finish then cross-pool record, heats by phase reached/times; multi-team companies collapse to their best team; tied companies share a placement with averaged points; forfeits flagged for the manual −10 no-show deduction) rendered in `AutoRankedScoringSection` — the Executive Golf UX (per-row Edit unlock, placement AND points editable, Publish Standings/Clear Points) — saving per company via `/event-points/award-placement` with explicit points. Sports with no results yet still render the same `AutoRankedScoringSection` table, blank (`buildManualRows` in `ranking.ts`) — every company gets an empty, editable placement/points row instead of a separate manual-entry form. For Canned Food Drive: read-only ranked standings, auto-computed live from `/donation-counts`. For Water Ball Toss: a live preview of best-of-company scores computed from `matches`, next to the last-saved `event_points`, with an explicit "Save Placements" button that calls `waterball-results` recompute. For Executive Golf: auto-computes placements from the Round-2 ranking (lowest total wins) plus a shared placement for Round-1-only participants, with both placement AND points independently editable per row (points default to the placement-derived scale value but can be overridden directly); calls `/event-points/award-placement` per company, same as Relay Race. |
| HeatsResultPage | `/manage/results/heats/:sportId` | For grouped heats (Relay Race): segmented Prelims/Semi-Finals/Final tabs with scrollable heat pill tabs within each phase; generate next phase when current is complete. For flat heats (Human Pyramid): simple per-team time entry. |
| TeamsPage | `/manage/teams` | Create/edit/delete teams, grouped by sport+company. |
| ManageHub | `/manage` | Navigation hub for admin pages. |
| AlertsPage | `/manage/alerts` | Compose, deactivate, and delete broadcast banner alerts. |

---

## API Behavior

### Submit Match Result
`POST /matches/{id}/result`

- Sets `winner_id`
- Accepts optional `home_score` / `away_score` (INT); does not validate winner against scores
- Sets status = `completed`
- Advances teams automatically
- Updates downstream matches
- Assigns court to winner's next match if unassigned

---

### Submit Forfeit
`POST /matches/{id}/forfeit`

- Accepts `forfeiting_team_id`
- Sets opponent as `winner_id`
- Sets status = `forfeit`
- Advances bracket

---

### Submit Double Forfeit
`POST /matches/{id}/double-forfeit`

- No winner
- Sets status = `double_forfeit`
- No bracket advancement

---

### Generate Bracket
`POST /sports/{id}/generate-bracket`

- Accepts seeded team IDs
- Optional: clear existing data
- Elimination types: full bracket; pool types: `pools` generates round-robin pool play, and (pool_bracket only) `team_ids` alone generates the seeded single-elimination bracket phase
- Heats type: `heats: [{name, team_ids, phase, scheduled_at?}]` generates grouped multi-phase heats (Relay Race); plain `team_ids` generates flat single-bracket entries (Human Pyramid)

---

## Frontend

### Stack
- React + Vite (PWA)

### Rules
- Frontend is UI only
- No business logic duplication
- All writes go through backend
- One sanctioned exception: **advisory scoring previews** may be computed client-side (the rankers in `lib/ranking.ts`, plus the Golf/Waterball previews) — they only suggest placements for the admin to review/edit, and the authoritative write is always `POST /event-points/award-placement` (or a bespoke recompute endpoint), where the backend derives/validates points

---

## Roles & Permissions

### Roles
- `admin`
- `team_manager`
- `player` (read-only, same as public)

### Enforcement
- Backend enforces permissions
- Supabase RLS is secondary protection

---

## Data Integrity Rules

- A company may only have one scoring record per sport
- Match results must define a winner or forfeit
- Scoring is derived from placements by default (not manual edits) — `POST /event-points/award-placement` always requires a `placement` and normally computes points from it via the sport's scale; an optional `points` param lets an admin override the derived value for one company as a manual exception (ScoringPage's editable auto-ranked sections expose this per row), but placement is still required and points are never entered from scratch without one. The override may be negative — the rulebook's −10 no-show deduction is applied this way, never automated.
- `roster_entries` must belong to a valid team
- `short_id` must be unique and valid format
- Matches must not conflict on location/time (warn only, not enforced)

---

## Out of Scope (Do Not Build)

- No league-style season scheduling engine (pool round-robin generation exists; anything beyond single round-robin pools is out)
- No third-party bracket integrations
- No player account system
- No manual scoring UI
- No push notifications (web push / OS-level); in-app banner alerts only — see Alerts section
- No multi-event support

---

## Development Priorities

1. Match result + forfeit workflows
2. Bracket visibility
3. Scoring flow (placement-based)
4. Admin usability improvements
5. Non-bracket sport UI (pool/heats/points-based)

---

## Coding Standards

### Backend
- Explicit logic (no hidden behavior)
- Small, testable functions
- No side effects unless intentional

### Frontend
- Functional components
- Keep components small and reusable

---

## Decision Rules

When making changes:

1. Check SRS
2. Check database schema
3. Follow existing patterns
4. Do not introduce new architecture without justification

---

## Guiding Principles

- Keep the system simple
- Avoid premature abstraction
- Prefer clarity over cleverness
- Optimize for iteration speed

---

## Summary

This system is:
- A sports competition tracker
- Built on simple, normalized data models
- Driven by deterministic backend logic

Keep it simple.
