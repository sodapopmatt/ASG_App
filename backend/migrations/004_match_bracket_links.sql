-- Add round tracking and bracket advancement links to matches.
-- Self-referential FKs use ON DELETE SET NULL so deleting matches doesn't break the chain.

ALTER TABLE matches
    ADD COLUMN match_round           INTEGER,
    ADD COLUMN winner_next_match_id  UUID REFERENCES matches(id) ON DELETE SET NULL,
    ADD COLUMN loser_next_match_id   UUID REFERENCES matches(id) ON DELETE SET NULL;

CREATE INDEX ON matches (winner_next_match_id) WHERE winner_next_match_id IS NOT NULL;
CREATE INDEX ON matches (loser_next_match_id)  WHERE loser_next_match_id  IS NOT NULL;
