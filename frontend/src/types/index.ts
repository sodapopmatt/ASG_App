export interface Company {
  id: string
  name: string
  short_id: string | null
  logo_url: string | null
  created_at: string
}

export interface Sport {
  id: string
  name: string
  bracket_type: string
  teams_per_company: number
  scoring_direction: 'high_wins' | 'low_wins'
  multi_team_rule: 'best_placement' | 'average_score'
  points_scale: Record<string, number> | null
  match_duration_minutes: number | null
  schedule_start: string | null
  created_at: string
}

export interface Team {
  id: string
  company_id: string
  sport_id: string
  name: string | null
  created_at: string
}

export interface Match {
  id: string
  sport_id: string
  bracket_id: string | null
  home_team_id: string | null
  away_team_id: string | null
  home_slot_state: 'tbd' | 'bye'
  away_slot_state: 'tbd' | 'bye'
  location_id: string | null
  locations: { name: string } | null
  winner_id: string | null
  status: 'scheduled' | 'in_progress' | 'completed' | 'forfeit' | 'double_forfeit'
  match_round: number | null
  bracket_phase: string | null
  winner_next_match_id: string | null
  loser_next_match_id: string | null
  scheduled_at: string | null
  actual_start: string | null
  played_at: string | null
  notes: string | null
  created_at: string
  estimated_start: string | null
}

export interface Bracket {
  id: string
  sport_id: string
  name: string
  phase: string | null
  created_at: string
}

export interface Location {
  id: string
  sport_id: string
  name: string
}

export interface RosterEntry {
  id: string
  team_id: string
  player_name: string
  created_at: string
}

export interface LeaderboardEntry {
  company_id: string
  company_name: string
  total_points: number
  sports_scored: number
}

export interface EventPoints {
  company_id: string
  sport_id: string
  placement: number
  points: number
}
