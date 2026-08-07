"use client";

/* 창 신호등 — **떠 있는 창에만** [OWNER, 2026-08-07].
 *
 * "팝업창에 해당하는 것에 신호등을 넣고 기본으로는 신호등 넣지마." 셸의
 * 툴바에는 없다: 이건 브라우저 안의 화면이라 창을 소유하지 않고, 닫히지도
 * 옮겨지지도 않는 신호등은 컨트롤이 아니라 그림이다. 백테스트 창은 다르다 —
 * 실제로 닫히고, 실제로 끌어서 옮겨진다.
 *
 * ── 킷 ────────────────────────────────────────────────────────────────────
 * `Titlebars/*​/Window Controls/**Panel**` 44×10 — 창(Standard 68×14)이 아니라
 * **패널**의 것이다. 킷이 패널 변형에 주는 상태가 Active / Active - Minimize
 * Enabled / Inactive / Inactive - Minimize Enabled 넷뿐이라는 것이 곧 답이다:
 * 패널의 기본은 **닫기 하나**이고 최소화는 선택이다. 확대는 아예 없다.
 * 이 창은 크기가 내용에 매여 있고 최소화할 곳도 없으므로 닫기 하나만 둔다.
 * 셋을 그려 놓고 둘을 죽이는 것이 더 나쁘다 — 눌리지 않는 컨트롤이 둘 생긴다.
 *
 * 색은 킷의 `#FF5C60` 이고 실제 macOS(`#FF5F57`)와 미묘하게 다르다. 기호는
 * 호버에서만 나타난다 — macOS 의 실제 동작이고 목업도 그렇게 그린다. */

export function WindowControls({
  onClose,
  label = "닫기",
}: {
  onClose: () => void;
  label?: string;
}) {
  return (
    <span
      className="flex shrink-0 items-center"
      /* 끌기 시작을 막는다 — 이 자리는 창을 옮기는 곳이 아니라 닫는 곳이다. */
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={label}
        title={label}
        /* 12px 원. 기호는 8px 로 원 안에 들어가고, 검정 55%는 킷의 신호등 위
           기호 농도다. `group` 은 호버에서만 기호를 띄우기 위한 것 — 평소에는
           색 하나만 보인다. */
        className="group grid size-3 place-items-center rounded-full bg-wc-close leading-none transition-[filter] active:brightness-90"
      >
        <span className="text-[8px] leading-none text-black/55 opacity-0 transition-opacity group-hover:opacity-100">
          ✕
        </span>
      </button>
    </span>
  );
}
