/**
 * 이 화면의 상태를 **주소로** 적는다 — Shneiderman 의 «extract» 나머지 절반.
 *
 * ── 왜 이것이 접근성·사용성 항목인가 [2026-08-27] ───────────────────────────
 * 「추출」은 이미 결과를 클립보드로 내보낸다(TSV). 그런데 분석 화면에서 사람이
 * 실제로 건네고 싶은 것은 표가 아니라 **자리**다 — "여기를 봐" 라고 말하려면
 * 필터 세 개와 초점 하나를 말로 불러 주는 수밖에 없었고, 그건 옮겨 적는 동안
 * 틀린다. 주소 한 줄이 그 일을 대신한다.
 *
 * 되돌리기도 같이 딸려 온다. 브라우저의 뒤로 가기는 사람이 이미 아는 취소
 * 손짓이고, 그걸 못 쓰는 화면은 «여기서 나가면 처음부터» 라는 뜻이 된다.
 *
 * ── 배관은 앱 것을 **임포트**한다 (캐논 규칙 1) ────────────────────────────
 * `ui/useUrlState.ts` 가 이미 이 앱의 규약을 진다: 라우터가 아니라
 * `history.replaceState` 로 쓰고(v1 의 프로덕션 전용 라우터 사고가 그 근거),
 * 마운트와 `popstate` 에서만 읽는다. 새로 만들지 않는다 — 두 벌이 되면 한쪽만
 * 그 사고를 기억하게 된다.
 *
 * 이 파일이 더하는 것은 **부호화**뿐이다. `useUrlState` 는 키 하나에 문자열
 * 하나라, 집합(패싯)과 구간(두 수)을 문자열로 접었다 펴는 자리가 필요하다.
 *
 * ── 부호화 규약 ────────────────────────────────────────────────────────────
 *     tf   패싯   `kind~BSS|국고채;tenor~3Y`      (패싯 `;` · 키와 값 `~` · 값 `|`)
 *     tr   구간   `2026-01-02..2026-03-04`        (**날짜**로 적는다 — 아래)
 *     ta   축     graph | timeline | table | chart
 *     to   초점   객체 id 그대로
 *     ts   구간   차트 스팬(1M…ALL)
 *     tk   정렬   `z:desc`
 *
 * 구간을 epoch ms 가 아니라 날짜로 적는 이유가 둘이다. 하나는 사람이 읽을 수
 * 있다는 것이고, 다른 하나는 **이 화면의 시간이 원래 날 단위**라는 것이다 —
 * 시간이 있는 객체의 `t` 는 전부 UTC 자정이라(`isoToMs`), 날 경계로 넓혀 적어도
 * 걸러지는 집합이 같다. 브러시의 ms 를 그대로 적으면 주소가 못 읽을 수가 되고,
 * 복원해도 같은 집합이 나온다 — 못 읽는 쪽을 고를 이유가 없다.
 *
 * ── 못 적는 값은 **버리지 않고 남긴다** ────────────────────────────────────
 * 값 안에 구분자가 들어 있으면 그 값만 주소에서 빠진다. 지금 데이터에는 그런
 * 값이 없지만(실측: 패싯 값 전부 한글·숫자·영문), 백엔드가 라벨을 바꾸는 날
 * 조용히 다른 필터가 복원되는 것보다 **안 적히는 편**이 낫다.
 */

import type { FacetKey, Selection } from './ontology';

const FACET_SEP = ';';
const KV_SEP = '~';
const VAL_SEP = '|';

/** 주소에 적을 수 있는 패싯 키. 모르는 키가 주소에 있으면 무시한다 — 옛 주소가
 *  새 화면을 깨뜨리지 않게 하는 값싼 보험이다. */
const FACET_KEYS: FacetKey[] = ['type', 'kind', 'tenor', 'issuer', 'band', 'rv'];

function safe(v: string): boolean {
  return !v.includes(FACET_SEP) && !v.includes(KV_SEP) && !v.includes(VAL_SEP);
}

export function encodeFacets(sel: Selection): string | undefined {
  const parts: string[] = [];
  for (const k of FACET_KEYS) {
    const vs = [...(sel[k] ?? [])].filter(safe);
    if (vs.length > 0) parts.push(`${k}${KV_SEP}${vs.join(VAL_SEP)}`);
  }
  return parts.length > 0 ? parts.join(FACET_SEP) : undefined;
}

export function decodeFacets(raw: string | undefined): Selection {
  const out: Selection = {};
  if (!raw) return out;
  for (const part of raw.split(FACET_SEP)) {
    const at = part.indexOf(KV_SEP);
    if (at < 0) continue;
    const k = part.slice(0, at) as FacetKey;
    if (!FACET_KEYS.includes(k)) continue;
    const vs = part
      .slice(at + 1)
      .split(VAL_SEP)
      .filter((v) => v !== '');
    if (vs.length > 0) out[k] = new Set(vs);
  }
  return out;
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** UTC 부품만 — 타임라인·칩과 **같은 규칙**이다(둘이 같은 구간을 다른 날짜로
 *  적으면 안 된다). */
function ymd(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

function msOf(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

/** 날 경계로 **넓혀** 적는다(시작은 내림, 끝은 그날 끝). 좁히면 가장자리의
 *  사건이 복원할 때 빠지고, 그건 같은 주소가 다른 결과를 내는 것이다. */
export function encodeRange(r: [number, number] | null): string | undefined {
  if (!r) return undefined;
  const [a, b] = r[0] <= r[1] ? r : [r[1], r[0]];
  return `${ymd(a)}..${ymd(b)}`;
}

const DAY_MS = 86_400_000;

export function decodeRange(raw: string | undefined): [number, number] | null {
  if (!raw) return null;
  const [a, b] = raw.split('..');
  const lo = msOf(a ?? '');
  const hi = msOf(b ?? '');
  if (lo == null || hi == null || hi < lo) return null;
  /* 끝날의 **자정 직전**까지. 자정으로 두면 마지막 날의 객체가 경계에 걸려
     빠진다(`t >= lo && t <= hi` 라 자정 정각은 살지만, 날 안의 다른 시각을 쓰는
     원천이 붙는 날 조용히 하루가 사라진다). */
  return [lo, hi + DAY_MS - 1];
}

export type SortSpec<K extends string> = { key: K; desc: boolean };

export function encodeSort<K extends string>(s: SortSpec<K>): string {
  return `${s.key}:${s.desc ? 'desc' : 'asc'}`;
}

export function decodeSort<K extends string>(
  raw: string | undefined,
  allowed: readonly K[],
  fallback: SortSpec<K>,
): SortSpec<K> {
  if (!raw) return fallback;
  const [k, dir] = raw.split(':');
  if (!allowed.includes(k as K)) return fallback;
  return { key: k as K, desc: dir !== 'asc' };
}
