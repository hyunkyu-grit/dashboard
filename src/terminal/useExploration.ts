'use client';

/**
 * 탐색 이력 — **Shneiderman 의 일곱 과업 중 «History»**.
 *
 * ── 왜 이것부터인가 [외부 리서치, 2026-08-26] ──────────────────────────────
 * 이 화면을 정보시각화의 정본 과업 목록으로 감사했다(Shneiderman, "The Eyes
 * Have It: A Task by Data Type Taxonomy for Information Visualizations",
 * IEEE VL 1996 — overview · zoom · filter · details-on-demand · relate ·
 * **history** · **extract**). 일곱 중 다섯은 이미 있었고, 없는 둘이
 * history 와 extract 였다.
 *
 * 그리고 없는 둘 중 **history 가 더 아프다**. 이 화면의 주된 동작이
 * search-around(노드를 눌러 그리로 옮겨가기)인데, 잘못 눌렀을 때 되돌아갈
 * 방법이 없었다. 그러면 사람은 «누르기» 자체를 조심하게 되고, 조심스러운
 * 탐색은 탐색이 아니다. Cambridge Intelligence 의 그래프 UX 지침이
 * «progressive expansion» 을 말하는 것도 같은 이유다 — 되돌릴 수 있어야
 * 점진적으로 나아갈 수 있다.
 *
 * ── 이력은 «초점» 의 것이지 «필터» 의 것이 아니다 ──────────────────────────
 * 되돌리기가 필터까지 되감으면, 필터를 걸어 둔 채 노드 셋을 둘러본 사람이
 * 뒤로 한 번 눌렀을 때 필터도 같이 풀린다. 그건 그 사람이 요청한 적 없는
 * 되돌리기다. 그래서 이 훅은 **`focusId` 하나만** 기억한다. 필터를 비우는 것은
 * 「비우기」 버튼의 일이고, 그 둘은 서로 다른 취소다.
 *
 * ── 같은 자리를 두 번 쌓지 않는다 ──────────────────────────────────────────
 * 목록에서 이미 보고 있는 것을 다시 누르는 일은 흔하다(도시에의 링크 목록과
 * 그래프의 노드가 같은 것을 가리킨다). 그때마다 이력이 한 칸 늘면 뒤로 가기가
 * 같은 자리에서 여러 번 눌려야 한다.
 */

import { useCallback, useMemo, useState } from 'react';

export type Exploration = {
  /** 지금 보고 있는 것. */
  focusId: string | null;
  /** 여기로 간다. 앞으로 갈 곳(redo)은 버린다 — 새 길을 갔으므로. */
  go: (id: string) => void;
  back: () => void;
  forward: () => void;
  canBack: boolean;
  canForward: boolean;
  /** 뒤로/앞으로가 **닿을 자리**. 누르기 전에 미리 안다.
   *
   *  주소를 같이 쓰기 시작하면서 필요해졌다(`urlState.ts`). `back()` 은 상태를
   *  바꿀 뿐 무엇으로 갔는지를 안 돌려주는데, 주소는 그 값을 알아야 적는다.
   *  대안은 «초점이 바뀌면 주소를 쓴다» 는 효과를 하나 두는 것이었고, 그러면
   *  주소→상태 효과와 마주 보며 서로를 되받아 쓴다(마운트 한 프레임 동안 실제로
   *  주소를 덮어썼다). **쓰는 쪽은 언제나 사람의 동작 하나**여야 한다. */
  backTarget: string | null;
  forwardTarget: string | null;
  /** 지금까지 온 길. 빵부스러기가 읽는다 — 마지막이 곧 `focusId`. */
  trail: string[];
  /** 이력만 지우고 지금 자리는 둔다. */
  reset: (id: string | null) => void;
};

/** 셋을 **한 상태로** 든다.
 *
 * ── 왜 useState 셋이 아닌가 (실측 2026-08-26) ──────────────────────────────
 * 첫 판은 `past`·`present`·`future` 를 각각 `useState` 로 두고, `go()` 에서
 * `setPresent(cur => { ...; setPast(p => [...p, cur]); return id })` 처럼
 * **업데이터 안에서 다른 setter 를 불렀다.** 그리고 빵부스러기에 같은 이름이
 * 두 번씩 쌓였다.
 *
 * 업데이터 함수는 **순수해야 한다** — React 는 그것을 한 번만 부른다고 약속하지
 * 않고(StrictMode 는 개발에서 일부러 두 번 부른다), 안에 든 `setPast` 는 부를
 * 때마다 실행되는 부작용이다. 한 번의 이동이 두 칸으로 기록된 이유가 그것이다.
 *
 * 셋을 한 객체에 담으면 이동이 **한 번의 순수한 계산**이 된다. 두 번 불려도
 * 같은 입력에서 같은 출력이라 결과가 안 바뀐다. */
type Hist = { past: string[]; present: string | null; future: string[] };

export function useExploration(initial: string | null): Exploration {
  const [h, setH] = useState<Hist>({ past: [], present: initial, future: [] });

  const go = useCallback((id: string) => {
    setH((s) => {
      if (s.present === id) return s; // 같은 자리 — 이력을 안 늘린다
      return {
        past: s.present == null ? s.past : [...s.past, s.present],
        present: id,
        future: [], // 새 길을 갔으므로 앞으로 갈 곳은 버린다
      };
    });
  }, []);

  const back = useCallback(() => {
    setH((s) => {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      return {
        past: s.past.slice(0, -1),
        present: prev,
        future: s.present == null ? s.future : [s.present, ...s.future],
      };
    });
  }, []);

  const forward = useCallback(() => {
    setH((s) => {
      if (s.future.length === 0) return s;
      return {
        past: s.present == null ? s.past : [...s.past, s.present],
        present: s.future[0],
        future: s.future.slice(1),
      };
    });
  }, []);

  const reset = useCallback((id: string | null) => {
    setH({ past: [], present: id, future: [] });
  }, []);

  /* ── 키보드는 **여기 없다** [실측 2026-08-27] ──────────────────────────────
     `Alt+←/→` 는 한때 이 훅이 직접 들었다. 주소 상태가 들어오면서 그것이
     **조용히 죽었다**: 훅이 `back()` 으로 초점을 되돌리면 주소는 그대로라,
     셸의 «주소 → 상태» 효과가 곧바로 옛 값으로 되돌려 놨다. 즉 뒤로 가기를
     누르면 아무 일도 안 일어났고, 그 사이 이력만 지워졌다.

     뿌리는 «같은 상태를 두 곳에서 쓴다» 였다. 그래서 키는 셸로 옮겼다 —
     `goBack`·`goForward` 가 이력과 주소를 **함께** 쓰는 유일한 자리이고,
     버튼과 키가 같은 함수를 지나가야 둘이 갈리지 않는다.
     (훅은 이제 상태와 그 계산만 진다. 그것이 훅이 할 일이다.) */

  const trail = useMemo(
    () => (h.present == null ? h.past : [...h.past, h.present]),
    [h],
  );

  return {
    focusId: h.present,
    go,
    back,
    forward,
    canBack: h.past.length > 0,
    canForward: h.future.length > 0,
    backTarget: h.past.length > 0 ? h.past[h.past.length - 1] : null,
    forwardTarget: h.future.length > 0 ? h.future[0] : null,
    trail,
    reset,
  };
}
