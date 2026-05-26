import React from "react";

interface State {
  error: Error | null;
}

/**
 * Surfaces render errors instead of letting the whole tree unmount silently
 * (which produces the "dark window with title only" symptom).
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="h-full w-full overflow-auto p-6 text-sm"
          style={{ background: "#1b1b1f", color: "#ffb4b4", fontFamily: "monospace" }}
        >
          <h2 className="mb-2 text-base font-semibold">Render error</h2>
          <div className="mb-3 whitespace-pre-wrap">{this.state.error.message}</div>
          <pre className="whitespace-pre-wrap text-neutral-400">
            {this.state.error.stack}
          </pre>
          <button
            type="button"
            className="mt-4 rounded border border-neutral-500 px-3 py-1 text-neutral-200 hover:bg-neutral-700"
            onClick={() => this.setState({ error: null })}
          >
            Reset
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
