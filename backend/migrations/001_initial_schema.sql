-- Run this in the Supabase SQL editor.

-- ─── Core Tables ─────────────────────────────────────────────────────────────

CREATE TABLE companies (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    logo_url    TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- bracket_type drives how the app generates and advances brackets.
-- teams_per_company: how many teams one company may enter in this sport.
CREATE TABLE sports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL UNIQUE,
    bracket_type        TEXT NOT NULL CHECK (bracket_type IN (
                            'double_elimination', 'single_elimination',
                            'pool_bracket', 'pool_swiss', 'heats', 'points_based'
                        )),
    teams_per_company   INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- A team is one company's entry in one sport.
-- A company may have multiple teams in a sport (e.g. Dodgeball: 3).
CREATE TABLE teams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sport_id    UUID NOT NULL REFERENCES sports(id)    ON DELETE CASCADE,
    name        TEXT,   -- e.g. "Dodgeball Team B"
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Players belong to a company; gender is tracked for roster compliance.
CREATE TABLE players (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    email       TEXT,
    gender      TEXT CHECK (gender IN ('male', 'female', 'non_binary', 'other')),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Which players are on which team's roster.
CREATE TABLE team_rosters (
    team_id    UUID NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
    player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, player_id)
);

-- Brackets are organizational groupings within a sport (e.g. "Pool A", "Winners Bracket").
-- phase: pool | bracket | heats | finals
CREATE TABLE brackets (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sport_id   UUID NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    phase      TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- A match is a single game/heat between two teams.
-- home_score/away_score are NUMERIC to handle times (seconds) and decimal scores.
CREATE TABLE matches (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sport_id      UUID NOT NULL REFERENCES sports(id),
    bracket_id    UUID          REFERENCES brackets(id) ON DELETE SET NULL,
    home_team_id  UUID          REFERENCES teams(id),
    away_team_id  UUID          REFERENCES teams(id),
    home_score    NUMERIC,
    away_score    NUMERIC,
    winner_id     UUID          REFERENCES teams(id),
    status        TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'in_progress', 'completed')),
    scheduled_at  TIMESTAMPTZ,
    played_at     TIMESTAMPTZ,
    notes         TEXT,   -- free-form: times, heat numbers, etc.
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT different_teams CHECK (
        home_team_id IS NULL OR away_team_id IS NULL OR home_team_id <> away_team_id
    )
);

-- Final scoring record: one row per (company, sport).
-- Points are assigned at the company level; if a company has multiple teams,
-- only the best-placing team's points are recorded here (enforced by app logic).
CREATE TABLE event_points (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sport_id    UUID    NOT NULL REFERENCES sports(id)    ON DELETE CASCADE,
    placement   INTEGER,         -- 1st, 2nd, 3rd, …
    points      INTEGER NOT NULL DEFAULT 0,
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id, sport_id)
);

-- Extends Supabase auth.users with role and company association.
CREATE TABLE user_profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id  UUID REFERENCES companies(id),
    role        TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'manager')),
    full_name   TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX ON teams (company_id, sport_id);
CREATE INDEX ON matches (sport_id, status);
CREATE INDEX ON matches (bracket_id);
CREATE INDEX ON event_points (company_id);

-- ─── Leaderboard Function ────────────────────────────────────────────────────
-- Returns total points per company by summing event_points.
-- event_points is the authoritative record; brackets/matches feed into it.
CREATE OR REPLACE FUNCTION get_leaderboard()
RETURNS TABLE (
    company_id    UUID,
    company_name  TEXT,
    total_points  INTEGER,
    sports_scored INTEGER
) AS $$
    SELECT
        c.id                            AS company_id,
        c.name                          AS company_name,
        COALESCE(SUM(ep.points), 0)::INTEGER  AS total_points,
        COUNT(ep.id)::INTEGER           AS sports_scored
    FROM companies c
    LEFT JOIN event_points ep ON ep.company_id = c.id
    GROUP BY c.id, c.name
    ORDER BY total_points DESC;
$$ LANGUAGE sql STABLE;

-- ASG standard point scale: 1st=40, 2nd=38, 3rd=36, … (–2 per place, floor 0).
-- Canned Food Drive uses a fixed override (1st=15, 2nd=10, rest=5) — handled in app logic.
CREATE OR REPLACE FUNCTION asg_points(placement INTEGER)
RETURNS INTEGER AS $$
    SELECT GREATEST(0, 40 - ((placement - 1) * 2))::INTEGER;
$$ LANGUAGE sql IMMUTABLE;

-- ─── Row Level Security ──────────────────────────────────────────────────────
-- FastAPI uses the service role key and bypasses RLS.
-- These policies govern direct client access (future use).
ALTER TABLE companies    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE players      ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE brackets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON companies    FOR SELECT USING (true);
CREATE POLICY "public read" ON sports       FOR SELECT USING (true);
CREATE POLICY "public read" ON teams        FOR SELECT USING (true);
CREATE POLICY "public read" ON players      FOR SELECT USING (true);
CREATE POLICY "public read" ON team_rosters FOR SELECT USING (true);
CREATE POLICY "public read" ON brackets     FOR SELECT USING (true);
CREATE POLICY "public read" ON matches      FOR SELECT USING (true);
CREATE POLICY "public read" ON event_points FOR SELECT USING (true);

CREATE POLICY "own profile read"   ON user_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON user_profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON user_profiles FOR UPDATE USING (auth.uid() = id);

-- ─── Seed Data ───────────────────────────────────────────────────────────────
INSERT INTO sports (name, bracket_type, teams_per_company) VALUES
    ('Volleyball',        'double_elimination', 1),
    ('Basketball',        'double_elimination', 1),
    ('Dodgeball',         'double_elimination', 3),
    ('Soccer',            'single_elimination', 1),
    ('Tug of War',        'single_elimination', 1),
    ('Ultimate Frisbee',  'pool_bracket',       1),
    ('Pickleball',        'pool_swiss',         2),
    ('Cornhole',          'pool_swiss',         4),
    ('Relay Race',        'heats',              1),
    ('Human Pyramid',     'heats',              1),
    ('Water Ball Toss',   'points_based',       5),
    ('Canned Food Drive', 'points_based',       1);
