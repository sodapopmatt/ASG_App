-- Migration 005: Remove deprecated players/team_rosters tables and score columns
--
-- Context:
--   The V1 data model uses roster_entries (player_name TEXT) instead of a
--   players table + team_rosters join table.  home_score/away_score were
--   replaced by winner_id for match outcomes.  All app code referencing these
--   objects was removed in Phase 3 before this migration was written.
--
-- Safe to run when:
--   1. All app code references to players, team_rosters, home_score, away_score
--      have been removed and deployed.
--   2. Any existing data in players/team_rosters has been migrated or is
--      intentionally discarded.
--
-- This migration is idempotent (IF EXISTS guards on every statement).
-- Run inside the Supabase SQL editor or via psql.

BEGIN;

-- ─── 1. Drop team_rosters first (it holds the FK → players) ──────────────────
-- RLS policies on this table are dropped automatically with the table.
DROP TABLE IF EXISTS team_rosters;

-- ─── 2. Drop players ─────────────────────────────────────────────────────────
-- RLS policies on this table are dropped automatically with the table.
-- The players.user_id FK to auth.users is also dropped with the table.
DROP TABLE IF EXISTS players;

-- ─── 3. Remove deprecated score columns from matches ─────────────────────────
-- Columns are nullable NUMERIC; no indexes reference them.
-- The DB columns are dropped; the data is permanently removed.
ALTER TABLE matches
    DROP COLUMN IF EXISTS home_score,
    DROP COLUMN IF EXISTS away_score;

COMMIT;
