"use client";

/* Renders a readable 해요체 message instead of a blank region when a child
 * throws — notably when a guard (assertDomainRendered, assertNoCssVars) fires
 * inside the detail view (DESIGN §2 Level 3 fix, §15 voice). */

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: string;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Surface the real cause for diagnosis; the user sees the fallback.
    console.error("[braveworld] detail view error:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
          <p className="text-[15px]">{this.props.fallback}</p>
          <p className="max-w-md text-[12px] opacity-40">
            {this.state.error.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
