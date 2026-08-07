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
 * 여기 있는 것은 **입력 폼의 상태**뿐이다: 무슨 상품인지, 어느 방향인지, 얼마나.
 * 억 원 단위도 여기서만 쓴다(페이로드는 원). 고정금리는 더 이상 사용자가 넣지
 * 않는다 — 다리마다 그 날 par로 쳐지고, 그래서 진입 MtM이 0이며 결과에 남는
 * 것이 **경로가 만든 손익뿐**이다. 이 화면이 묻는 것이 정확히 그것이다.
 */

/** 모니터의 그룹과 같은 이름. GROUP_LABEL(ui/rows.ts)의 부분집합이다 —
 * 변동성은 포지션이 아니라 관측이라 여기 없다. */
export type InstrumentKind = "outright" | "spread" | "fly" | "forward";

export const KIND_LABEL: Record<InstrumentKind, string> = {
  outright: "아웃라이트",
  spread: "스프레드",
  fly: "버터플라이",
  forward: "포워드",
};

export const KIND_ORDER: InstrumentKind[] = ["outright", "spread", "fly", "forward"];

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
}

/** 백엔드가 돌려준 다리 하나 — 화면에는 읽기 전용으로만 보인다. */
export interface ExpandedLeg {
  id: string;
  tenor: string;
  direction: number;
  notional: number;
  couponRate: number;
  startDate: string;
  maturityDate: string;
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
 * 훑지 않아도 되게 한다. `x`가 먼저인 이유는 포워드에 `-`가 없기 때문이다. */
export function kindOf(seriesId: string): InstrumentKind {
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
