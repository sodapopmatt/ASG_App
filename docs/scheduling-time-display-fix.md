# Scheduling & Time Display Fix

**Commit:** `5a92241`

## Background

Match times in this system are tracked two ways:

- `scheduled_at` — stored in the database at bracket generation time. Can become stale if the schedule is reworked after generation.
- `estimated_start` — computed dynamically at read time by a two-pass algorithm in `_compute_estimated_starts` (matches.py). Always reflects the current court availability and feeder match finish times. Never stored.

The frontend should always prefer `estimated_start` and fall back to `scheduled_at` only when no dynamic time is available.

---

## Bugs Fixed

### 1. Bracket visualization showing wrong times for Round 2+

**File:** `frontend/src/lib/bracketHelpers.tsx:79`

`toLibraryMatch` was building the bracket card's `startTime` using `scheduled_at ?? estimated_start`. After a schedule rework, Round 2+ slots retained old stale `scheduled_at` values (e.g. 2:02 PM) that were earlier than the dynamically correct Round 1 times (2:10–2:20 PM).

**Fix:** Swapped priority to `estimated_start ?? scheduled_at`.

---

### 2. Schedule page wrong sort order and hidden times

**File:** `frontend/src/pages/Schedule.tsx`

Two issues in the schedule page:

- `groupBySportAndRound` was sorting matches by `scheduled_at` only, so stale Round 2 times sorted before Round 1.
- `MatchRow` had `showTime = match.status !== 'scheduled'`, which hid the time column for all upcoming matches. It also sourced time from `scheduled_at` only.

**Fix:** Sort by `estimated_start ?? scheduled_at`. Always show `estimated_start ?? scheduled_at` in the time column — removed the status gate entirely.

---

### 3. All matches in a bracket showing the same estimated_start

**File:** `backend/app/routers/matches.py:175`

This was the root cause of multiple R1 matches displaying the same time.

`_attach_estimated_starts` builds a `heats_bracket_ids` set to identify heats brackets, where all teams compete simultaneously and share one time slot (e.g. Relay Race heats). The logic was:

```python
heats_bracket_ids = {
    b["id"] for b in brackets
    if b.get("phase") in ("heats", "bracket", "finals")
}
```

The problem: single elimination brackets also use `phase = "bracket"`. So every single elimination bracket was incorrectly treated as a concurrent heats bracket. Pass 1 would compute an `estimated_start` for the first match in the bracket, then reuse that same time for every subsequent match — completely bypassing the per-court stagger logic.

**Fix:** Added `bracket_type` to the sports fetch and `sport_id` to the brackets fetch, then scoped the concurrent treatment to sports with `bracket_type = "heats"`:

```python
heats_bracket_ids = {
    b["id"] for b in brackets
    if b.get("phase") in ("heats", "bracket", "finals")
    and b.get("sport_id") in heats_sport_ids
}
```

---

## How estimated_start is computed

**Pass 1 — per-court ripple:** Groups matches by `location_id`, sorts by `scheduled_at`, and ripples `court_free_at` forward so same-court matches never overlap.

**Pass 2 — feeder adjustment:** For each TBD match, `estimated_start` is pushed to at least the finish time of both upstream feeder matches. Processed in round order so feeders are always resolved before their downstream matches.

Both passes run on every `GET /matches` and `GET /matches/{id}` request so the schedule stays accurate as results come in.
