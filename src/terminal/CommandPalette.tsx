'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Text } from '@coinbase/cds-web/typography';

import { OBJ_GLYPH, OBJ_LABEL, OBJ_VAR, type TermObject } from './ontology';

/**
 * **커맨드 팔레트** — `Ctrl+K` 로 348개 중 하나로 바로 간다.
 *
 * ── 왜 만들었나 [외부 리서치, 2026-08-26] ──────────────────────────────────
 * 객체가 348개인데 **이름으로 찾을 방법이 없었다.** Object Explorer 의 패싯은
 * «어떤 부류인가» 로 좁히는 도구지 «그것» 을 집는 도구가 아니라서, 「국고 10년을
 * 보자」는 사람이 분류→만기를 두 번 눌러야 겨우 닿았다.
 *
 * Cambridge Intelligence 의 그래프 UX 지침이 검색을 «노드를 빨리 찾는
 * 지름길(shortcut mechanism for rapid node location)» 로 따로 세워 두는 것이
 * 그 때문이고, 커맨드 팔레트는 그 지름길의 지금 관례다(`Ctrl/Cmd+K`).
 *
 * ── 왜 CDS `Combobox`·`Modal` 이 아닌가 ────────────────────────────────────
 * 카탈로그를 먼저 봤다(CLAUDE.md 규칙 2). 둘 다 모양은 비슷한데 맡는 일이 다르다:
 *
 *   `Combobox`  — **폼 컨트롤**이다. 어떤 필드의 값을 고르는 물건이라 라벨과
 *                 값 바인딩을 전제한다. 여기서 고르는 것은 필드의 값이 아니라
 *                 «화면이 어디를 볼지» 다.
 *   `Modal`     — 제목·본문·푸터를 가진 **대화상자**다. 팔레트는 입력 한 줄과
 *                 목록뿐이고, Modal 의 패딩·반경 리듬이 이 화면의 4px 레지스터와
 *                 부딪힌다.
 *
 * 그래서 만들었고, **Modal 이 공짜로 주던 것은 손으로 갚는다**: `role="dialog"`
 * + `aria-modal`, 열 때 입력에 초점, `Esc` 로 닫고 **초점을 원래 자리로 되돌림**,
 * 바깥 클릭으로 닫힘. 이 넷을 안 하면 «Modal 을 안 썼다» 가 아니라 «접근성을
 * 안 했다» 가 된다.
 *
 * ── 다섯째로 갚은 것 [2026-08-27] ──────────────────────────────────────────
 * 목록에 `role="listbox"`·`role="option"` 은 붙어 있었는데 **초점은 입력에**
 * 있었다. 그 조합에서 스크린 리더는 «지금 몇 번째를 고르고 있는지» 를 못 읽는다 —
 * 화살표를 눌러도 시각적으로만 움직이고 소리로는 아무 일도 안 일어난다.
 * `aria-activedescendant` 가 그 둘을 잇는 표준 배선이고(WAI-ARIA combobox 패턴),
 * 그것이 없으면 팔레트는 눈으로만 쓰는 물건이다.
 *
 * 스크롤도 같이 갚는다. 열두 줄이 다 보이는 것이 설계지만 목록 상자는 스크롤이
 * 되고, 그때 짚은 줄이 창 밖에 있으면 «안 움직인다» 로 보인다.
 *
 * ── 점수 매기기 ────────────────────────────────────────────────────────────
 * 퍼지 검색을 안 쓴다. 이 목록의 이름은 「국고 10Y」·「BSS 3Y」·「신한은행 3008-07」
 * 처럼 **짧고 규칙적**이라, 부분 문자열 일치로 충분하고 퍼지는 오히려 엉뚱한 것을
 * 위로 올린다. 순서는 ① 이름이 그 글자로 시작 ② 이름에 포함 ③ id 에 포함 이고,
 * 같은 등급 안에서는 원래 순서를 지킨다(안 그러면 같은 질의가 매번 다른 순서를
 * 낸다).
 */

/** 한 번에 보여주는 최대 개수. 열두 줄이면 스크롤 없이 다 보이고, 그보다 많으면
 *  «목록을 읽는» 일이 되어 지름길이 아니게 된다. 더 있으면 그 수를 적는다. */
const MAX_HITS = 12;

type Hit = { o: TermObject; rank: number };

export function CommandPalette({
  objects,
  open,
  onClose,
  onPick,
}: {
  objects: TermObject[];
  open: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  /** 열기 전에 초점이 있던 자리. 닫을 때 여기로 되돌린다. */
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    setQ('');
    setCursor(0);
    /* 다음 프레임에 초점 — 이 요소가 아직 붙는 중이면 `focus()` 가 무동작이다. */
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const close = useCallback(() => {
    onClose();
    restoreRef.current?.focus?.();
  }, [onClose]);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s === '') {
      /* 빈 질의는 «최근» 이 아니라 **첫 목록**이다. 이 화면에 최근 기록이 없고,
         가짜 최근을 만들면 그건 지어낸 것이다. */
      return objects.slice(0, MAX_HITS).map((o) => ({ o, rank: 3 }));
    }
    const out: Hit[] = [];
    for (const o of objects) {
      const title = o.title.toLowerCase();
      const id = o.id.toLowerCase();
      if (title.startsWith(s)) out.push({ o, rank: 0 });
      else if (title.includes(s)) out.push({ o, rank: 1 });
      else if (id.includes(s)) out.push({ o, rank: 2 });
    }
    /* 안정 정렬 — 같은 등급은 원래 순서. `Array.prototype.sort` 는 명세상
       안정이므로 인덱스를 따로 안 들어도 된다(ES2019). */
    out.sort((a, b) => a.rank - b.rank);
    return out;
  }, [objects, q]);

  const shown = hits.slice(0, MAX_HITS);

  /* 짚은 줄을 창 안으로. `block: 'nearest'` 라 이미 보이면 아무것도 안 한다 —
     `'center'` 로 두면 화살표 한 번마다 목록이 반 칸씩 흔들린다. */
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-hit="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor, shown.length]);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(shown.length - 1, c + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const hit = shown[cursor];
        if (hit) {
          onPick(hit.o.id);
          close();
        }
      }
    },
    [shown, cursor, onPick, close],
  );

  if (!open) return null;

  return (
    <div className="sr-term-palette-scrim" onMouseDown={close}>
      <div
        className="sr-term-palette"
        role="dialog"
        aria-modal="true"
        aria-label="객체 찾기"
        /* 안쪽 클릭이 스크림까지 올라가면 고르는 순간 닫힌다. */
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <input
          ref={inputRef}
          className="sr-term-palette-input"
          value={q}
          placeholder="객체 이름이나 id — 국고 10Y · BSS · CRD-BD"
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          aria-label="객체 이름"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls="sr-term-palette-list"
          /* 초점은 여기 있고 «고른 것» 은 저 아래 있다 — 그 둘을 잇는 배선.
             가리키는 id 가 실제로 존재해야 하므로 결과가 없으면 안 적는다. */
          aria-activedescendant={shown[cursor] ? `sr-term-hit-${cursor}` : undefined}
        />

        <ul
          className="sr-term-palette-list"
          id="sr-term-palette-list"
          role="listbox"
          aria-label="찾은 객체"
          ref={listRef}
        >
          {shown.length === 0 ? (
            <li className="sr-term-palette-empty">
              <Text font="legal" color="fgMuted">
                {`「${q}」 로 찾은 객체가 없어요`}
              </Text>
            </li>
          ) : (
            shown.map((h, i) => (
              <li
                key={h.o.id}
                id={`sr-term-hit-${i}`}
                data-hit={i}
                role="option"
                aria-selected={i === cursor}
              >
                <button
                  type="button"
                  className="sr-term-palette-item"
                  data-on={i === cursor}
                  /* 목록 안에서 고르는 것은 화살표다 — 줄마다 탭 정지를 두면
                     열두 번 탭을 눌러야 목록을 빠져나간다. */
                  tabIndex={-1}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => {
                    onPick(h.o.id);
                    close();
                  }}
                >
                  <span
                    className="sr-term-objglyph"
                    style={{ color: OBJ_VAR[h.o.type] }}
                    aria-hidden
                  >
                    {OBJ_GLYPH[h.o.type]}
                  </span>
                  <span className="sr-term-palette-title">{h.o.title}</span>
                  <span className="sr-term-palette-sub">{h.o.subtitle}</span>
                  <span className="sr-term-palette-type">{OBJ_LABEL[h.o.type]}</span>
                </button>
              </li>
            ))
          )}
        </ul>

        {/* 잘린 수를 **적는다** — 조용한 절단 금지. */}
        <div className="sr-term-palette-foot">
          <Text font="legal" color="fgMuted">
            {hits.length > MAX_HITS
              ? `${shown.length} / ${hits.length}건 — 더 좁혀 보세요`
              : `${hits.length}건`}
          </Text>
          <Text font="legal" color="fgMuted">
            ↑↓ 고르기 · Enter 가기 · Esc 닫기
          </Text>
        </div>
      </div>
    </div>
  );
}
