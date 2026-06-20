# Aerospace Summer Games Platform
## System Requirements Specification (SRS)

---

## 1. Overview

### 1.1 Purpose
The Aerospace Summer Games Platform is a Progressive Web App (PWA) designed to manage and display a one-day competitive event where aerospace companies compete across multiple sports. The system enables organizers to manage teams, schedules, results, and scoring, while providing real-time visibility to participants and spectators.

---

### 1.2 Scope
The system supports:
- One event: Aerospace Summer Games 2026
- Company-based competition across multiple sports
- Real-time schedule, results, brackets, and leaderboard updates
- Role-based access for admins and team managers
- Public, read-only access for attendees

The system does not support:
- Multiple events or years
- Push notifications (web push / OS-level); in-app banner alerts are supported — see 4.13
- Player eligibility enforcement
- Gender rules
- Advanced scheduling automation
- Manual scoring overrides

---

## 2. Actors

| Actor | Description |
|------|-------------|
| Admin | Organizer or referee with full system control |
| Team Manager | Manages rosters for a single company |
| Public User | Read-only viewer (no login required) |

---

## 3. System Architecture (High-Level)

- Frontend: React + Vite (PWA)
- Backend: FastAPI
- Database/Auth: Supabase (Postgres + RLS)
- Hosting: Vercel (frontend), Railway (backend)

---

## 4. Functional Requirements

---

### 4.1 Authentication & Roles

- Public users shall access all read-only data without authentication.
- Admin users shall have full system access.
- Team managers shall:
  - Be associated with exactly one company
  - Manage rosters for that company only
  - Not modify results, schedules, scoring, or system structure

---

### 4.2 Companies

- The system shall include a predefined list of companies.
- Each company shall include:
  - full name
  - short identifier (`short_id`)
- The system shall:
  - enforce uniqueness of `short_id`
  - restrict `short_id` to uppercase alphanumeric characters and hyphens only
  - not allow spaces or special characters
- The system shall use:
  - `short_id` in compact UI contexts (e.g., brackets)
  - full name in leaderboard and detailed views
- Companies shall not be deletable once associated with data.

---

### 4.3 Sports

- The system shall include predefined sports.
- Admins shall be able to:
  - create new sports
  - edit sport configuration
- Sports shall include:
  - bracket type
  - teams per company
  - scoring rule
- Sports shall not be deletable once used.

---

### 4.4 Teams & Rosters

- Teams shall be created by admins only.
- Team managers shall:
  - edit rosters for teams within their company
- Rosters shall:
  - consist of simple text-based player names
  - not enforce uniqueness
  - not enforce eligibility rules
  - not track user accounts

---

### 4.5 Scheduling

- Admins shall be able to assign:
  - match start time
  - location
- The system shall:
  - require match duration per sport
  - auto-generate schedules for elimination brackets at generation time
  - compute `estimated_start` dynamically at read time (not stored) using two passes:
    1. Per-court ripple — shifts matches forward when their court is still busy
    2. Feeder adjustment — ensures a match cannot start before both of its upstream feeder matches have finished, regardless of which court they are on
- The system shall warn when:
  - two matches are scheduled at the same location at the same time

---

### 4.6 Matches & Status

Each match shall include:
- sport
- participating teams
- start time
- location
- status
- result

Match statuses:
- `scheduled` — match is created and has a time/location
- `in_progress` — match has started (`actual_start` timestamp set)
- `completed` — winner recorded
- `forfeit` — one team forfeited; opponent wins and advances
- `double_forfeit` — both teams forfeited; no winner; no advancement

- Only admins may change match status
- Starting a match sets status to `in_progress`
- Submitting a result sets status to `completed`

---

### 4.7 Results Entry

- Admins shall enter results by selecting a winning team
- Numeric scores are not required
- Forfeits:
  - opponent automatically wins
  - forfeiting team does not advance
- Double forfeits:
  - no winner; neither team advances
- Result retraction is allowed if no downstream matches have started

---

### 4.8 Bracket Management

- The system shall support auto-generation for:
  - `single_elimination`
  - `double_elimination`
- The system shall:
  - automatically advance winners to next match
  - route losers to the losers bracket (double elimination only)
  - dynamically assign courts to winner's next match after result posted
  - mark a bracket settled when all matches are resolved
- Brackets shall update automatically after results are entered
- `pool_bracket` and `pool_swiss` sports support auto-generated round-robin pool play (see 4.9); `points_based` sports have no matches

#### Seeding Rule
- No two teams from the same company shall be placed in the same Winners Bracket Round 1 matchup
- Same-company matchups in later rounds (WB R2+) and in the Losers Bracket are accepted as structurally inevitable when companies field multiple teams
- This constraint is enforced at bracket generation time via exhaustive greedy seeding

---

### 4.9 Non-Bracket Events

The system shall support the following non-elimination sport structures:

| Type | Behavior |
|------|----------|
| `pool_bracket` | Auto-generated round-robin pool play, followed by an admin-triggered single-elimination bracket phase seeded from pool standings |
| `pool_swiss` | Auto-generated round-robin pool play; Swiss championship rounds not yet supported (manual match creation) |
| `heats` | Timed/sequential heats; `notes` field used for heat metadata |
| `points_based` | No match structure; placement awarded directly via scoring workflow |

#### Pool Play
- Admins assign teams to named pools (auto snake-split with manual override in the UI); each pool plays a single round robin generated via the circle method
- Each pool is stored as a `brackets` row with `phase = 'pool'`; pool matches have no advancement links
- Pool standings (`GET /sports/{id}/standings`) are computed from terminal matches: completed/forfeit = win for `winner_id`, loss for the opponent; double forfeit = loss for both
- Standings rank by wins desc, then losses asc; teams with identical records share a rank — **no score-based tiebreakers exist in V1** (no scores in the data model); admins resolve ties from paper score sheets when seeding the bracket phase
- For `pool_bracket` sports, the admin triggers the bracket phase after pool play: the advancing list is pre-filled from standings (pool winners first, then runners-up, …), the admin reorders to break ties, and a single-elimination bracket is generated with the seed order preserved (no random shuffle); pool matches are kept

Admins shall:
- enter placements manually via the Scoring page
- create individual matches manually for heats sports and for Swiss championship rounds

The system shall:
- apply scoring rules per sport when placement is submitted
- compute rankings automatically from placements

**Frontend status:** Pool sports have full UI (pool setup + generation, results entry grouped by pool, public standings tables, bracket-phase generation and rendering). Heats and points-based sports do not yet have dedicated UI beyond heats result entry. The Schedule page renders all sports identically regardless of bracket type.

---

### 4.10 Scoring System

- Scoring shall be assigned at the company level
- A company shall receive only one placement per sport
- The system shall enforce `UNIQUE(company_id, sport_id)` on `event_points`

**Scoring direction** (`scoring_direction`):
- `high_wins` — higher score / faster time wins (most sports)
- `low_wins` — lower score wins (e.g., Human Pyramid: lower time is better)

**Multi-team rule** (`multi_team_rule`) — applies when a company enters multiple teams:
- `best_placement` — only the best-placing team's result counts
- `average_score` — average across all company teams (Water Ball Toss)

**Points scale** (`points_scale`):
- Default ASG scale: 1st = 40, 2nd = 38, 3rd = 36, then −2 per place (floor 0)
- Implemented as SQL function `asg_points(placement INTEGER)`
- Sports may override with a custom JSONB scale, e.g. `{"1": 15, "2": 10, "default": 5}`

- Company scoring shall:
  - always be derived from raw results
  - not be manually editable

---

### 4.11 Leaderboard

- The system shall provide a live leaderboard
- The leaderboard shall display:
  - company name
  - total points
  - rank
- The system shall store per-sport point contributions in `event_points`
- The leaderboard is computed via SQL RPC function `get_leaderboard()`

---

### 4.12 UI / Views

#### Global Views
- Full-day schedule (all sports, all matches)
- Leaderboard

Schedule shall display:
- sport
- teams
- time
- location
- status

---

#### Sport-Specific Pages

Each sport page shall display:
- bracket or event structure
- schedule for that sport
- raw team results
- company scoring results

The system shall clearly distinguish:
- team placement
- company scoring

---

#### Admin Dashboard

Admins shall be able to:
- manage schedule
- start and complete matches
- enter results
- manage sports, teams, and companies
- generate brackets

The system shall support quick actions:
- Start Match
- Complete Match
- Select Winner
- Mark Forfeit

---

#### Team Manager Dashboard

Team managers shall:
- view all teams for their company
- edit rosters
- view schedule and results (read-only)

---

### 4.13 Broadcast Alerts

- Admins shall be able to issue broadcast alert messages that appear as a dismissable banner across the app for all users.
- Each alert shall include:
  - `message` (1–500 chars)
  - `severity` (`info` | `warning` | `critical`)
  - `active` flag
  - optional `expires_at` timestamp (alerts auto-hide once past this time)
- Only admins may create, edit, deactivate, or delete alerts.
- Public clients shall fetch active, non-expired alerts via `GET /alerts/active` and the frontend shall poll this endpoint every 30 seconds.
- Dismissals are client-side only (stored in `localStorage`) so an alert remains visible on other devices/sessions until deactivated or expired.
- This is an in-app banner only — no web push or OS-level notifications.

---

## 5. Data Requirements

### companies
- `id` (UUID, PK)
- `name` (TEXT, UNIQUE)
- `short_id` (TEXT, UNIQUE, NOT NULL, format `^[A-Z0-9-]+$`)
- `logo_url` (TEXT, nullable)
- `created_at` (TIMESTAMPTZ)

### sports
- `id` (UUID, PK)
- `name` (TEXT, UNIQUE)
- `bracket_type` (TEXT) — `single_elimination` | `double_elimination` | `pool_bracket` | `pool_swiss` | `heats` | `points_based`
- `teams_per_company` (INT, default 1)
- `scoring_direction` (TEXT, default `high_wins`) — `high_wins` | `low_wins`
- `multi_team_rule` (TEXT, default `best_placement`) — `best_placement` | `average_score`
- `points_scale` (JSONB, nullable) — custom override; NULL = ASG default
- `match_duration_minutes` (INT, nullable) — used for auto-scheduling
- `concurrent_courts` (INT, nullable) — courts available in parallel
- `schedule_start` (TIMESTAMPTZ, nullable) — when bracket scheduling begins
- `created_at` (TIMESTAMPTZ)

### teams
- `id` (UUID, PK)
- `company_id` (UUID, FK → companies)
- `sport_id` (UUID, FK → sports)
- `name` (TEXT, optional display name)
- `created_at` (TIMESTAMPTZ)

### roster_entries
- `id` (UUID, PK)
- `team_id` (UUID, FK → teams)
- `player_name` (TEXT)
- `created_at` (TIMESTAMPTZ)

### brackets
- `id` (UUID, PK)
- `sport_id` (UUID, FK → sports)
- `name` (TEXT) — e.g., "Winners Bracket", "Pool A"
- `phase` (TEXT) — `pool` | `bracket` | `heats` | `finals`
- `created_at` (TIMESTAMPTZ)

### matches
- `id` (UUID, PK)
- `sport_id` (UUID, FK → sports)
- `bracket_id` (UUID, FK → brackets, nullable)
- `home_team_id` (UUID, FK → teams, nullable)
- `away_team_id` (UUID, FK → teams, nullable)
- `location_id` (UUID, FK → locations, nullable)
- `winner_id` (UUID, FK → teams, nullable)
- `winner_next_match_id` (UUID, self-ref FK → matches, nullable) — where winner advances
- `loser_next_match_id` (UUID, self-ref FK → matches, nullable) — where loser drops (double elim)
- `status` (TEXT) — `scheduled` | `in_progress` | `completed` | `forfeit` | `double_forfeit`
- `match_round` (INT, nullable)
- `scheduled_at` (TIMESTAMPTZ, nullable)
- `actual_start` (TIMESTAMPTZ, nullable) — set when match is marked in_progress
- `played_at` (TIMESTAMPTZ, nullable) — set when result is submitted
- `notes` (TEXT, nullable)
- `created_at` (TIMESTAMPTZ)

### event_points
- `id` (UUID, PK)
- `company_id` (UUID, FK → companies)
- `sport_id` (UUID, FK → sports)
- `placement` (INT)
- `points` (INT, default 0)
- `notes` (TEXT, nullable)
- `created_at` (TIMESTAMPTZ)
- UNIQUE(company_id, sport_id)

### locations
- `id` (UUID, PK)
- `name` (TEXT)

### alerts
- `id` (UUID, PK)
- `message` (TEXT, 1–500 chars)
- `severity` (TEXT) — `info` | `warning` | `critical`
- `active` (BOOLEAN, default true)
- `expires_at` (TIMESTAMPTZ, nullable)
- `created_by` (UUID, nullable, FK → auth.users)
- `created_at` (TIMESTAMPTZ)

### user_profiles
- `id` (UUID, PK, FK → auth.users)
- `company_id` (UUID, FK → companies, nullable)
- `role` (TEXT) — `player` | `team_manager` | `admin`
- `full_name` (TEXT, nullable)
- `created_at` (TIMESTAMPTZ)

Constraints:
- records shall not be deletable once used
- scoring shall be derived from results only

---

## 6. Real-Time Behavior

- The system shall update:
  - match status
  - results
  - leaderboard
  - brackets
- Updates shall occur without page refresh

---

## 7. Performance Requirements

- The system shall support:
  - ~8,000 concurrent read-only users
  - ~50 authenticated users
  - ~15 concurrent admins

- The system shall:
  - prioritize read scalability
  - ensure consistent writes

---

## 8. Data Integrity

- Match updates shall be transactional
- The system shall:
  - prevent conflicting updates
  - store update timestamps
- Scoring shall be derived from results (single source of truth)

---

## 9. Constraints & Assumptions

- Single event (2026 only)
- No push notifications (in-app banner alerts only — see 4.13)
- No gender rules
- No player validation
- No archive/deactivation
- No event modes

---

## 10. Open Items

- Leaderboard tie-breaker logic TBD
- Pool standings tie-breakers are manual (no scores in V1 — admin resolves from score sheets when seeding the bracket phase)
- Swiss championship round generation (Cornhole) not yet built
- Heats progression / Points-based sport management UI not yet built

---

## 11. Preset Companies

(Short IDs must follow: ^[A-Z0-9\-]+$)

[List of companies here — use your cleaned version]

---

## 12. Preset Sports

| Sport | Bracket Type | Teams/Company | Scoring Direction | Multi-Team Rule | Points Scale |
|---|---|---|---|---|---|
| Volleyball | double_elimination | 1 | high_wins | best_placement | ASG default |
| Basketball | double_elimination | 1 | high_wins | best_placement | ASG default |
| Dodgeball | double_elimination | 3 | high_wins | best_placement | ASG default |
| Soccer | single_elimination | 1 | high_wins | best_placement | ASG default |
| Tug of War | single_elimination | 1 | high_wins | best_placement | ASG default |
| Ultimate Frisbee | pool_bracket | 1 | high_wins | best_placement | ASG default |
| Pickleball | pool_bracket | 2 | high_wins | best_placement | ASG default |
| Cornhole | pool_swiss | 4 | high_wins | best_placement | ASG default |
| Relay Race | heats | 1 | high_wins | best_placement | ASG default |
| Human Pyramid | heats | 1 | low_wins | best_placement | ASG default |
| Water Ball Toss | points_based | 5 | high_wins | average_score | ASG default |
| Canned Food Drive | points_based | 1 | high_wins | best_placement | `{"1":15,"2":10,"default":5}` |

Each sport defines:
- bracket type (determines match structure and generation method)
- teams per company (how many separate teams one company fields)
- scoring direction (high_wins or low_wins)
- multi-team rule (how to resolve a company's score when they have multiple teams)
- points scale (custom override or ASG default)

---

## 13. Implementation Status

### Fully Built
- Single and double elimination bracket generation, advancement, result/forfeit/double-forfeit entry
- Seeding constraint: no same-company matchups in WB Round 1 (exhaustive greedy scan)
- Scheduling config (`match_duration_minutes`, `concurrent_courts`, `schedule_start`) and `estimated_start` computation (two-pass: court ripple + feeder adjustment)
- Court label shown on bracket match slots alongside scheduled time
- Placement-based scoring (ScoringPage + `/event-points/award-placement`)
- Teams, companies, and roster management
- Leaderboard (SQL RPC `get_leaderboard()`)
- Auth (Supabase) with admin / team_manager / public roles
- Match retraction if downstream matches haven't started

### Fully Built (continued)
- Pool play: round-robin generation per pool, W-L standings endpoint, pool results entry UI, public standings tables, and seeded single-elimination bracket phase for `pool_bracket` sports

### Partially Built / Admin Workaround Available
- Swiss championship rounds (`pool_swiss`, Cornhole) — pool play is generated; championship matches must be manually created via POST `/matches`
- Heats — matches can be manually created; `notes` field used for heat metadata; no progression UI
- Points-based — placement can be awarded via Scoring page; no match structure or score entry UI

### Not Yet Built
- Swiss round pairing/generation
- Heat assignment and result tracking UI
- Points-based event score entry UI
- Sport-type-aware visualization on the Schedule page (all sports render identically today)
- Real-time push updates (frontend currently requires manual refresh or polling)
