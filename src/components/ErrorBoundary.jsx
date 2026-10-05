import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
        <h2 className="mb-2 text-lg font-semibold">Something went wrong in this view</h2>
        <pre className="mb-4 overflow-auto whitespace-pre-wrap text-xs">{String(this.state.error?.message || this.state.error)}</pre>
        <button className="rounded-lg bg-rose-600 px-3 py-1.5 font-medium text-white" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
