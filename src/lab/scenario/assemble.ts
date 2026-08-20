/* 앵커 × 시나리오 — 시장 숫자와 모형 편차가 만나는 **유일한 자리**.
 *
 * `combine.ts` 는 시장을 모른다(구운 계수만 다룬다). 백엔드의 앵커는 시나리오를
 * 모른다(오늘의 커브만 답한다). 둘을 더하는 산술이 화면 여기저기 흩어지면 나중에
 * "이 숫자 어디서 나왔나" 를 물을 자리가 없어지므로, 덧셈을 이 파일 하나에 가둔다.
 *
 * ── 왜 백엔드가 아니라 여기서 더하나 [계약 수정, 2026-08-20] ────────────────
 * 처음 계약은 `관측 + Δ` 를 백엔드에 두는 것이었다. 뒤집었다 — **손잡이를 끌
 * 때마다 서버를 왕복하면 시나리오 빌더가 못 쓸 물건이 된다.** 원본 랩도 입력
 * 이벤트마다 다시 계산한다. 앵커는 한 번만 가져오고 재조합은 로컬이다.
 *
 * 원래 계약이 막으려던 것은 "시장 데이터로 **다른 시장 사실**을 몰래 파생하는
 * 것" 이고(`guards/row-vm-source.test.ts` 의 명제), 이건 시나리오 조립이라 거기
 * 안 걸린다. 대신 자리를 하나로 묶고 테스트로 잠근다.
 *
 * ── 다섯째 칸이 이 화면의 전부다 ───────────────────────────────────────────
 *
 *     현재          오늘의 스팟 IRS 호가
 *     시장 12M      현재 + 시장 캐리 — **시장이 이미 프라이싱한** 12개월 뒤
 *     시나리오 12M  현재 + 모형 Δ
 *     Δ vs 시장     모형 Δ − 시장 캐리                ← 트레이드
 *
 * `시나리오 − 현재` 는 전망이다. 전망이 맞아도 시장이 이미 그만큼 프라이싱했으면
 * 포지션이 없다. 트레이드는 **캐리 대비**에서만 나온다.
 *
 * 부호: 양수 = 모형이 시장보다 **높게** 본다(페이). 음수 = 낮게 본다(리시브).
 *
 * ── 왜 포워드 레벨이 아니라 캐리를 받나 ────────────────────────────────────
 * 스팟에는 출처가 둘이다: 유니버스의 **호가**와 포워드 행렬의 **부트스트랩 SPOT**.
 * 실측 2026-08-19 로 둘의 차가 0.00~0.18bp 다(3Y 가 0.18bp). 작지만 0 은 아니라,
 * 호가로 현재를 그리고 부트스트랩 포워드 레벨을 빼면 그 차가 다섯째 칸에 샌다.
 *
 * 포워드의 본질은 레벨이 아니라 **캐리**(`fwd − 같은 커브의 spot`)이므로, 백엔드가
 * 같은 부트스트랩 안에서 뺀 `carry12mBp` 만 보낸다. 그러면 현재는 호가라 Main 표와
 * 일치하고, 다섯째 칸은 `Δ − carry` 라 누수가 0 이다.
 *
 * ── 10Y 는 다섯째 칸이 없다 ─────────────────────────────────────────────────
 * v2 포워드 행렬의 시작점이 5Y 까지고 IRS 커브도 10Y 에서 끝난다. `1Y × 10Y` 는
 * 11Y 할인계수를 요구하므로 커브 밖이다. `null` 로 두고 화면이 이유를 말한다 —
 * 빈칸은 "0" 이 아니다.
 */

import type { Diffs, FrameDiff, IrsTenor, KtbTenor } from './combine';
import { IRS_TENORS, KTB_TENORS } from './combine';

/**
 * 12개월 = 4분기. `irs[τ]` 는 h(분기)로 색인되고 h=0 이 오늘이므로 h=4 다.
 * 원본의 헤드라인 문장도 같은 자리를 읽는다(`replay_ref.sentence`).
 */
export const H_12M = 4;

/** 한 테너의 오늘 값. 백엔드가 답하는 그대로. */
export type TenorAnchor = {
  /** 오늘의 스팟 par 호가, %. 유니버스 표와 같은 숫자다. */
  spot: number;
  /**
   * 시장이 이미 프라이싱한 12개월 이동, bp. `1Y 시작 τ 포워드 − 같은 커브의
   * τ 스팟`. 커브 밖이면 `null` — 0 이 아니다.
   */
  carry12mBp: number | null;
  /**
   * 포워드의 시작·끝이 **둘 다 라이브 호가 노드**인가. 아니면 부트스트랩이
   * 메운 자리라, 같은 자릿수라도 같은 확신이 아니다. v2 포워드 행렬의 규칙을
   * 그대로 승계한다(실측: 1Y·2Y 는 live, 3Y·5Y 는 끝점이 4Y·6Y 라 아니다).
   */
  live: boolean;
};

export type Anchors = {
  /** 커브 as-of. 시나리오 기저의 as-of 와 다르고, 화면이 둘 다 말해야 한다. */
  asof: string;
  /** CD 91일 = IRS 3M 노드. 정책 경로가 닿는 자리. */
  cd: number;
  /** 한국은행 기준금리, 그날 유효한 레벨. 경로 빌더의 기준선. */
  base: number | null;
  irs: Record<IrsTenor, TenorAnchor>;
};

export type ScenarioRow = {
  tenor: IrsTenor;
  spot: number;
  /** 시장이 프라이싱한 12개월 뒤, %. 캐리가 없으면 null. */
  market12m: number | null;
  scenario12m: number;
  /** 시나리오 − 현재, bp. **전망**. */
  deltaBp: number;
  /** 시장이 이미 프라이싱한 12개월 이동, bp. 손잡이와 무관하다. */
  marketCarryBp: number | null;
  /** 모형 Δ − 시장 캐리, bp. **트레이드**. 캐리가 없으면 null. */
  vsMarketBp: number | null;
  live: boolean;
};

/**
 * 리플레이 한 프레임.
 *
 * IRS 는 **절대 레벨**(오늘의 호가 + 편차)이고 KTB 는 **편차 그대로**다. 섞은
 * 것이 아니라 앵커가 한쪽에만 있기 때문이다 — 국고 현물 커브는 `credit_matrix`
 * 쪽이라 이 화면의 앵커에 없다. 화면이 두 축의 이름을 다르게 붙여야 한다
 * («IRS %» / «KTB bp, 베이스라인 대비»).
 */
export type ScenarioFrame = {
  day: number;
  irs: Record<IrsTenor, number>;
  ktbDevBp: Record<KtbTenor, number>;
  dyBp: Record<string, number>;
};

const bp = (pp: number) => pp * 100;

/**
 * 표 다섯 줄.
 *
 * 반올림하지 않는다 — 자릿수는 화면이 정한다. 여기서 반올림하면 `Δ vs 시장` 이
 * 두 반올림의 차가 되어 1bp 가 없던 데서 생긴다.
 */
export function assembleRows(anchors: Anchors, diffs: Diffs): ScenarioRow[] {
  return IRS_TENORS.map((tenor) => {
    const a = anchors.irs[tenor];
    const dPp = diffs.irs[tenor][H_12M];
    const deltaBp = bp(dPp);
    const carry = a.carry12mBp;
    return {
      tenor,
      spot: a.spot,
      market12m: carry === null ? null : a.spot + carry / 100,
      scenario12m: a.spot + dPp,
      deltaBp,
      marketCarryBp: carry,
      vsMarketBp: carry === null ? null : deltaBp - carry,
      live: a.live,
    };
  });
}

/**
 * 리플레이 프레임에 오늘의 커브를 얹는다.
 *
 * D+0 은 편차가 0 이므로 절대 레벨이 스팟과 **정확히** 같다. 그게 이 함수가
 * 지켜야 할 성질이고, 테스트가 그것부터 본다 — 시작점이 어긋나면 재생 내내
 * 어긋난다.
 *
 * KTB 는 절대 레벨을 만들지 않는다. 앵커에 국고 현물이 없기 때문이고(그 커브는
 * `credit_matrix` 쪽이다), 다른 파이프를 끌어와 레벨을 만들면 표(오늘 대비)와
 * 스파크라인(베이스라인 대비)의 기준이 섞인 채로 한 화면에 선다. 편차로 두고
 * 라벨이 그 사실을 말한다.
 */
export function assembleFrames(anchors: Anchors, frames: FrameDiff[]): ScenarioFrame[] {
  return frames.map((f) => {
    const irs = {} as Record<IrsTenor, number>;
    for (const t of IRS_TENORS) irs[t] = anchors.irs[t].spot + f.dyBp[`irs_${t}`] / 100;
    const ktbDevBp = {} as Record<KtbTenor, number>;
    for (const t of KTB_TENORS) ktbDevBp[t] = f.dyBp[`ktb_${t}`];
    return { day: f.day, irs, ktbDevBp, dyBp: f.dyBp };
  });
}
