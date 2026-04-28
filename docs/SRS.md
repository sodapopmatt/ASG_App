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
- Notifications
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

- Admins shall assign:
  - match start time
  - location
- The system shall:
  - not require match duration
  - not auto-generate schedules
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
- Not Started
- In Progress
- Completed
- Forfeit

- Only admins may change match status
- Starting a match sets status to In Progress
- Submitting a result sets status to Completed

---

### 4.7 Results Entry

- Admins shall enter results by selecting a winning team
- Numeric scores are not required
- Forfeits:
  - opponent automatically wins
  - forfeiting team does not advance

---

### 4.8 Bracket Management

- The system shall support:
  - single elimination
  - double elimination
- The system shall:
  - automatically advance winners
  - route losers appropriately (double elimination)
- Brackets shall update automatically after results are entered

---

### 4.9 Non-Bracket Events

The system shall support:
- placement-based events
- score-based events
- custom scoring events

Admins shall:
- enter placements or raw scores manually

The system shall:
- compute rankings automatically
- apply scoring rules per sport

---

### 4.10 Scoring System

- Scoring shall be assigned at the company level
- A company shall receive only one placement per sport

If multiple teams from the same company place:
- only the highest placement shall count
- lower placements from the same company shall be ignored
- the next highest team from a different company shall determine the next placement

- Points shall be assigned based on:
  - default ASG scale (40, 38, 36, ...)
  - or sport-specific custom scale

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
- The system shall store per-sport point contributions
- The leaderboard shall update automatically when results are entered

---

### 4.12 UI / Views

#### Global Views
- Full-day schedule (all sports)
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

## 5. Data Requirements

Key entities:
- companies
- sports
- teams
- roster_entries
- matches
- brackets
- event_points
- locations

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
- No notifications
- No gender rules
- No player validation
- No archive/deactivation
- No event modes

---

## 10. Open Items

- Leaderboard tie-breaker logic TBD

---

## 11. Preset Companies

(Short IDs must follow: ^[A-Z0-9\-]+$)

[List of companies here — use your cleaned version]

---

## 12. Preset Sports

- Basketball
- Cornhole
- Dodgeball
- Human Pyramid
- Pickleball
- Relay Race
- Soccer
- Tug of War
- Ultimate Frisbee
- Volleyball
- Water Ball Toss
- Canned Food Drive

Each sport shall define:
- bracket type
- teams per company
- scoring rule