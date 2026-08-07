"use client";

/* Loading and failure states (stability session, Pass B).
 *
 * The diagnosis that produced this: with the backend down, a 500, or a 200
 * carrying a truncated body, the app showed `불러오는 중입니다` — the same
 * screen for all three, and it never resolved (still loading at 24s and at
 * 81s). See docs/diagnostics/failure-modes.md. Three things follow:
 *
 *  - A failure must LOOK different from a wait. Same-looking states are why
 *    nobody noticed the backend was down.
 *  - The failure must be ACTIONABLE and stay on screen. A toast that fades
 *    leaves the reader with a blank region and no next step; a retry button
 *    means recovery does not require knowing to reload the page.
 *  - It must not depend on the fetch layer's retry budget expiring, which is
 *    exactly what did not happen in the diagnosis.
 *
 * Register: 해요체, as the existing error sentence already used (§15). */

interface Props {
  /** what failed, in the reader's terms — "커브" / "이 종목의 과거 흐름" */
  what?: string;
  onRetry?: () => void;
  /** true while a retry is in flight, so the button says so */
  retrying?: boolean;
  className?: string;
}

/** Waiting. Deliberately quiet — it is the ordinary case. */
export function LoadingState({ what, className = "" }: Props) {
  return (
    <div className={`flex items-center justify-center p-10 text-center ${className}`}>
      <p className="text-[16px] opacity-50">
        {what ? `${what} 불러오는 중이에요` : "불러오는 중이에요"}
      </p>
    </div>
  );
}

/** Failed, and here is what to do about it. */
export function ErrorState({ what, onRetry, retrying = false, className = "" }: Props) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 p-10 text-center ${className}`}
      role="alert"
    >
      <div>
        <p className="text-[16px]">
          {what ? `${what} 불러오지 못했어요` : "불러오지 못했어요"}
        </p>
        {/* the likeliest cause by far, and the one the reader can act on */}
        <p className="mt-1 text-[13px] opacity-45">
          서버에 연결되지 않았을 수 있어요
        </p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="rounded-control border border-edge px-3 py-1 text-[14px] hover:bg-page disabled:opacity-40"
        >
          {retrying ? "다시 시도하는 중" : "다시 시도"}
        </button>
      )}
    </div>
  );
}
