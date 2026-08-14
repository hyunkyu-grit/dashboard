/**
 * 직접 넣은 포지션 한 줄 — **상품 하나**이지 스왑 다리 하나가 아니다.
 *
 * 처음에는 다리 하나였다(방향·테너·명목·고정금리). 틀린 모델이었다. 이 화면
 * 옆의 모니터는 이미 세상을 아웃라이트·스프레드·버터플라이·포워드로 나눠
 * 보여주고, 트레이더가 넣고 싶은 것은 "3년 수취"가 아니라 **"3s10s 100억"**
 * 이다. 다리를 손으로 둘 만들고 명목을 눈대중으로 맞추라고 하는 것은 도구가
 * 할 일을 사람에게 미루는 것이었다 [OWNER, 2026-08-07].
 *
 * ─ 전개는 백엔드가 한다 ──────────────────────────────────────────────────
 * 다리 가중은 기준일 커브에서 DV01 중립으로 잡히고, 브라우저는 계산하지
 * 않는다(design spec §16). 그래서 이 모듈에는 다리를 만드는 산술이 없다 —
 * POST /api/instruments/expand가 페이로드 모양 그대로 돌려주고, 화면은 그것을
 * 보여주기만 한다. 다리 규칙 자체도 새로 쓰지 않았다: backtest._legs_for가
 * 정한 것(스프레드 = 롱 B/숏 A, 플라이 = 벨리 2 vs 윙 각 1)을 그대로 쓴다.
 * 두 화면이 같은 "3s10s"를 다르게 이해하면 비교가 불가능해진다.
 *
 * ─ 남은 것 ────────────────────────────────────────────────────────────────
 * 여기 있는 것은 **입력 폼의 상태**뿐이다: 무슨 상품인지, 어느 방향인지, 얼마나,
 * 그리고 금리를 par 에서 옮겼다면 얼마로. 억 원 단위도 여기서만 쓴다(페이로드는 원).
 *
 * 고정금리 기본값은 여전히 **그 날의 par** 다 — 다리마다 par 로 쳐지면 진입 MtM 이
 * 0이고, 결과에 남는 것이 경로가 만든 손익뿐이다. 이 화면이 묻는 것이 정확히
 * 그것이다. 다만 이제 덮어쓸 수 있다 [트레이더 피드백 3, 2026-08-07]: 이미 들고
 * 있는 포지션을 이 경로에 놓아 보려면 진입 레벨이 par 가 아니다. 덮어쓴 순간
 * 진입 MtM 이 0이 아니게 되고, 그건 오프마켓 진입이 실제로 그렇다는 뜻이다.
 */

/** 모니터의 그룹과 같은 이름. GROUP_LABEL(ui/rows.ts)의 부분집합이다 —
 * 변동성은 포지션이 아니라 관측이라 여기 없다.
 *
 * 현금채권·자산스왑이 뒤에 붙는다 [OWNER, 2026-08-14 — "시뮬레이션 포지션에
 * 스왑 뿐만아니라 현금채권이랑 자산스왑 추가해줘"]. 백테스트의 그 두 탭과
 * **같은 상품·같은 id 문법**(`CB:KTB:3Y`)이라, 같은 문자열이 세 화면에서
 * 같은 것을 뜻한다. */
export type InstrumentKind =
  | "outright"
  | "spread"
  | "fly"
  | "forward"
  | "cashbond"
  | "assetswap";

export const KIND_LABEL: Record<InstrumentKind, string> = {
  outright: "아웃라이트",
  spread: "스프레드",
  fly: "버터플라이",
  forward: "포워드",
  cashbond: "현금채권",
  assetswap: "자산스왑",
};

export const KIND_ORDER: InstrumentKind[] = [
  "outright",
  "spread",
  "fly",
  "forward",
  "cashbond",
  "assetswap",
];

/** 채권은 **살 수만** 있다 [OWNER, 2026-08-14 — "국고채는 매도는 없는거고"].
 * 공매도는 채권을 빌리는 것이고 그 대차료를 이 화면은 모른다 — 모르는 비용을
 * 0 으로 두면 공매도가 늘 이기는 시뮬이 된다. 백엔드도 같은 이유로 거절한다
 * (`app/instruments._expand_bond`), 여기서는 방향 칸 자체를 안 그린다. */
export function isBondKind(kind: InstrumentKind): boolean {
  return kind === "cashbond" || kind === "assetswap";
}

/** GET /api/instruments의 한 항목. */
export interface InstrumentOption {
  id: string;
  label: string;
  /** 모니터의 표가 쓰는 **주요** 블록에 드는가. 판정은 백엔드 한 곳에서 한다
   * (`app/derive.is_key`, `app/forwards.KEY_FORWARDS`) — 프론트가 자기 목록을
   * 들면 두 화면의 "주요 스프레드"가 갈릴 수 있고, 그 순간 비교가 끝난다.
   *
   * 고를 수 있는 것을 줄이지 않는다. 106개가 그대로 다 있고 이 플래그는
   * **순서와 묶음**만 정한다 [OWNER, 2026-08-07 — "자유도를 줄이는 것이 기능을
   * 줄이는 것과 다르다"]. 옛 백엔드가 이 필드를 안 보내면 undefined 라 전부
   * 전체 묶음으로 떨어진다: 목록이 사라지는 것보다 안전한 실패다. */
  key?: boolean;
}

export type InstrumentCatalog = Record<InstrumentKind, InstrumentOption[]>;

/** 화면이 들고 있는 한 줄. */
export interface ManualPosition {
  /** 행의 안정적인 신원 — 정렬·삭제·React key가 여기 매달린다. */
  id: string;
  /** 상품 id. `10Y` · `3Y-10Y` · `2Y-5Y-10Y` · `1Yx1Y`. 모니터가 쓰는 문법
   * 그대로라, 같은 문자열이 두 화면에서 같은 것을 뜻한다. */
  seriesId: string;
  /** +1 = 그 상품의 **호가 값을 롱**. 모니터·백테스트와 같은 정의다.
   *
   * 스왑 다리의 부호와 헷갈리기 쉬워서 적어 둔다: 아웃라이트 10Y를 롱한다는
   * 것은 금리가 오르면 이득이라는 뜻이고, 그것은 고정 **지급**이다. 그 뒤집기는
   * 백엔드(app/instruments.py)가 한 곳에서 한다. */
  direction: 1 | -1;
  /** 억 원. 사람이 말하는 단위로 들고 있다가 요청에서만 원으로 바꾼다. */
  notionalEok: number;
  /** 다리별 고정금리 덮어쓰기, 퍼센트 [트레이더 피드백 3, 2026-08-07:
   * "기본적으로는 Par Rate가 들어가있되, 원하면 내가 원하는 금리를 넣고 싶다"].
   *
   * **다리별**인 이유: 한 줄이 상품 하나이고 상품은 다리를 여럿 갖는다.
   * 3s10s 에 금리 하나를 넣으라고 하면 그 하나가 3Y 것인지 10Y 것인지 말할 수
   * 없다. 화면이 이미 다리마다 par 를 적고 있으므로, 그 칸이 그대로 입력칸이
   * 되는 것이 가장 적은 새 개념이다.
   *
   * 키는 다리 id(`3Y-10Y#0`)다. 상품을 바꾸면 다리가 달라지므로 그때 비운다 —
   * 남겨 두면 3s10s 의 3Y 금리가 2s5s 의 2Y 다리에 조용히 붙는다.
   *
   * 없거나 항목이 없으면 그 다리는 par 다. 이 필드가 통째로 없는 옛 저장분도
   * 그대로 유효하다.
   *
   * 대가를 적어 둔다: par 로 치면 진입 MtM 이 0이라 결과에 남는 것이 경로가
   * 만든 손익뿐인데, 덮어쓰면 진입 시점에 이미 평가손익이 있다. 그건 오프마켓
   * 진입이 실제로 그렇다는 뜻이지 오류가 아니다. 화면이 그 사실을 말한다. */
  rateOverrides?: Record<string, number>;
}

/** 백엔드가 돌려준 다리 하나 — 화면에는 읽기 전용으로만 보인다.
 *
 * 실제로 오는 것은 페이로드에 그대로 실리는 **포지션 한 줄 전체**이고
 * (`app/instruments._leg_row`), 이 인터페이스는 화면이 읽는 부분집합이다. */
export interface ExpandedLeg {
  id: string;
  tenor: string;
  direction: number;
  notional: number;
  couponRate: number;
  startDate: string;
  maturityDate: string;
  /** `"swap"` 또는 `"bond"`. 자산스왑 한 줄은 둘 다 갖는다 — 채권 매수 +
   * 같은 명목의 페이 고정이라, 다리 목록에 두 줄이 서로 다른 문법으로 뜬다. */
  bondType?: string;
  /** 채권 다리의 이름(`국고채 3Y`). 스왑 다리는 테너로 충분하다. */
  name?: string;
}

/** 이 다리가 채권인가 — 다리 목록이 "수취/지급" 대신 "매수" 를 적을지 정한다. */
export function isBondLeg(leg: ExpandedLeg): boolean {
  return leg.bondType === "bond";
}

export const DEFAULT_SERIES_ID = "3Y";
export const DEFAULT_NOTIONAL_EOK = 100;

export function newManualPosition(seq: number): ManualPosition {
  return {
    id: `manual-${seq}`,
    seriesId: DEFAULT_SERIES_ID,
    direction: 1,
    notionalEok: DEFAULT_NOTIONAL_EOK,
  };
}

/** id만 보고 종류를 안다 — 백엔드의 kind_of와 같은 규칙이고, 목록을 다시
 * 훑지 않아도 되게 한다. 접두사가 **가장 먼저**인 이유: `ASW:KTB:1.5Y` 에는
 * `x` 가 없지만 `CB:...` 도 `-` 가 없어 아웃라이트로 읽힌다. `x`가 그 다음인
 * 이유는 포워드에 `-`가 없기 때문이다. */
export function kindOf(seriesId: string): InstrumentKind {
  if (seriesId.startsWith("CB:")) return "cashbond";
  if (seriesId.startsWith("ASW:")) return "assetswap";
  if (seriesId.includes("x")) return "forward";
  const dashes = (seriesId.match(/-/g) ?? []).length;
  return dashes === 0 ? "outright" : dashes === 1 ? "spread" : "fly";
}

/** 방향을 뭐라고 부르는가 [OWNER, 2026-07-31 — BacktestWindow의 규칙 재사용].
 *
 * 아웃라이트·포워드는 **페이/리시브**다. 원화 데스크는 이걸 동사로 쓴다
 * ("IRS 페이했다"). 고정 지급/수취는 회계의 등록부이지 트레이딩의 말이 아니다.
 * 스프레드·플라이는 그렇게 부르지 않는다 — 스티프너/플래트너이고, 벨리를
 * 사는지 파는지다. */
export function directionLabel(seriesId: string, direction: 1 | -1): string {
  const kind = kindOf(seriesId);
  // 채권은 방향 칸이 안 그려진다(isBondKind). 그래도 라벨을 물으면 참을 답한다.
  if (isBondKind(kind)) return "매수";
  if (kind === "outright" || kind === "forward") return direction === 1 ? "페이" : "리시브";
  if (kind === "spread") return direction === 1 ? "스티프너" : "플래트너";
  return direction === 1 ? "벨리 매도" : "벨리 매수";
}

/** 두 방향의 라벨 쌍 — 세그먼트가 읽는다. */
export function directionOptions(seriesId: string): { value: "long" | "short"; label: string }[] {
  return [
    { value: "long", label: directionLabel(seriesId, 1) },
    { value: "short", label: directionLabel(seriesId, -1) },
  ];
}

/** 이 줄이 실행 가능한가. 불가능하면 그 이유. */
export function positionError(p: ManualPosition): string | null {
  if (!p.seriesId) return "상품을 골라주세요";
  if (!(p.notionalEok > 0)) return "명목이 0보다 커야 해요";
  return null;
}

export function notionalToKrw(eok: number): number {
  return eok * 1e8;
}

/** 이 다리가 실제로 쓸 고정금리(퍼센트) — 덮어썼으면 그 값, 아니면 par. */
export function effectiveRate(leg: ExpandedLeg, p: ManualPosition): number {
  const v = p.rateOverrides?.[leg.id];
  return typeof v === "number" && Number.isFinite(v) ? v : leg.couponRate;
}

/** 페이로드에 실을 다리들. **한 곳에서만** 덮어쓴다 — 화면과 요청이 각자
 * 적용하면 보이는 금리와 평가되는 금리가 갈라질 수 있다. */
export function applyRateOverrides(legs: ExpandedLeg[], p: ManualPosition): ExpandedLeg[] {
  if (!p.rateOverrides) return legs;
  return legs.map((l) => {
    const r = effectiveRate(l, p);
    return r === l.couponRate ? l : { ...l, couponRate: r };
  });
}

/** 덮어쓴 다리가 하나라도 있는가 — 화면이 진입 MtM 안내를 띄울지 정한다. */
export function hasRateOverride(legs: ExpandedLeg[], p: ManualPosition): boolean {
  return legs.some((l) => effectiveRate(l, p) !== l.couponRate);
}
