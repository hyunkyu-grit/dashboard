"use client";

/* Detail overlay — enlarged tile in place (design spec §2). Esc or
 * click-out closes. v0: reuses the tile at large size; full-resolution
 * stage-2 history arrives with build-order step 9. */

import { useEffect } from "react";

export function DetailOverlay({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-page/80"
      onClick={onClose}
    >
      <div
        className="rounded-sm border border-edge-live bg-popover p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
