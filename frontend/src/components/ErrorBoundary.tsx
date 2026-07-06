import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: (error: Error) => ReactNode
}

interface State {
  error: Error | null
}

// A crash while rendering one sport's bracket (e.g. malformed match data
// tripping the @g-loot/react-tournament-brackets library) must not take
// down the whole app — without this, React unmounts the entire tree on any
// uncaught render error, so every other page looks broken too until a full
// reload, even though only one sport's data is actually bad.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error)
      return (
        <div className="p-6 text-center space-y-2">
          <p className="text-sm font-semibold text-red-600">Something went wrong showing this.</p>
          <p className="text-xs text-gray-400">{this.state.error.message}</p>
        </div>
      )
    }
    return this.props.children
  }
}
