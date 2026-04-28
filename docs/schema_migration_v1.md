# Schema Migration Plan — Aerospace Summer Games V1

Status: COMPLETE

## Applied

- companies.short_id added and populated
- locations table created
- matches.location_id added
- matches.status includes forfeit
- event_points UNIQUE(company_id, sport_id) enforced
- roster_entries table created and in use

## Cleanup Completed

- players table removed (or not present in current environment)
- team_rosters table removed (or not present in current environment)
- match score columns (home_score, away_score) removed

## Notes

- Application code is fully aligned with the V1 schema
- No deprecated tables or columns remain in active use
- Scoring is derived-only (no manual write paths)
- Matches are winner-only (no score dependency)

## Migration Guidance

This migration plan is complete.

Do not re-run or reapply any V1 migration steps unless initializing a new environment from scratch.