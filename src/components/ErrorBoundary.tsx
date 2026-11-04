import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { reportError } from '../lib/errorReporter'

/*
 * Without this, one bad record on one page blanks the whole app: React unmounts everything and
 * the collector is left looking at a white screen with no idea whether their last note saved.
 * With it, the sidebar stays, the page says what happened, and we get told.
 */

interface Props { children: ReactNode; resetKey?: string }
interface State { error: Error | null }

class Boundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void reportError(error, 'render', { componentStack: info.componentStack ?? undefined })
  }

  componentDidUpdate(prev: Props) {
    // Navigating away is the natural "try again": the next page may be perfectly fine.
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" data-testid="error-boundary" className="max-w-xl mx-auto mt-16 p-6 rounded-xl border border-red-200 bg-red-50 text-slate-800">
        <h2 className="text-lg font-semibold text-red-800">Something went wrong on this page</h2>
        <p className="mt-2 text-sm">
          The error has been reported automatically. Anything you saved before this happened is safe.
          You can go to another page from the menu, or reload this one.
        </p>
        <pre className="mt-3 text-xs text-red-900/80 whitespace-pre-wrap break-words">{this.state.error.message}</pre>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-medium hover:bg-red-800"
        >
          Reload page
        </button>
      </div>
    )
  }
}

/** Resets itself when the route changes, so one broken page does not stick to the next. */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <Boundary resetKey={pathname}>{children}</Boundary>
}

/** Outermost catch, for a crash in the layout or a provider -- nothing router-aware above it. */
export function RootErrorBoundary({ children }: { children: ReactNode }) {
  return <Boundary>{children}</Boundary>
}
