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
- `name`
- `short_id`

---

### sports
- `id`
- `name`
- `bracket_type`
- configuration fields (data-driven)

---

### teams
- `id`
- `company_id`
- `sport_id`
- `name`

---

### roster_entries
- `id`
- `team_id` (FK → teams.id)
- `player_name` (TEXT)

---

### matches
- `id`
- `sport_id`
- `home_team_id`
- `away_team_id`
- `winner_id` (nullable FK → teams.id)
- `status`
- `location_id`
- `scheduled_at`

---

### event_points
- `company_id`
- `sport_id`
- `points`
- `placement`

---

## Bracket System

### Supported Types
- `single_elimination`
- `double_elimination`
- `pool_bracket`
- `pool_swiss`
- `heats`
- `points_based`

### Rules
- Only elimination brackets are auto-generated
- Other formats are manually created
- Match advancement happens automatically after result submission

---

## API Behavior

### Submit Match Result
`POST /matches/{id}/result`

- Sets `winner_id`
- Sets status = `completed`
- Advances teams automatically
- Updates downstream matches

---

### Submit Forfeit
`POST /matches/{id}/forfeit`

- Accepts `forfeiting_team_id`
- Sets opponent as `winner_id`
- Sets status = `forfeit`
- Advances bracket

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