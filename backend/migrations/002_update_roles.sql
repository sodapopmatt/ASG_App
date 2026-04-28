-- Simplify roles to three: admin, team_manager, player.
ALTER TABLE user_profiles DROP CONSTRAINT user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
    CHECK (role IN ('player', 'team_manager', 'admin'));

COMMENT ON COLUMN user_profiles.role IS
    'admin: full access | team_manager: own company players/rosters only | player: read-only';
