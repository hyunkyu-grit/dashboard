/* 금통위 자리와 «변화량» 입력.
 *
 * ## 왜 바꿨나 [OWNER 2026-08-24]
 *
 * 예전 입력은 **레벨(누적)** 이었다. q1 −25, q2 −25 가 「한 번 인하하고 유지」를
 * 뜻했고, 그래서 **동결을 유지하려면 뒤의 칸을 전부 같은 값으로 다시 골라야
 * 했다.** 오너의 말: 「동결인 것도 다 선택해줘야 해서 아주 귀찮음」.
 *
 * 트레이더가 실제로 갖는 뷰는 «회의마다 무엇을 하나» 다 — 동결이면 0, 인상이면
 * +25, 인하면 −25. 그래서 입력을 **변화량**으로 받는다. 안 건드린 회의는 0 이고,
 * 뷰가 있는 회의만 고르면 된다.
 *
 * ## 자리는 분기가 아니라 회의다
 *
 * 오너: 「몇월 금통위는 규칙성이 있으니까 그렇게 하고」. 실제로 규칙이 있다 —
 * 한국은행 금통위는 **연 8회, 1·2·4·5·7·8·10·11월**이고 2026년 실제 일정 여덟
 * 건이 정확히 그 패턴이다(`src/data/calendar.json`, 전건 `verified`).
 *
 *     1·2월 → Q1    4·5월 → Q2    7·8월 → Q3    10·11월 → Q4
 *
 * **분기마다 정확히 두 번**이다. 그래서 회의 단위로 받아도 모형의 분기 단위로
 * 접는 데 애매함이 없다 — 그 분기의 마지막 회의 뒤 레벨이 곧 그 분기의 값이다.
 * 모형은 분기 모형이고 그 단위는 안 건드린다.
 *
 * ## 2027 부터는 우리가 미룬 것이다
 *
 * 달력은 **2026년만** 있다. 한은이 그 뒤 일정을 아직 안 냈다. 그래서 2027 이후는
 * 위 규칙으로 **달까지만** 세우고 날짜는 안 지어낸다 — 화면이 「한은이 아직 안
 * 낸 일정이라 규칙으로 미뤄 놓은 자리예요」 라고 말한다. 날짜를 지어내면 그
 * 화면은 검사할 수 없는 거짓말을 하나 지게 된다.
 */

import calendarJson from '@/data/calendar.json';

import { PINNED_Q } from './path';

/** 한국은행 금통위가 서는 달. 2026년 실제 일정 여덟 건에서 읽었다. */
export const MPC_MONTHS = [1, 2, 4, 5, 7, 8, 10, 11] as const;

/** 그 달이 속하는 분기(0-based). 1·2월 → 0 … 10·11월 → 3. */
function quarterOfMonth(m: number): number {
  return Math.floor((m - 1) / 3);
}

export type Meeting = {
  /** URL 과 상태의 키. 날짜를 아는 것은 `2026-08-27`, 모르는 것은 `2027-01`. */
  key: string;
  /** 화면 라벨. 날짜를 아는 것은 `8/27`, 모르는 것은 `1월`.
   *
   *  **표기 자체가 구분이다** — 날짜가 있으면 날짜를, 없으면 달만 쓴다. 예전에
   *  물음표를 붙였는데(`27년 1월?`) 라벨 폭이 줄마다 달라져 셀렉트가 들쭉날쭉
   *  섰고, 물음표 없이도 「달만 적혀 있다」 가 이미 그 사실을 말한다 [OWNER].
   *  연도는 위의 분기 제목(`2027Q1`)이 지므로 라벨에서 뺀다. */
  label: string;
  /** 경로의 몇 번째 분기인가 (0..PINNED_Q−1). */
  q: number;
  /** `2026Q3` — 그 분기의 이름. */
  qLabel: string;
  /** 한은이 낸 일정인가. `false` 면 규칙으로 미룬 자리다. */
  dated: boolean;
};

type CalEvent = { date: string; kind: string };

const MPC_DATES: string[] = (calendarJson as { events: CalEvent[] }).events
  .filter((e) => e.kind === 'mpc')
  .map((e) => e.date)
  .sort();

/** `2026Q3` 같은 이름. */
function qName(year: number, q: number): string {
  return `${year}Q${q + 1}`;
}

/**
 * 오늘 **뒤**에 오는 금통위를 경로 지평(8분기)만큼 세운다.
 *
 * 첫 분기는 이미 지나간 회의가 있을 수 있어 두 번이 아닐 수 있다 — 2026-08-24
 * 기준으로 2026Q3 은 7/16 이 지났고 8/27 하나만 남는다. 그것이 정상이고,
 * 화면이 그 분기를 한 줄로 보여 준다.
 */
export function meetings(today: Date): Meeting[] {
  const y0 = today.getFullYear();
  const q0 = quarterOfMonth(today.getMonth() + 1);
  const out: Meeting[] = [];

  for (let i = 0; i < PINNED_Q; i += 1) {
    const q = (q0 + i) % 4;
    const year = y0 + Math.floor((q0 + i) / 4);
    for (const m of MPC_MONTHS) {
      if (quarterOfMonth(m) !== q) continue;
      const real = MPC_DATES.find(
        (d) => Number(d.slice(0, 4)) === year && Number(d.slice(5, 7)) === m,
      );
      if (real) {
        /* 이미 지나간 회의는 자리를 안 준다 — 오늘 이후의 결정만 놓을 수 있다. */
        if (real <= iso(today)) continue;
        out.push({
          key: real,
          label: `${Number(real.slice(5, 7))}/${Number(real.slice(8, 10))}`,
          q: i,
          qLabel: qName(year, q),
          dated: true,
        });
      } else {
        out.push({
          key: `${year}-${String(m).padStart(2, '0')}`,
          label: `${m}월`,
          q: i,
          qLabel: qName(year, q),
          dated: false,
        });
      }
    }
  }
  return out;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** 회의별 변화량, bp. 없는 키는 0(동결)이다 — **그게 이 설계의 요점이다.** */
export type Steps = Record<string, number>;

/**
 * 회의별 변화량을 **분기 말 레벨** 여덟으로 접는다.
 *
 * 누적이고, 회의가 없는 분기는 직전 분기의 레벨을 그대로 잇는다. 모형이 받는
 * 것은 여전히 「분기별 정책금리 편차 레벨」 이라 엔진 계약이 안 바뀐다.
 */
export function stepsToDots(steps: Steps, ms: readonly Meeting[]): number[] {
  /* 분기마다 «그 분기의 마지막 회의 뒤 레벨» 을 적는다. 회의가 없는 분기는
     `null` 로 남고, 아래에서 직전 분기의 레벨을 그대로 잇는다. */
  const endOfQ = new Array<number | null>(PINNED_Q).fill(null);
  let level = 0;
  for (const m of ms) {
    level += steps[m.key] ?? 0;
    endOfQ[m.q] = level;
  }

  const dots = new Array<number>(PINNED_Q).fill(0);
  let carry = 0;
  for (let q = 0; q < PINNED_Q; q += 1) {
    carry = endOfQ[q] ?? carry;
    dots[q] = carry;
  }
  return dots;
}

/** 회의 뒤의 **누적 레벨**, bp. 행마다 옆에 세워서 경로가 눈에 보이게 한다. */
export function runningLevels(steps: Steps, ms: readonly Meeting[]): number[] {
  let level = 0;
  return ms.map((m) => {
    level += steps[m.key] ?? 0;
    return level;
  });
}

/* ── URL ────────────────────────────────────────────────────────────────────
 *
 * **키로 적는다.** 순번으로 적으면 짧지만, 하루 지나 첫 회의가 목록에서 빠지는
 * 순간 같은 주소가 다른 경로를 뜻하게 된다. 공유한 링크가 조용히 다른 말을
 * 하는 것이 이 리포가 제일 싫어하는 종류의 버그다.
 *
 *     p=2026-08-27:-25,2027-01:-25
 *
 * 0 인 회의는 안 적는다 — 동결이 기본이라 적을 것이 없다. */
export function stepsToParam(steps: Steps): string | undefined {
  const on = Object.entries(steps).filter(([, v]) => v !== 0);
  if (on.length === 0) return undefined;
  return on
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
}

/** 주소를 안 믿는다 — 하나라도 이상하면 통째로 버리고 동결로 간다. */
export function paramToSteps(raw: string | undefined, ms: readonly Meeting[]): Steps | null {
  if (!raw) return null;
  const keys = new Set(ms.map((m) => m.key));
  const out: Steps = {};
  for (const part of raw.split(',')) {
    const at = part.lastIndexOf(':');
    if (at < 1) return null;
    const key = part.slice(0, at);
    const v = Number(part.slice(at + 1));
    if (!keys.has(key) || !Number.isFinite(v) || !STEP_CHOICES.includes(v)) return null;
    out[key] = v;
  }
  return out;
}

/** 한 회의에서 고를 수 있는 것. 25bp 배수 둘씩 — 그 이상은 이 화면의 뷰가 아니다. */
export const STEP_CHOICES = [50, 25, 0, -25, -50];


/* ── 시장이 프라이싱한 경로 ────────────────────────────────────────────────
 *
 * 오너: 「내가 생각하는 금리 커브가 이렇다면 시장 금리는 이럴거다」 의 반대쪽 —
 * **시장은 지금 뭘 보고 있나**. 기준선이 있어야 내 뷰가 시장과 얼마나 다른지가
 * 값이 된다.
 *
 * 재료는 이미 있다. `anchors.irs['1y'].carry12mBp` 는 「1Y1Y 포워드 − 1Y 스팟」
 * 이고, 1Y IRS 가 향후 1년의 평균 CD 이므로 그 차이가 곧 **시장이 보는 12개월
 * 정책 이동**이다. 백엔드를 새로 만들 필요가 없다.
 *
 * ## 어디까지가 사실이고 어디부터가 우리 배분인가
 *
 * 총량(bp)은 시장 호가에서 나온 **사실**이다. 그것을 «회의 몇 번» 으로 나누는
 * 것은 **우리 배분**이다 — 시장은 회의별 확률을 우리에게 말해 주지 않는다.
 * 그래서 25bp 단위로 반올림해 **가까운 회의부터** 채운다(시장은 보통 가까운
 * 회의를 먼저 프라이싱한다). 화면이 그 둘을 갈라 말해야 한다. */

/** 시장이 보는 12개월 정책 이동을 25bp 배수의 회의 결정으로 편다.
 *
 *  총량은 시장 호가, 배분은 우리 것. `carry` 가 없으면 `null` — 0 이 아니다. */
export function marketSteps(carry12mBp: number | null, ms: readonly Meeting[]): Steps | null {
  if (carry12mBp === null || !Number.isFinite(carry12mBp)) return null;
  const n = Math.round(carry12mBp / 25);
  if (n === 0) return {};
  const dir = n > 0 ? 25 : -25;
  const out: Steps = {};
  /* 12개월 안의 회의 = 앞의 네 분기. 그 밖으로는 안 민다 — 캐리가 말하는 창이
     12개월이라 그 밖에 놓으면 없는 정보를 지어내는 것이다. */
  const within = ms.filter((m) => m.q < 4);
  for (let i = 0; i < Math.abs(n) && i < within.length; i += 1) {
    out[within[i]!.key] = dir;
  }
  return out;
}
