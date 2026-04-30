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

---

#### Scores
- Scores do not exist in V1
- No score-based logic anywhere

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
- `home_score`
- `away_score`

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
- `match_duration_minutes` (INT, nullable)
- `schedule_start` (TIMESTAMPTZ, nullable)

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

---

### matches
- `id` (UUID)
- `sport_id` (UUID, FK → sports)
- `bracket_id` (UUID, FK → brackets, nullable)
- `home_team_id` (UUID, FK → teams, nullable)
- `away_team_id` (UUID, FK → teams, nullable)
- `location_id` (UUID, FK → locations, nullable)
- `winner_id` (UUID, FK → teams, nullable)
- `winner_next_match_id` (UUID, self-ref → matches, nullable)
- `loser_next_match_id` (UUID, self-ref → matches, nullable)
- `status` (TEXT) — see locked decisions above
- `match_round` (INT, nullable)
- `scheduled_at` (TIMESTAMPTZ, nullable)
- `actual_start` (TIMESTAMPTZ, nullable) — set by `/matches/{id}/start`
- `played_at` (TIMESTAMPTZ, nullable) — set when result submitted
- `notes` (TEXT, nullable)

---

### event_points
- `company_id` (UUID, FK → companies)
- `sport_id` (UUID, FK → sports)
- `placement` (INT)
- `points` (INT)
- UNIQUE(company_id, sport_id)

---

## Bracket System

### Supported Types
| bracket_type | Auto-Generated | Frontend Support |
|---|---|---|
| `single_elimination` | Yes | Full |
| `double_elimination` | Yes | Full |
| `pool_bracket` | No (manual) | Partial — matches render on schedule, no pool UI |
| `pool_swiss` | No (manual) | Partial — matches render on schedule, no standings UI |
| `heats` | No (manual) | Partial — matches render on schedule, no heat progression UI |
| `points_based` | N/A — no matches | Partial — placement entry via Scoring page only |

### Auto-Generation Rules (elimination only)
- `single_elimination`: standard seeding (1 vs N, 2 vs N-1), byes for non-power-of-2
- `double_elimination`: winners bracket + losers bracket + grand final; WB losers drop to LB on schedule
- Court assignment is done at generation time using subtree grouping (WB) and round-robin (LB)
- Grand final gets no pre-assigned court; inherits from first semifinal winner

### Match Advancement
- Happens automatically after result or forfeit submission
- `advance_winner()` slots winner into `winner_next_match_id`
- `loser_next_match_id` used for double elimination only
- Result retraction supported if downstream matches haven't started
- `settle_bracket()` called after every result to check if all matches are resolved

### Scheduling
- `match_duration_minutes`, `schedule_start` are stored on the sport
- Court count is derived from the sport's named `locations` rows — not stored as an integer
- `estimated_start` is computed per-court dynamically at read time (GET /matches) — not stored
- `actual_start` anchors a court's timeline when a match is marked in_progress

---

## Preset Sport Configurations

| Sport | bracket_type | teams_per_company | scoring_direction | multi_team_rule | points_scale |
|---|---|---|---|---|---|
| Volleyball | double_elimination | 1 | high_wins | best_placement | ASG default |
| Basketball | double_elimination | 1 | high_wins | best_placement | ASG default |
| Dodgeball | double_elimination | 3 | high_wins | best_placement | ASG default |
| Soccer | single_elimination | 1 | high_wins | best_placement | ASG default |
| Tug of War | single_elimination | 1 | high_wins | best_placement | ASG default |
| Ultimate Frisbee | pool_bracket | 1 | high_wins | best_placement | ASG default |
| Pickleball | pool_swiss | 2 | high_wins | best_placement | ASG default |
| Cornhole | pool_swiss | 4 | high_wins | best_placement | ASG default |
| Relay Race | heats | 1 | high_wins | best_placement | ASG default |
| Human Pyramid | heats | 1 | low_wins | best_placement | ASG default |
| Water Ball Toss | points_based | 5 | high_wins | average_score | ASG default |
| Canned Food Drive | points_based | 1 | high_wins | best_placement | `{"1":15,"2":10,"default":5}` |

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
| POST | `/{id}/generate-bracket` | admin | Generate elimination bracket; accepts `team_ids`, `clear_existing`, `location_ids` |
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
| DELETE | `/{id}` | admin | Delete |

### Event Points — `/event-points`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | public | List; filters: `company_id`, `sport_id` |
| POST | `/award-placement` | admin | Award placement to company; upserts record; applies points_scale |

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

### Locations — `/locations`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | public | List; filter: `sport_id` |
| POST | `/` | admin | Create location for a sport |
| DELETE | `/{id}` | admin | Delete location |

---

## Frontend Pages

| Page | Route | What it does |
|---|---|---|
| Schedule | `/schedule` | All matches grouped by sport+round or timeline view. Does NOT vary by `bracket_type`. |
| BracketsPage | `/manage/brackets` | Generate elimination brackets, set scheduling config, manually adjust match times. Labels non-generatable sports as "Manual entry". |
| ResultsPage | `/manage/results` | Lists pending matches; links to bracket visualization for elimination sports. |
| ScoringPage | `/manage/scoring` | Award placements to companies per sport; calls `/event-points/award-placement`. |
| TeamsPage | `/manage/teams` | Create/edit/delete teams, grouped by sport+company. |
| ManageHub | `/manage` | Navigation hub for admin pages. |

---

## API Behavior

### Submit Match Result
`POST /matches/{id}/result`

- Sets `winner_id`
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
- Only valid for elimination brackets

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

- No round-robin scheduling engine
- No third-party bracket integrations
- No player account system
- No manual scoring UI
- No notification system
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
