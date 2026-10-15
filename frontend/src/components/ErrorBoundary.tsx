import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** When this changes (e.g. the route), a crashed page gets another chance to render. */
  resetKey?: string;
}

/**
 * Catches render errors (bugs, unexpected data shapes) so one broken page shows
 * a readable message instead of a blank screen, and the rest of the app keeps working.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ui] render error', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
        <div className="text-base font-semibold">Something went wrong while showing this page</div>
        <p className="mt-1">The page hit an unexpected error. Your data is safe; this is a display problem.</p>
        <p className="mt-2 font-mono text-xs text-rose-700/70">{this.state.error.message}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-medium hover:bg-rose-100"
          >
            Try again
          </button>
          <a href="/" className="rounded-lg px-3 py-1.5 font-medium text-rose-800 hover:underline">
            Back to all accounts
          </a>
        </div>
      </div>
    );
  }
}
