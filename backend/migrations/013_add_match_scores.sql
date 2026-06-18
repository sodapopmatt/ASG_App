-- Migration 013: Add optional match scores
--
-- Context:
--   V1 originally tracked match outcomes via winner_id only (scores were
--   removed in migration 005). Scores are now reintroduced as supplementary
--   data: the admin still explicitly selects the winner — scores do NOT
--   auto-derive the outcome. Both columns are nullable; forfeits and
--   double-forfeits leave them NULL.
--
-- This migration is idempotent (IF NOT EXISTS guards).
-- Run inside the Supabase SQL editor or via psql.

BEGIN;

ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS home_score INT,
    ADD COLUMN IF NOT EXISTS away_score INT;

COMMIT;
