"use client";
import { Component, ReactNode } from "react";

type State = { hasError: boolean; error?: Error };

export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  State
> {
  state: State = { hasError: false };
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error) {
    console.error("[Fun London] caught:", error);
  }
  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="p-6 text-center">
            <div className="text-3xl mb-3">😬</div>
            <h2 className="text-lg font-bold mb-2 text-heading">
              Something went wrong
            </h2>
            <p className="text-sm text-muted-fg mb-4">
              Try refreshing the page.
            </p>
            <button
              onClick={() => location.reload()}
              className="px-4 py-2 rounded-xl bg-primary text-primary-fg font-bold text-sm"
            >
              Reload
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
