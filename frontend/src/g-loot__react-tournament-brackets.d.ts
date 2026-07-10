declare module '@g-loot/react-tournament-brackets' {
  import { ReactElement, ReactNode, ComponentType } from 'react'

  export interface ParticipantType {
    id: string | number
    name?: ReactNode
    isWinner?: boolean
    status?: string | null
    resultText?: string | null
    [key: string]: unknown
  }

  export interface MatchType {
    id: number | string
    nextMatchId: number | string | null
    nextLooserMatchId?: number | string
    tournamentRoundText?: string
    startTime: string
    state: string
    participants: ParticipantType[]
    [key: string]: unknown
  }

  export interface SvgWrapperProps {
    bracketWidth: number
    bracketHeight: number
    startAt: number[]
    children: ReactElement
  }

  export interface MatchClickArgs {
    match: MatchType
    topWon: boolean
    bottomWon: boolean
    event?: unknown
  }

  export interface MatchComponentProps {
    match: MatchType
    topWon: boolean
    bottomWon: boolean
    onMatchClick: (args: MatchClickArgs) => void
    onPartyClick?: (party: ParticipantType, partyWon: boolean) => void
    topText?: string
    bottomText?: string
    [key: string]: unknown
  }

  export interface CommonProps {
    matchComponent: ComponentType<any>
    svgWrapper?: (props: SvgWrapperProps) => ReactElement
    theme?: ThemeType
    options?: { style: unknown }
    onMatchClick?: (args: MatchClickArgs) => void
    onPartyClick?: (party: ParticipantType, partyWon: boolean) => void
  }

  export interface SingleElimProps extends CommonProps {
    matches: MatchType[]
  }

  export interface DoubleElimProps extends CommonProps {
    matches: { upper: MatchType[]; lower: MatchType[] }
  }

  export interface SVGViewerProps {
    width: number
    height: number
    bracketWidth: number
    bracketHeight: number
    startAt: number[]
    scaleFactor: number
    children: ReactElement
  }

  export const SingleEliminationBracket: ComponentType<SingleElimProps>
  export const DoubleEliminationBracket: ComponentType<DoubleElimProps>
  export const Match: ComponentType<any>
  export const SVGViewer: ComponentType<SVGViewerProps>
  export type ThemeType = Record<string, unknown>
  export const MATCH_STATES: Record<string, string>
  export function createTheme(overrides: Record<string, unknown>): ThemeType
}
