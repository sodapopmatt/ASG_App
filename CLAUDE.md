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
- `scoring_mode` (TEXT) — `placement` (default; admin awards via `/event-points/award-placement`) | `donation_count` (admin enters per-company item counts via `/donation-counts`; points derived: top=15, second=10, ≥10 items=5, else=0; ties share points)
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

## Bracket System

### Supported Types
| bracket_type | Auto-Generated | Frontend Support |
|---|---|---|
| `single_elimination` | Yes | Full |
| `double_elimination` | Yes | Full |
| `pool_bracket` | Yes — pools + seeded bracket phase | Full — pool setup, standings, results entry, bracket view |
| `pool_swiss` | Pools only (Swiss rounds manual) | Partial — pool UI works; no Swiss round UI |
| `heats` | Yes — flat (one entry per team) OR grouped multi-phase (one bracket per heat) | Full for Relay Race (multi-phase: prelims → semis → final); flat for Human Pyramid |
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
- **Relay Race custom scoring scale:** 1st–6th: 40/38/36/34/32/30; 7th–12th: 22 each; 13th–18th: 12 each; 19th+: 4 each; forfeit/DQ: 0
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
- Result retraction supported if downstream matches haven't started
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
| Water Ball Toss | points_based | 5 | high_wins | average_score | ASG default |
| Canned Food Drive | points_based | 1 | high_wins | best_placement | n/a (uses `scoring_mode='donation_count'`) |

ASG default scale: 1st = 40, 2nd = 38, 3rd = 36, −2 per place (floor 0). SQL: `asg_points(placement INTEGER)`.

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
| DELETE | `/{id}` | admin | Delete |

### Event Points — `/event-points`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | public | List; filters: `company_id`, `sport_id` |
| POST | `/award-placement` | admin | Award placement to company; upserts record; applies points_scale. Optional `tied_through` shares a placement: points = average of the tied places' values (e.g., tied 3rd/4th → 35 each) |

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

## Frontend Pages

| Page | Route | What it does |
|---|---|---|
| Schedule | `/schedule` | All matches grouped by sport+round or timeline view. Does NOT vary by `bracket_type`. |
| BracketsPage | `/manage/brackets` | Generate elimination brackets, set scheduling config, manually adjust match times. Labels non-generatable sports as "Manual entry". |
| SportConfigPage | `/manage/brackets/:sportId` | Per-sport config: scheduling, courts, bracket/pool generation; pool sports get pool setup (snake auto-split + overrides) and a post-pool "Generate Bracket Phase" card seeded from standings. |
| ResultsPage | `/manage/results` | Lists pending matches; links to bracket visualization for elimination sports, pool results for pool sports, heats entry for heats. |
| PoolResultsPage | `/manage/results/pools/:sportId` | Pool matches grouped by pool+round; tap to enter result via shared MatchResultModal; links to bracket phase view. |
| ScoringPage | `/manage/scoring` | Sport card list (tap to drill in). For standard sports: award placement per company. For Relay Race: auto-computes placements from heat results with editable overrides; calls `/event-points/award-placement`. |
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
- Scoring is derived from placements (not manual edits)
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
