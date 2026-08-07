"use client";

/* Renders a readable 해요체 message instead of a blank region when a child
 * throws — notably when a guard (assertDomainRendered, assertNoCssVars) fires
 * inside the detail view (DESIGN §2 Level 3 fix, §15 voice). */

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: string;
  /** Which region this is, for the console line — with four boundaries in
   * the tree (table, pane, popup, strip) "detail view error" was a lie in
   * three of them. */
  region?: string;
  /** Chrome-sized regions take a one-line bar instead of the centred block:
   * a 34px strip has no room for a paragraph, and a block there would push
   * the layout the strip is supposed to be pinned under. */
  compact?: boolean;
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
    console.error(`[braveworld] ${this.props.region ?? "render"} error:`, error);
  }

  render() {
    if (this.state.error) {
      if (this.props.compact) {
        // The one compact user is the bottom strip, which is FIXED chrome: if
        // its fallback rendered in normal flow it would land inside the app
        // root's strip padding and read as a stray line. It stands in for the
        // bar, in the bar's place.
        return (
          <div className="fixed inset-x-0 bottom-0 z-40 flex h-[34px] items-center border-t border-edge bg-tile px-3 text-[13px] opacity-45">
            {this.props.fallback}
          </div>
        );
      }
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
          <p className="text-[16px]">{this.props.fallback}</p>
          <p className="max-w-md text-[13px] opacity-40">
            {this.state.error.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
