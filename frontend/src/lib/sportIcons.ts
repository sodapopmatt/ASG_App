// Maps a sport name to an emoji icon. Matching is case-insensitive and
// keyword-based so slight naming variations (e.g. "Men's Basketball") still
// resolve. Falls back to a generic medal when no keyword matches.

const ICON_RULES: { keywords: string[]; icon: string }[] = [
  { keywords: ['volleyball'], icon: '🏐' },
  { keywords: ['basketball'], icon: '🏀' },
  { keywords: ['dodgeball'], icon: '🤾' },
  { keywords: ['soccer', 'football'], icon: '⚽' },
  { keywords: ['tug'], icon: '🪢' },
  { keywords: ['frisbee', 'ultimate', 'disc'], icon: '🥏' },
  { keywords: ['pickleball'], icon: '🎾' },
  { keywords: ['cornhole'], icon: '🌽' },
  { keywords: ['relay', 'race', 'run'], icon: '🏃' },
  { keywords: ['pyramid'], icon: '🤸' },
  { keywords: ['water', 'ball toss'], icon: '💦' },
  { keywords: ['food', 'canned', 'drive'], icon: '🥫' },
]

const FALLBACK_ICON = '🏅'

export function getSportIcon(sportName: string): string {
  const name = sportName.toLowerCase()
  for (const { keywords, icon } of ICON_RULES) {
    if (keywords.some(kw => name.includes(kw))) return icon
  }
  return FALLBACK_ICON
}
