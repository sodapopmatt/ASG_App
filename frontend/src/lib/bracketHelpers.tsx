import React, { useMemo } from 'react'

// Module-level: persists zoom + scroll position across navigation
const savedBracketView: Record<string, { scale: number; scrollX: number; scrollY: number }> = {}
import { createTheme, SingleEliminationBracket, Match as LibMatch } from '@g-loot/react-tournament-brackets'
import type { MatchType, MatchComponentProps } from '@g-loot/react-tournament-brackets'
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

// Same as compactLabel, but suffixed with the team's seed number (1-based, greyed
// out) — used only in bracket diagram slots, not standings/modals where seed is noise.
export function seededLabel(
  teamId: string | null,
  teamMap: Record<string, Team>,
  companyMap: Record<string, Company>,
  slotState?: 'tbd' | 'bye',
  multiTeamKeys?: Set<string>,
): React.ReactNode {
  const label = compactLabel(teamId, teamMap, companyMap, slotState, multiTeamKeys)
  const seed = teamId ? teamMap[teamId]?.seed : null
  if (seed == null) return label
  return (
    <>
      {label}
      <span style={{ color: '#9ca3af' }}> · {seed + 1}</span>
    </>
  )
}

export function formatMatchTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

// Groups matches by court name for the "By Courts" queue view. Excludes bye
// matches (they never actually get played on a court) and fully-TBD matches
// with no court assigned (e.g. a grand final waiting on both semis) — nothing
// is actionable there yet, so it shouldn't clutter the court tabs with a
// "No court assigned" bucket. Once a court is assigned or either side of the
// match resolves to a real team, it reappears. Each group is sorted by
// estimated/scheduled time so a ref sees their court's queue in order.
export function groupMatchesByCourt(matches: Match[]): Map<string, Match[]> {
  const playable = matches.filter(m =>
    m.home_slot_state !== 'bye' && m.away_slot_state !== 'bye' &&
    (m.locations?.name != null || m.home_team_id != null || m.away_team_id != null),
  )
  const byCourt = new Map<string, Match[]>()
  for (const m of playable) {
    const key = m.locations?.name ?? 'No court assigned'
    const list = byCourt.get(key) ?? []
    list.push(m)
    byCourt.set(key, list)
  }
  for (const list of byCourt.values()) {
    list.sort((a, b) => {
      const ta = a.estimated_start ?? a.scheduled_at ?? ''
      const tb = b.estimated_start ?? b.scheduled_at ?? ''
      return ta.localeCompare(tb)
    })
  }
  return new Map([...byCourt.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

export function stableSortMatches(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => {
    // scheduled_at is frequently null (e.g. rounds beyond the first, or a
    // bracket phase generated with no courts assigned) — comparing that
    // directly against a's/b's raw id string mixes an ISO date with a UUID,
    // an effectively arbitrary comparison. Bucket missing times together
    // first, and use id only as a genuine tiebreak once times match.
    const ta = a.scheduled_at ?? ''
    const tb = b.scheduled_at ?? ''
    if (ta !== tb) return ta < tb ? -1 : 1
    return a.id < b.id ? -1 : 1
  })
}

export function toLibraryMatch(
  m: Match,
  teamMap: Record<string, Team>,
  companyMap: Record<string, Company>,
  withinIds?: Set<string>,
  multiTeamKeys?: Set<string>,
  showGameScores?: boolean,
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
        name: seededLabel(m.home_team_id, teamMap, companyMap, m.home_slot_state, multiTeamKeys),
        isWinner: m.winner_id != null && m.winner_id === m.home_team_id,
        status: isDone ? 'PLAYED' : null,
        resultText:
          m.status === 'double_forfeit' ? 'FF'
          : m.status === 'forfeit' && m.winner_id !== m.home_team_id ? 'FF'
          : showGameScores ? (m.home_games_won != null ? String(m.home_games_won) : null)
          : m.home_score != null ? String(m.home_score)
          : null,
      },
      {
        id: m.away_team_id ?? `${m.away_slot_state}-away-${m.id}`,
        name: seededLabel(m.away_team_id, teamMap, companyMap, m.away_slot_state, multiTeamKeys),
        isWinner: m.winner_id != null && m.winner_id === m.away_team_id,
        status: isDone ? 'PLAYED' : null,
        resultText:
          m.status === 'double_forfeit' ? 'FF'
          : m.status === 'forfeit' && m.winner_id !== m.away_team_id ? 'FF'
          : showGameScores ? (m.away_games_won != null ? String(m.away_games_won) : null)
          : m.away_score != null ? String(m.away_score)
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

// Pan/zoom without any CSS transform. The @g-loot bracket renders each match as
// a nested <svg> holding a <foreignObject> (the HTML match card); iOS/WebKit has
// a long-standing bug where a foreignObject positioned inside a CSS-transformed
// ancestor collapses to the root SVG's origin — the connector <path>s draw at the
// right place but every card piles up at the top-left. react-zoom-pan-pinch (used
// previously) applied exactly such a CSS transform, so brackets were unreadable on
// iPhones. Here we scale the SVG via its own width/height + a fixed viewBox
// (SVG-native scaling, which iOS renders correctly) and pan with native scroll.
export function ZoomableBracket({ children, bracketWidth, bracketHeight }: {
  children: React.ReactElement
  bracketWidth: number
  bracketHeight: number
}) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const [fitScale, setFitScale] = React.useState<number | null>(null)
  const [scale, setScale] = React.useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const initedKey = React.useRef<string | null>(null)

  const baseKey = `${bracketWidth}x${bracketHeight}`
  const storageKey = isFullscreen ? `${baseKey}-fs` : baseKey

  // Measure the viewport and track the scale that fits the whole bracket.
  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const fit = Math.min(el.clientWidth / bracketWidth, el.clientHeight / bracketHeight, 1)
      setFitScale(Math.max(fit, 0.15))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [bracketWidth, bracketHeight, storageKey])

  // Initialize scale + scroll once per view (fresh mount or fullscreen toggle),
  // restoring a saved position if we have one, else centering horizontally.
  React.useLayoutEffect(() => {
    if (fitScale === null || initedKey.current === storageKey) return
    initedKey.current = storageKey
    const saved = savedBracketView[storageKey]
    const initialScale = saved?.scale ?? fitScale
    setScale(initialScale)
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (!el) return
      if (saved) {
        el.scrollLeft = saved.scrollX
        el.scrollTop = saved.scrollY
      } else {
        el.scrollLeft = Math.max(0, (bracketWidth * initialScale - el.clientWidth) / 2)
        el.scrollTop = 0
      }
    })
  }, [fitScale, storageKey, bracketWidth])

  React.useEffect(() => {
    if (!isFullscreen) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [isFullscreen])

  const persist = React.useCallback(() => {
    const el = scrollRef.current
    if (!el || scale === null) return
    savedBracketView[storageKey] = { scale, scrollX: el.scrollLeft, scrollY: el.scrollTop }
  }, [scale, storageKey])

  const renderScale = scale ?? fitScale ?? 1
  const minScale = fitScale ?? 0.15

  // Zoom while keeping the current viewport centre anchored.
  const applyZoom = (next: number) => {
    const clamped = Math.min(Math.max(next, minScale), 2.5)
    const el = scrollRef.current
    if (el && scale) {
      const cx = (el.scrollLeft + el.clientWidth / 2) / scale
      const cy = (el.scrollTop + el.clientHeight / 2) / scale
      setScale(clamped)
      requestAnimationFrame(() => {
        el.scrollLeft = cx * clamped - el.clientWidth / 2
        el.scrollTop = cy * clamped - el.clientHeight / 2
        persist()
      })
    } else {
      setScale(clamped)
    }
  }

  const resetFit = () => {
    if (fitScale === null) return
    setScale(fitScale)
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) {
        el.scrollLeft = Math.max(0, (bracketWidth * fitScale - el.clientWidth) / 2)
        el.scrollTop = 0
      }
      persist()
    })
  }

  const fitsAtFullSize = fitScale !== null && fitScale >= 1
  const iconBtn = 'w-9 h-9 flex items-center justify-center rounded-full bg-white border border-gray-200 shadow-sm text-slate-600 active:bg-gray-100'
  const zoomBtn = `${iconBtn} text-lg font-semibold`

  return (
    <div
      className={isFullscreen
        ? 'fixed inset-0 z-50 overflow-hidden bg-gray-50'
        : 'relative overflow-hidden border border-gray-200 rounded-xl bg-gray-50'}
      style={isFullscreen ? undefined : { height: `min(${bracketHeight + 48}px, 75vh)` }}
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

      <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1.5">
        <button type="button" aria-label="Zoom in" className={zoomBtn} onClick={() => applyZoom(renderScale * 1.25)}>+</button>
        <button type="button" aria-label="Zoom out" className={zoomBtn} onClick={() => applyZoom(renderScale / 1.25)}>−</button>
        <button type="button" aria-label="Fit bracket" className={`${iconBtn} text-sm`} onClick={resetFit}>⤢</button>
      </div>

      {!fitsAtFullSize && (
        <span className="absolute bottom-3 left-3 z-10 text-[11px] text-gray-400 bg-white/80 rounded-full px-2.5 py-1 pointer-events-none select-none">
          Drag to pan · tap +/− to zoom
        </span>
      )}

      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-auto overscroll-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
        onScroll={persist}
      >
        <svg
          width={Math.ceil(bracketWidth * renderScale)}
          height={Math.ceil(bracketHeight * renderScale)}
          viewBox={`0 0 ${bracketWidth} ${bracketHeight}`}
          style={{ display: 'block' }}
        >
          {children}
        </svg>
      </div>
    </div>
  )
}

// ─── Shared single-elimination chart (used by BracketResultsPage and the pool
// sports' Bracket Phase tab, which shares the same single-elim bracket shape) ──

// NOTE: this deliberately avoids `position: relative/absolute` (and opacity,
// transform) on anything rendered here. This whole tree lives inside the
// bracket library's <foreignObject> (see match-wrapper.js), and WebKit has a
// 17-year-old unfixed bug (bugs.webkit.org #23113) where HTML content inside a
// foreignObject that acquires its own RenderLayer — via position, opacity, or
// transform — gets parented to the SVG root's layer instead and renders at the
// wrong coordinates (collapsed to the top-left origin). The "In Progress"
// badge overlay below used position:absolute; the CSS Grid stacking here
// (both children sharing gridArea '1 / 1') achieves the same visual overlap
// without ever setting `position`, so it doesn't trigger the bug.
export function MatchComponent(props: MatchComponentProps) {
  const isPlaying = props.match.state === 'PLAYING'
  const openModal = () => props.onMatchClick({ match: props.match, topWon: props.topWon, bottomWon: props.bottomWon, event: {} as React.MouseEvent<HTMLAnchorElement> })
  return (
    <div style={{ display: 'grid', height: '100%' }}>
      <div style={{ gridArea: '1 / 1' }}>
        <LibMatch {...props} onMatchClick={undefined} onPartyClick={openModal} />
      </div>
      {isPlaying && (
        <span style={{
          gridArea: '1 / 1', justifySelf: 'end', alignSelf: 'start', margin: '4px 8px 0 0',
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 600, color: '#92400e',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          pointerEvents: 'none',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#eab308', display: 'inline-block' }} />
          In Progress
        </span>
      )}
    </div>
  )
}

export function SingleBracketView({
  matches,
  teamMap,
  companyMap,
  onMatchClick,
  showGameScores,
}: {
  matches: Match[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  onMatchClick: (matchId: string) => void
  showGameScores?: boolean
}) {
  const libMatches = useMemo(() => {
    const ids = new Set(matches.map(m => m.id))
    const multiTeamKeys = buildMultiTeamKeys(teamMap)
    return stableSortMatches(matches).map(m => toLibraryMatch(m, teamMap, companyMap, ids, multiTeamKeys, showGameScores))
  }, [matches, teamMap, companyMap, showGameScores])

  if (libMatches.length === 0) return <p className="text-center text-gray-500 py-12">No matches yet.</p>

  return (
    <SingleEliminationBracket
      matches={libMatches}
      matchComponent={MatchComponent}
      theme={lightTheme}
      options={bracketOptions}
      onMatchClick={({ match }) => onMatchClick(String(match.id))}
      svgWrapper={BracketSvgWrapper}
    />
  )
}
