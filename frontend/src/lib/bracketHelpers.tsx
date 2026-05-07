import React from 'react'
import { createTheme } from '@g-loot/react-tournament-brackets'
import type { MatchType } from '@g-loot/react-tournament-brackets'
import type { Match, Team, Company } from '../types'

export function compactLabel(
  teamId: string | null,
  teamMap: Record<string, Team>,
  companyMap: Record<string, Company>,
  slotState?: 'tbd' | 'bye',
): string {
  if (!teamId) return slotState === 'bye' ? 'BYE' : 'TBD'
  const team = teamMap[teamId]
  if (!team) return '—'
  const company = companyMap[team.company_id]
  const label = company?.short_id ?? company?.name ?? '?'
  return team.name ? `${label} · ${team.name}` : label
}

export function formatMatchTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export function stableSortMatches(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => {
    const ka = a.scheduled_at ?? a.id
    const kb = b.scheduled_at ?? b.id
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

export function toLibraryMatch(
  m: Match,
  teamMap: Record<string, Team>,
  companyMap: Record<string, Company>,
): MatchType {
  const isDone = m.status === 'completed' || m.status === 'forfeit' || m.status === 'double_forfeit'

  let state: string
  if (m.status === 'completed') state = 'PLAYED'
  else if (m.status === 'forfeit') state = 'WALK_OVER'
  else if (m.status === 'double_forfeit') state = 'NO_SHOW'
  else if (m.status === 'in_progress') state = 'PLAYING'
  else state = 'SCHEDULED'

  return {
    id: m.id,
    nextMatchId: m.winner_next_match_id ?? null,
    nextLooserMatchId: m.loser_next_match_id ?? undefined,
    tournamentRoundText: m.match_round != null ? String(m.match_round) : '',
    startTime: [
      formatMatchTime(m.scheduled_at ?? m.estimated_start),
      m.locations?.name ?? null,
    ].filter(Boolean).join(' · '),
    state,
    participants: [
      {
        id: m.home_team_id ?? `${m.home_slot_state}-home-${m.id}`,
        name: compactLabel(m.home_team_id, teamMap, companyMap, m.home_slot_state),
        isWinner: m.winner_id != null && m.winner_id === m.home_team_id,
        status: isDone ? 'PLAYED' : null,
        resultText:
          m.status === 'double_forfeit' ? 'FF'
          : m.status === 'forfeit' && m.winner_id !== m.home_team_id ? 'FF'
          : null,
      },
      {
        id: m.away_team_id ?? `${m.away_slot_state}-away-${m.id}`,
        name: compactLabel(m.away_team_id, teamMap, companyMap, m.away_slot_state),
        isWinner: m.winner_id != null && m.winner_id === m.away_team_id,
        status: isDone ? 'PLAYED' : null,
        resultText:
          m.status === 'double_forfeit' ? 'FF'
          : m.status === 'forfeit' && m.winner_id !== m.away_team_id ? 'FF'
          : null,
      },
    ],
  }
}

export const lightTheme = createTheme({
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  transitionTimingFunction: 'ease',
  disabledColor: '#9ca3af',
  canvasBackground: '#f9fafb',
  roundHeaders: { background: '#f9fafb' },
  matchBackground: { wonColor: '#f0fdf4', lostColor: '#ffffff' },
  border: { color: '#e5e7eb', highlightedColor: '#2563eb' },
  textColor: {
    main: '#1e293b',
    highlighted: '#2563eb',
    dark: '#0f172a',
    disabled: '#9ca3af',
  },
  score: {
    text: { highlightedWonColor: '#166534', highlightedLostColor: '#6b7280' },
    background: { wonColor: '#dcfce7', lostColor: '#f3f4f6' },
  },
})

export const bracketOptions = {
  style: {
    roundHeader: {
      backgroundColor: '#f9fafb',
      fontColor: '#94a3b8',
      fontSize: 11,
      height: 28,
      marginBottom: 8,
    },
    connectorColor: '#e2e8f0',
    connectorColorHighlight: '#2563eb',
  },
}

export function ScrollSvg({ children, bracketWidth, bracketHeight }: {
  children: React.ReactElement
  bracketWidth: number
  bracketHeight: number
}) {
  return (
    <div
      className="overflow-auto border border-gray-200 rounded-xl bg-gray-50"
      style={{ maxHeight: '75vh' }}
    >
      <svg width={bracketWidth} height={bracketHeight} style={{ display: 'block' }}>
        {children}
      </svg>
    </div>
  )
}

export function DoubleScrollSvg({ children, bracketWidth, bracketHeight }: {
  children: React.ReactElement
  bracketWidth: number
  bracketHeight: number
}) {
  return (
    <div
      className="overflow-auto border border-gray-200 rounded-xl bg-gray-50"
      style={{ maxHeight: '75vh' }}
    >
      <svg width={bracketWidth} height={bracketHeight} style={{ display: 'block' }}>
        {children}
      </svg>
    </div>
  )
}
