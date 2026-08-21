/* 서버 대사 → 대사 스택이 받는 모양 [v1 OWNER, 2026-08-11].
 *
 * 이 파일은 순수하다 — DOM 도 fetch 도 없다. `book.ts` 와 같은 이유이고, 여기서는
 * 이유가 하나 더 있다: **이 사상이 한 번 조용히 틀렸다.** 창을 합치면서 조달 칸을
 * `r.funding ?? null` 로 채웠더니 스왑만 있는 북에도 열이 서서 250줄이 전부 «—» 인
 * 조달 칸이 생겼다. 컴포넌트는 멀쩡했고 틀린 것은 넘겨주는 쪽이었는데, 그때 이
 * 함수가 창 안에 있어서 가드가 닿지 못했다.
 *
 * 여기서 계산하는 것은 없다. 이름만 바꿔 넘긴다 — 두 번째 정의를 만들지 않는다.
 */

import type { BacktestRecon } from '@/lib/api';
import type { ReconStackDay } from '@/ui/window/ReconStack';

/**
 * 행은 서버 순서(오름차순) 그대로 넘긴다. 보이는 방향은 스택의 날짜 헤더 토글이
 * 정한다.
 *
 * 접는 것이 하나 있다: **개시**(거래일→발효일 한 밤)는 진입일 행에만 서고 총손익
 * 대비 0.005% 라 자기 열을 갖지 않는다 — 평가에 접는다 [OWNER, 2026-08-14].
 * 엔진은 여전히 따로 센다(`backend/app/backtest.py`).
 *
 * **조달은 있을 때만 싣는다.** 스왑에는 조달이라는 개념 자체가 없으므로 그 칸은
 * «0원이었다» 도 «모른다» 도 아니고 **그 질문이 없다** 이다 — `undefined` 가 그
 * 뜻이고, `null` 은 "그날은 모른다" 라는 다른 말이다. `ReconStack` 의 `hasFunding`
 * 이 보는 것이 정확히 이 구분이다.
 */
export function backtestDays(recon: BacktestRecon): ReconStackDay[] {
  return recon.rows.map((r) => ({
    date: r.t,
    title: r.carryover ? `${r.t} · 다음 영업일로 들고 가는 이월 리스크` : r.t,
    krd: r.krd,
    dbp: r.dbp,
    est: r.est,
    estTotal: r.estTotal,
    valuation: r.valuation === null ? null : r.valuation + (r.startup ?? 0),
    carry: r.carry,
    rolldown: r.rolldown,
    ...(r.funding === undefined ? {} : { funding: r.funding }),
    actual: r.actual,
  }));
}

/** 표 아래 한 줄 — 잘린 창과 뺀 날은 **데이터 사실**이라 화면이 말해야 한다.
 * 둘 다 없으면 `undefined` 를 돌려 각주 자체를 안 세운다. */
export function reconNote(recon: BacktestRecon): string | undefined {
  const parts = [
    recon.truncated
      ? '긴 백테스트라 최근 영업일만 실었어요 — 기간 전체 분해는 위에 있어요.'
      : '',
    recon.dropped
      ? `민평과 IRS 달력이 어긋난 ${recon.dropped}일은 뺐어요 — 한쪽만 쉰 날과 그 다음 날이에요. 두 계열이 서로 다른 밤을 재고 있어서 더하면 어느 하루도 아니에요.`
      : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}
