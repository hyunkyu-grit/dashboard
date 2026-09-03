'use client';

import { useCallback, useEffect, useRef } from 'react';

import { Text } from '@coinbase/cds-web/typography';

/**
 * 단축키 목록 — **키보드가 있다는 사실 자체를 화면에 세운다.**
 *
 * ── 왜 필요했나 [WCAG 2.2, 2026-08-27] ─────────────────────────────────────
 * 이 화면에는 단축키가 여덟 개 있었고, 그중 화면에 적힌 것은 `Ctrl+K` 하나뿐
 * 이었다(찾기 버튼의 라벨). 나머지는 소스 주석에만 있었다 — 즉 **코드를 읽는
 * 사람만 쓸 수 있는 기능**이었다. 팔레트 지침이 «중요한 명령은 눈에 보이는
 * 자리에도 두라» 고 하는 것의 반대편이 이것이다.
 *
 * ── 한 글자 단축키를 끌 수 있어야 한다 (WCAG 2.1.4) ────────────────────────
 * `/` 와 `?` 는 글자 키 하나로 동작한다. WCAG 2.1.4(Character Key Shortcuts)는
 * 그런 단축키에 **끄거나 · 다시 매기거나 · 초점이 있을 때만 듣게** 하라고
 * 요구한다. 음성 입력을 쓰는 사람에게는 말하는 낱말이 그대로 단축키가 되어
 * 화면이 제멋대로 움직이기 때문이다.
 *
 * 여기서는 «끄기» 를 고른다. 다시 매기기는 이 목업에 저장할 자리가 없고,
 * 초점 한정은 «어디서나 누르면 열린다» 는 지름길의 뜻을 없앤다. 끄더라도
 * `Ctrl+K`·`Alt+…` 는 그대로 듣는다 — 조합키는 2.1.4 의 대상이 아니다.
 */

export type Shortcut = { keys: string; what: string };

export const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl / ⌘ + K', what: '객체 찾기 — 이름이나 id 로 바로 간다' },
  { keys: '/', what: '객체 찾기 (한 글자 단축키)' },
  { keys: '?', what: '이 목록 (한 글자 단축키)' },
  { keys: 'Alt + ← / →', what: '탐색 이력 뒤로 · 앞으로' },
  { keys: 'Alt + 1 … 4', what: '축 바꾸기 — 관계 · 시간 · 표 · 값' },
  { keys: '↑ ↓', what: '표에서 행 옮기기 · 팔레트에서 고르기' },
  { keys: '← → ↑ ↓', what: '그래프에서 이웃 옮기기 (초점은 바뀌지 않는다)' },
  { keys: 'Enter · Space', what: '지금 짚은 것으로 이동' },
  { keys: '+ · − · 0', what: '그래프·시간축 확대 · 축소 · 되돌리기' },
  { keys: 'Esc', what: '팔레트·이 목록 닫기' },
];

export function ShortcutHelp({
  open,
  onClose,
  singleKeys,
  onSingleKeys,
}: {
  open: boolean;
  onClose: () => void;
  singleKeys: boolean;
  onSingleKeys: (v: boolean) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => boxRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const close = useCallback(() => {
    onClose();
    restoreRef.current?.focus?.();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="sr-term-palette-scrim" onMouseDown={close}>
      <div
        className="sr-term-palette sr-term-help"
        role="dialog"
        aria-modal="true"
        aria-label="단축키"
        tabIndex={-1}
        ref={boxRef}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      >
        <div className="sr-term-head">
          <span className="sr-term-eyebrow" data-brace="true">
            Shortcuts
          </span>
          <button type="button" className="sr-term-seg-btn sr-term-clear" onClick={close}>
            닫기 Esc
          </button>
        </div>

        <div className="sr-term-body">
          {SHORTCUTS.map((s) => (
            <div className="sr-term-kv" key={s.keys}>
              <span className="sr-term-kv-k">
                <kbd className="sr-term-kbd">{s.keys}</kbd>
              </span>
              <span className="sr-term-kv-v sr-term-kv-wide">
                <Text font="legal">{s.what}</Text>
              </span>
            </div>
          ))}

          <div className="sr-term-group">
            <span className="sr-term-eyebrow">Accessibility</span>
          </div>
          {/* 라벨이 입력을 감싼다 — 상자를 눌러도 켜지고 꺼진다. `htmlFor` 로
              이었을 때와 결과는 같지만 id 를 하나 안 만든다. */}
          <label className="sr-term-check">
            <input
              type="checkbox"
              checked={singleKeys}
              onChange={(e) => onSingleKeys(e.target.checked)}
            />
            <Text font="legal">
              한 글자 단축키(/ 와 ?)를 씁니다 — 끄면 조합키만 들어요 (WCAG 2.1.4)
            </Text>
          </label>
        </div>
      </div>
    </div>
  );
}
