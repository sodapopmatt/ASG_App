import React from 'react'
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch'

// Module-level: persists transform state across navigation
const savedBracketTransforms: Record<string, { x: number; y: number; scale: number }> = {}
import { createTheme } from '@g-loot/react-tournament-brackets'
import type { MatchType } from '@g-loot/react-tournament-brackets'
import type { Match, Team, Company } from '../types'

// Sorts bracket/pool names correctly when names exceed Z (Excel-style: A…Z, AA, AB…).
// Plain localeCompare puts AA before B; length-first fixes that.
export function compareBracketNames(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  return a.localeCompare(b)
}

export function buildMultiTeamKeys(teamMap: Record<string, Team>): Set<string> {
  const counts: Record<string, number> = {}
  for (const t of Object.values(teamMap)) {
    const k = `${t.company_id}:${t.sport_id}`
    counts[k] = (counts[k] ?? 0) + 1
  }
  return new Set(Object.entries(counts).filter(([, n]) => n > 1).map(([k]) => k))
}

export function compactLabel(
  teamId: string | null,
  teamMap: Record<string, Team>,
  companyMap: Record<string, Company>,
  slotState?: 'tbd' | 'bye',
  multiTeamKeys?: Set<string>,
): string {
  if (!teamId) return slotState === 'bye' ? 'BYE' : 'TBD'
  const team = teamMap[teamId]
  if (!team) return '—'
  const company = companyMap[team.company_id]
  const label = company?.short_id ?? company?.name ?? '?'
  const showSuffix = team.name && (multiTeamKeys ? multiTeamKeys.has(`${team.company_id}:${team.sport_id}`) : true)
  return showSuffix ? `${label} · ${team.name}` : label
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
  withinIds?: Set<string>,
  multiTeamKeys?: Set<string>,
): MatchType {
  const isDone = m.status === 'completed' || m.status === 'forfeit' || m.status === 'double_forfeit' || m.status === 'draw'

  let state: string
  if (m.status === 'completed') state = 'PLAYED'
  else if (m.status === 'forfeit') state = 'WALK_OVER'
  else if (m.status === 'double_forfeit') state = 'NO_SHOW'
  else if (m.status === 'in_progress') state = 'PLAYING'
  else state = 'SCHEDULED'

  // When rendering a subset (e.g. one division), drop next-match links that
  // leave the subset — the bracket library can't handle dangling references.
  const winnerNext = m.winner_next_match_id && (!withinIds || withinIds.has(m.winner_next_match_id))
    ? m.winner_next_match_id : null
  const loserNext = m.loser_next_match_id && (!withinIds || withinIds.has(m.loser_next_match_id))
    ? m.loser_next_match_id : null

  return {
    id: m.id,
    nextMatchId: winnerNext,
    nextLooserMatchId: loserNext ?? undefined,
    tournamentRoundText: m.match_round != null ? String(m.match_round) : '',
    startTime: [
      formatMatchTime(m.estimated_start ?? m.scheduled_at),
      m.locations?.name ?? null,
    ].filter(Boolean).join(' · '),
    state,
    participants: [
      {
        id: m.home_team_id ?? `${m.home_slot_state}-home-${m.id}`,
        name: compactLabel(m.home_team_id, teamMap, companyMap, m.home_slot_state, multiTeamKeys),
        isWinner: m.winner_id != null && m.winner_id === m.home_team_id,
        status: isDone ? 'PLAYED' : null,
        resultText:
          m.status === 'double_forfeit' ? 'FF'
          : m.status === 'forfeit' && m.winner_id !== m.home_team_id ? 'FF'
          : m.status === 'completed' && m.home_score != null ? String(m.home_score)
          : null,
      },
      {
        id: m.away_team_id ?? `${m.away_slot_state}-away-${m.id}`,
        name: compactLabel(m.away_team_id, teamMap, companyMap, m.away_slot_state, multiTeamKeys),
        isWinner: m.winner_id != null && m.winner_id === m.away_team_id,
        status: isDone ? 'PLAYED' : null,
        resultText:
          m.status === 'double_forfeit' ? 'FF'
          : m.status === 'forfeit' && m.winner_id !== m.away_team_id ? 'FF'
          : m.status === 'completed' && m.away_score != null ? String(m.away_score)
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
  matchBackground: { wonColor: '#bbf7d0', lostColor: '#ffffff' },
  border: { color: '#94a3b8', highlightedColor: '#2563eb' },
  textColor: {
    main: '#0f172a',
    highlighted: '#1d4ed8',
    dark: '#020617',
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
      fontColor: '#475569',
      fontSize: 11,
      height: 28,
      marginBottom: 8,
    },
    connectorColor: '#94a3b8',
    connectorColorHighlight: '#2563eb',
  },
}

function ZoomControls({ fitScale }: { fitScale: number }) {
  const { zoomIn, zoomOut, centerView } = useControls()
  const btn = 'w-9 h-9 flex items-center justify-center rounded-full bg-white border border-gray-200 shadow-sm text-slate-600 text-lg font-semibold active:bg-gray-100'
  return (
    <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1.5">
      <button type="button" aria-label="Zoom in" className={btn} onClick={() => zoomIn()}>+</button>
      <button type="button" aria-label="Zoom out" className={btn} onClick={() => zoomOut()}>−</button>
      <button type="button" aria-label="Fit bracket" className={`${btn} text-sm`} onClick={() => centerView(fitScale, 200)}>⤢</button>
    </div>
  )
}

// Stable svgWrapper identity for the bracket library. The library renders
// svgWrapper as a component (<SvgWrapper>), so passing an inline arrow would be
// a new component type on every render — remounting the whole bracket (and
// resetting the pan/zoom TransformWrapper) whenever the page re-renders, e.g.
// when a result modal opens. Reference this shared component instead.
export function BracketSvgWrapper({ children, bracketWidth, bracketHeight }: {
  children: React.ReactElement
  bracketWidth: number
  bracketHeight: number
}) {
  return (
    <ZoomableBracket bracketWidth={bracketWidth} bracketHeight={bracketHeight}>
      {children}
    </ZoomableBracket>
  )
}

export function ZoomableBracket({ children, bracketWidth, bracketHeight }: {
  children: React.ReactElement
  bracketWidth: number
  bracketHeight: number
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [fitScale, setFitScale] = React.useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const baseKey = `${bracketWidth}x${bracketHeight}`
  const storageKey = isFullscreen ? `${baseKey}-fs` : baseKey

  React.useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const fit = Math.min(el.clientWidth / bracketWidth, el.clientHeight / bracketHeight, 1)
      setFitScale(Math.max(fit, 0.15))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [bracketWidth, bracketHeight, isFullscreen])

  React.useEffect(() => {
    if (!isFullscreen) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [isFullscreen])

  const fitsAtFullSize = fitScale !== null && fitScale >= 1
  const saved = fitScale !== null ? savedBracketTransforms[storageKey] : undefined

  const iconBtn = 'w-9 h-9 flex items-center justify-center rounded-full bg-white border border-gray-200 shadow-sm text-slate-600 active:bg-gray-100'

  return (
    <div
      ref={containerRef}
      className={isFullscreen
        ? 'fixed inset-0 z-50 overflow-hidden bg-gray-50'
        : 'relative overflow-hidden border border-gray-200 rounded-xl bg-gray-50'}
      style={isFullscreen ? { touchAction: 'none' } : { height: `min(${bracketHeight + 48}px, 75vh)`, touchAction: 'none' }}
    >
      <button
        type="button"
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        className={`absolute top-3 right-3 z-20 ${iconBtn}`}
        onClick={() => setIsFullscreen(f => !f)}
      >
        {isFullscreen ? (
          <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
            <path d="M1 1l4.5 4.5M5.5 1H1v4.5M15 15l-4.5-4.5M10.5 15H15v-4.5M1 15l4.5-4.5M1 10.5V15h4.5M15 1l-4.5 4.5M15 5.5V1h-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 6V1h5M10 1h5v5M15 10v5h-5M6 15H1v-5"/>
          </svg>
        )}
      </button>

      {fitScale !== null && (
        <TransformWrapper
          key={`${storageKey}-${fitScale.toFixed(3)}`}
          minScale={fitScale}
          maxScale={2.5}
          initialScale={saved?.scale ?? (fitScale < 1 ? Math.max(fitScale, 0.85) : 1)}
          initialPositionX={saved?.x}
          initialPositionY={saved?.y}
          centerOnInit={!saved}
          centerZoomedOut={!saved}
          doubleClick={{ mode: 'zoomIn' }}
          wheel={{ step: 0.15 }}
          onTransform={(_, state) => {
            savedBracketTransforms[storageKey] = { x: state.positionX, y: state.positionY, scale: state.scale }
          }}
        >
          <ZoomControls fitScale={fitScale} />
          {!fitsAtFullSize && (
            <span className="absolute bottom-3 left-3 z-10 text-[11px] text-gray-400 bg-white/80 rounded-full px-2.5 py-1 pointer-events-none select-none">
              Pinch to zoom · drag to pan
            </span>
          )}
          <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
            <svg width={bracketWidth} height={bracketHeight} style={{ display: 'block' }}>
              {children}
            </svg>
          </TransformComponent>
        </TransformWrapper>
      )}
    </div>
  )
}
