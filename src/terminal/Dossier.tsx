'use client';

import { useMemo } from 'react';

import { Text } from '@coinbase/cds-web/typography';

import { PanelHead } from './PanelHead';
import {
  LINK_LABEL,
  OBJ_GLYPH,
  OBJ_LABEL,
  OBJ_VAR,
  type LinkKind,
  type Ontology,
  otherEnd,
  type TermObject,
} from './ontology';

/**
 * 우측 20% — **도시에(dossier)**.
 *
 * Gotham 에서 객체를 고르면 그 객체의 «카드» 가 열린다. 세 덩어리다:
 *
 *   1. **속성** — 이 객체가 무엇인가
 *   2. **링크** — 무엇과 닿아 있는가 (링크 이름별로 묶어서)
 *   3. **출처** — 이 값이 어디서 왔는가
 *
 * 셋째가 이 리포와 가장 잘 맞는다. CLAUDE.md 도 캐논도 가드도 전부 «그 값이
 * 어디서 왔는가» 를 묻는 장치이고, 여기서는 그 질문이 **화면의 한 칸**이 된다.
 * 목업이라 문자열이지만 자리는 진짜다 — 실제로 붙일 때 이 칸이 SQL 표 이름과
 * 워터마크를 든다.
 *
 * ── 링크 목록이 곧 이동 수단이다 ───────────────────────────────────────────
 * 링크를 누르면 초점이 그리로 옮겨간다. 그래프에서 노드를 누르는 것과 **같은
 * 일**이고, 그래서 이 패널은 그래프의 목록판이다. 그래프를 못 읽는 사람도
 * 같은 탐색을 할 수 있어야 한다(그래프만 있으면 그 화면은 마우스가 좋은
 * 사람만의 것이 된다).
 */

/** 링크를 한 번에 몇 개까지 세울지. 계열 하나에 체결이 수십 개 붙으므로 전부
 *  세우면 도시에가 스크롤 통이 된다 — «몇 건 중 몇 건» 을 적고 접는다. */
const MAX_LINKS_PER_KIND = 8;

export function Dossier({
  ontology,
  focusId,
  onFocus,
  visible,
}: {
  ontology: Ontology;
  focusId: string | null;
  onFocus: (id: string) => void;
  visible: Set<string>;
}) {
  const obj = focusId ? ontology.byId.get(focusId) : undefined;

  const grouped = useMemo(() => {
    if (!obj) return [];
    const m = new Map<string, TermObject[]>();
    for (const l of ontology.adj.get(obj.id) ?? []) {
      const other = ontology.byId.get(otherEnd(l, obj.id));
      if (!other || !visible.has(other.id)) continue;
      if (!m.has(l.kind)) m.set(l.kind, []);
      m.get(l.kind)!.push(other);
    }
    return [...m.entries()].map(([kind, items]) => ({ kind, items }));
  }, [ontology, obj, visible]);

  if (!obj) {
    return (
      <section className="sr-term-col" aria-label="Dossier">
        <PanelHead label="Dossier" note="선택 없음" />
        <div className="sr-term-body">
          <div className="sr-term-empty">
            <Text font="label2" color="fgMuted">
              객체를 고르면 그 객체가 무엇이고 무엇과 닿아 있는지가 섭니다
            </Text>
            <span className="sr-term-eyebrow">속성 · 링크 · 출처</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="sr-term-col" aria-label="Dossier">
      <PanelHead label="Dossier" note={OBJ_LABEL[obj.type]} />
      <div className="sr-term-body">
        {/* 제목 — 종류 글리프가 색과 모양 둘 다로 종류를 말한다. */}
        <div className="sr-term-dossier-title">
          <span className="sr-term-objglyph" style={{ color: OBJ_VAR[obj.type] }} aria-hidden>
            {OBJ_GLYPH[obj.type]}
          </span>
          {/* 이름 두 줄은 **캐논 부품**이다 — `.sr-name-stack`(label1 + legal 뮤트),
              `table/InstrumentTable.tsx` 의 이름 칸이 쓰는 그것. 여기서는 감싸는
              `<span>` 하나뿐이었고, CDS `Text` 가 인라인이라 두 줄이 한 줄로
              붙어 「국고 3Ygovt · 3Y」로 나왔다(실측 2026-08-27). 캐논 규칙 1의
              그 자리다: 같은 모양을 손으로 다시 만들면 한쪽만 낡는다. */}
          <span className="sr-name-stack">
            <Text font="label1" noWrap>
              {obj.title}
            </Text>
            <Text font="legal" color="fgMuted">
              {obj.subtitle}
            </Text>
          </span>
        </div>

        <div className="sr-term-group">
          <span className="sr-term-eyebrow">Properties</span>
        </div>
        {/* 고정폭 라벨 열 — 「얼라인」 2 가 «라벨을 옆에 둬야 하는 설정 패널은
            고정폭 라벨 열로만» 이라고 하는 그 경우다. 값이 짧고 줄이 많아서
            라벨을 위에 두면 세로가 두 배가 된다. */}
        {obj.props.map((p) => (
          <div className="sr-term-kv" key={p.k}>
            <span className="sr-term-kv-k">
              <Text font="legal" color="fgMuted" noWrap>
                {p.k}
              </Text>
            </span>
            <span className="sr-term-kv-v">
              <Text font="legal" tabularNumbers noWrap>
                {p.v}
              </Text>
            </span>
          </div>
        ))}

        {grouped.map(({ kind, items }) => (
          <div key={kind} role="group" aria-labelledby={`sr-term-link-${kind}`}>
            <div className="sr-term-group">
              <span className="sr-term-eyebrow" id={`sr-term-link-${kind}`}>
                {LINK_LABEL[kind as LinkKind]} · {items.length.toLocaleString('ko-KR')}
              </span>
            </div>
            {items.slice(0, MAX_LINKS_PER_KIND).map((o) => (
              <button
                key={o.id}
                type="button"
                className="sr-term-row"
                /* 「무엇을 누르면 무슨 일이 일어나나」를 이름이 말한다. 줄에는
                   이름과 종류만 보이는데, 소리로는 그것이 링크인지 버튼인지
                   구분이 안 됐다. */
                aria-label={`${o.title} · ${OBJ_LABEL[o.type]} 로 이동`}
                onClick={() => onFocus(o.id)}
              >
                <span className="sr-term-objglyph" style={{ color: OBJ_VAR[o.type] }} aria-hidden>
                  {OBJ_GLYPH[o.type]}
                </span>
                <span className="sr-term-row-name">
                  <Text font="legal" noWrap>
                    {o.title}
                  </Text>
                </span>
                <span className="sr-term-row-val">
                  <Text font="legal" color="fgMuted" noWrap>
                    {OBJ_LABEL[o.type]}
                  </Text>
                </span>
              </button>
            ))}
            {items.length > MAX_LINKS_PER_KIND ? (
              /* 접은 것을 **숫자로** 말한다. 그냥 자르면 화면이 거짓말을 한다. */
              <div className="sr-term-more">
                <Text font="legal" color="fgMuted">
                  {`외 ${(items.length - MAX_LINKS_PER_KIND).toLocaleString('ko-KR')}건은 그래프에서 봅니다`}
                </Text>
              </div>
            ) : null}
          </div>
        ))}

        <div className="sr-term-group">
          <span className="sr-term-eyebrow">Provenance</span>
        </div>
        <div className="sr-term-source">
          <Text font="legal" color="fgMuted">
            {obj.source}
          </Text>
          {/* 원문 링크는 백엔드의 `src` 가 준 것만 — 없으면 줄 자체가 없다.
              지어낸 URL 을 여기 두면 그것이 제일 그럴듯한 거짓말이 된다. */}
          {obj.sourceUrl ? (
            <a className="sr-term-srclink" href={obj.sourceUrl} target="_blank" rel="noreferrer">
              원문 열기
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
