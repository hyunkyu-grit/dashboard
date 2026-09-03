'use client';

import { useMemo } from 'react';

import { Text } from '@coinbase/cds-web/typography';

import { PanelHead } from './PanelHead';
import {
  FACET_LABEL,
  OBJ_GLYPH,
  OBJ_LABEL,
  OBJ_VAR,
  bucketsOf,
  type FacetKey,
  type ObjType,
  type Selection,
  type TermObject,
} from './ontology';

/**
 * 좌측 20% — **Object Explorer**.
 *
 * ── 이 화면의 주장 [Gotham] ────────────────────────────────────────────────
 * 목록이 아니라 **분포**를 먼저 보여준다. 속성마다 막대가 서고, 막대를 누르면
 * 그것이 곧 필터다. 「조건을 입력해 거른다」가 아니라 「보이는 덩어리를 집는다」 —
 * 수백만 건에서 조건을 찾아 들어갈 때 검색창보다 빠르다는 것이 Object Explorer
 * 의 주장이고, 이 목업이 재현해야 하는 것도 그 문법이다.
 *
 * 세 가지가 그 주장을 실제로 성립시킨다:
 *
 * 1. **막대는 지금 결과에 대해 다시 그려진다.** 필터를 하나 걸면 나머지 패싯의
 *    막대가 그 부분집합의 분포로 바뀐다. 안 그러면 두 번째 막대를 누를 때
 *    «몇 건이 남을지» 를 알 수 없고, 그러면 집는 대신 다시 검색하게 된다.
 * 2. **고른 막대는 자기 패싯 안에서 OR 다.** 「BUY 와 SELL 을 둘 다 고름」이
 *    0 건이 되면 사람은 필터가 고장났다고 읽는다.
 * 3. **0 건이 되는 막대도 남는다.** 사라지면 무엇을 껐는지 못 되돌린다.
 *
 * ── 캐논 ───────────────────────────────────────────────────────────────────
 * 행·머리·아이브로는 이 화면의 기존 부품(`.sr-term-row`·`PanelHead`·
 * `.sr-term-eyebrow`)을 그대로 쓴다. 막대만 새로 만들었고, 그 이유는 CDS 에
 * «값과 개수를 같이 싣는 가로 막대 목록» 부품이 없기 때문이다(`ProgressBar` 는
 * 하나짜리 진행률이라 목록의 비교 축이 없다).
 */

/** 세우는 순서 — **넓은 것에서 좁은 것으로**. 「객체 종류」는 365개 전부에
 *  값이 있고, 「RV 사분위」는 크레딧 35개에만 있다. 좁은 패싯을 위에 두면 첫
 *  화면이 «대부분 해당 없음» 인 막대로 채워진다.
 *
 *  `rv` 는 밴드 바로 뒤다: 둘 다 «지금 이 계열이 어디쯤인가» 를 재는 것이고,
 *  같은 종류의 질문끼리 붙어 있어야 훑을 때 갈아타기 쉽다. */
const FACETS: FacetKey[] = ['type', 'kind', 'tenor', 'issuer', 'band', 'rv'];

export function ObjectExplorer({
  all,
  result,
  sel,
  range,
  onToggle,
  onClear,
  onClearRange,
}: {
  /** 전체 객체 — 「몇 건 중 몇 건」의 분모. */
  all: TermObject[];
  /** 지금 필터를 통과한 객체 — 막대는 **이것**으로 그린다(주장 1). */
  result: TermObject[];
  sel: Selection;
  /** 타임라인 브러시 구간. **패싯이 아니지만 필터다** — 이 띠가 그것을 안 적으면
   *  왼쪽은 「전체를 보고 있습니다」라고 하고 가운데는 「구간 한정」이라고 해서
   *  한 화면이 두 소리를 낸다(실측 2026-08-26). 「비우기」가 둘 다 지우므로
   *  같이 적는 것이 맞다. */
  range: [number, number] | null;
  onToggle: (f: FacetKey, v: string) => void;
  onClear: () => void;
  /** 구간만 푼다 — 패싯은 그대로. 「비우기」와 다른 취소다. */
  onClearRange: () => void;
}) {
  const facets = useMemo(
    () =>
      FACETS.map((f) => ({
        key: f,
        buckets: bucketsOf(result, f),
        /* 지금 결과에 없더라도 **고른 막대는 계속 보인다**(주장 3). 그 값의 개수는
           0 으로 서고, 다시 누르면 꺼진다. */
        picked: [...(sel[f] ?? [])],
      })),
    [result, sel],
  );

  const active = (Object.keys(sel) as FacetKey[]).filter((k) => (sel[k]?.size ?? 0) > 0);

  return (
    /* 세 칸이 각각 **이름 있는 영역**이다. 이름이 없으면 스크린 리더의 «영역
       이동» 이 «영역 1·2·3» 이 되고, 그건 세 칸짜리 화면에서 아무 도움이 안 된다. */
    <section className="sr-term-col" aria-label="Object Explorer">
      <PanelHead
        label="Object Explorer"
        note={`${result.length.toLocaleString('ko-KR')} / ${all.length.toLocaleString('ko-KR')}`}
      />

      <div className="sr-term-body">
        {facets.map(({ key, buckets, picked }) => {
          const max = Math.max(1, ...buckets.map((b) => b.n));
          const shown = [
            ...buckets,
            /* 고른 값인데 이번 결과에 없는 것 — 0 으로 세운다. */
            ...picked.filter((p) => !buckets.some((b) => b.value === p)).map((value) => ({ value, n: 0 })),
          ];
          if (shown.length === 0) return null;
          return (
            /* 패싯 하나가 곧 한 무리다. `aria-labelledby` 로 아이브로를 그 무리의
               이름으로 삼으면, 막대를 하나씩 지날 때마다 «만기» 를 다시 안 들어도
               어느 패싯에 있는지가 유지된다. */
            <div key={key} role="group" aria-labelledby={`sr-term-facet-${key}`}>
              <div className="sr-term-group">
                <span className="sr-term-eyebrow" id={`sr-term-facet-${key}`}>
                  {FACET_LABEL[key]}
                </span>
              </div>
              {shown.map((b) => {
                const on = sel[key]?.has(b.value) ?? false;
                return (
                  <button
                    key={b.value}
                    type="button"
                    className="sr-term-facet"
                    data-on={on}
                    aria-pressed={on}
                    /* 소리로는 «3Y» 와 «12» 가 따로 떨어져 들린다. 한 문장으로
                       묶어 준다 — 보이는 글자를 다 담고 있으므로 WCAG 2.5.3
                       (Label in Name)도 지킨다. */
                    aria-label={`${FACET_LABEL[key]} ${b.value} · ${b.n.toLocaleString('ko-KR')}개`}
                    onClick={() => onToggle(key, b.value)}
                  >
                    {/* 막대는 **글자 뒤에** 깔린다. 옆에 두면 20% 칸에서 라벨과
                        막대가 폭을 나눠 가져 둘 다 못 읽는다 — Gotham 의 그
                        목록도 같은 이유로 채움 배경이다. */}
                    <span
                      className="sr-term-facet-bar"
                      style={{ width: `${(b.n / max) * 100}%` }}
                      aria-hidden
                    />
                    <span className="sr-term-facet-label">
                      {key === 'type' ? (
                        <span
                          className="sr-term-objglyph"
                          style={{ color: OBJ_VAR[typeOf(b.value)] }}
                          aria-hidden
                        >
                          {OBJ_GLYPH[typeOf(b.value)]}
                        </span>
                      ) : null}
                      <Text font="legal" noWrap>
                        {b.value}
                      </Text>
                    </span>
                    <Text font="legal" className="sr-term-facet-n" tabularNumbers noWrap>
                      {b.n.toLocaleString('ko-KR')}
                    </Text>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ── 걸린 필터 — **하나씩 뗄 수 있는 칩** ─────────────────────────────
          첫 판은 「계열 분류 1」 같은 요약 한 줄이었다. Nielsen Norman Group 의
          필터 지침은 적용된 필터를 **칩으로** 보이고 개별 해제를 주라고 한다
          (applied-filter chips + real-time counts). 요약만 있으면 세 개를 걸어
          놓고 그중 하나만 풀고 싶을 때 방법이 「비우기」밖에 없고, 그러면 나머지
          둘을 다시 찾아 눌러야 한다 — 필터가 늘수록 되돌리기가 비싸진다.

          칩에 **패싯 이름을 같이 적는** 이유: 값만 적으면 「3Y」가 만기인지
          입찰 연물인지 알 수 없다. 이 화면에는 같은 문자열이 두 패싯에 산다. */}
      <div className="sr-term-sep sr-term-filterbar" role="group" aria-label="걸린 필터">
        <span className="sr-term-eyebrow">Filters</span>
        {active.length === 0 && !range ? (
          <Text font="legal" color="fgMuted">
            없음 — 전체를 보고 있습니다
          </Text>
        ) : (
          <>
            <div className="sr-term-chips">
              {active.flatMap((k) =>
                [...sel[k]!].map((v) => (
                  <button
                    key={`${k}:${v}`}
                    type="button"
                    className="sr-term-chip"
                    onClick={() => onToggle(k, v)}
                    aria-label={`${FACET_LABEL[k]} ${v} 필터 해제`}
                  >
                    <span className="sr-term-chip-k">{FACET_LABEL[k]}</span>
                    <span className="sr-term-chip-v">{v}</span>
                    <span className="sr-term-chip-x" aria-hidden>
                      ✕
                    </span>
                  </button>
                )),
              )}
              {range ? (
                <button
                  type="button"
                  className="sr-term-chip"
                  onClick={onClearRange}
                  aria-label="구간 필터 해제"
                >
                  <span className="sr-term-chip-k">구간</span>
                  <span className="sr-term-chip-v">
                    {ymd(range[0])}~{ymd(range[1])}
                  </span>
                  <span className="sr-term-chip-x" aria-hidden>
                    ✕
                  </span>
                </button>
              ) : null}
            </div>
            <button type="button" className="sr-term-seg-btn sr-term-clear" onClick={onClear}>
              비우기
            </button>
          </>
        )}
      </div>
    </section>
  );
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** 날짜 한 줄. 타임라인과 **같은 규칙**으로 찍는다(UTC 부품만 — `series.ts` 의
 *  그 이유). 두 패널이 같은 구간을 다른 날짜로 적으면 안 된다. */
function ymd(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/** 라벨 → 종류. 「객체 종류」 패싯의 버킷 값이 한글 라벨이라 되돌려야 한다.
 *  라벨을 키로 쓴 이유는 그 막대가 화면에 한글로 서야 하기 때문이고, 되돌리는
 *  자리를 한 곳으로 모아 두면 그 결합이 한 줄에 보인다. */
function typeOf(label: string): ObjType {
  const hit = (Object.keys(OBJ_LABEL) as ObjType[]).find((t) => OBJ_LABEL[t] === label);
  return hit ?? 'instrument';
}
