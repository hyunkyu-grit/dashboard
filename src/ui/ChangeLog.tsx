'use client';

import { useCallback, useEffect, useState } from 'react';

import { TextCaption, TextLabel2 } from '@coinbase/cds-web/typography';

import type { ChangeEvent, EventCluster } from '@/lib/api';
import { dirClass, fmtBp } from '@/lib/format';
import { isTopLayer, popLayer, pushLayer } from '@/ui/window/escapeStack';
import { Z_MODAL } from '@/ui/window/layers';

/**
 * 어제 대비 **오늘 기록된 변화** — 헤더에 붙는 작은 팝오버.
 *
 * ── 왜 이게 없었나 ──────────────────────────────────────────────────────────
 * 규칙(`backend/app/events.py`)은 이미 있고 요청마다 계산돼서 페이로드에 실려
 * 온다(`WallSummary.events`). **그리고 아무 데도 안 그려졌다** — v1 도 같은
 * 상태였다가 이 화면을 붙여서 되살렸다. 계산은 있는데 표면이 없는 것은 없는
 * 기능과 같고, 조용히 없다는 점에서 더 나쁘다.
 *
 * ── 띠가 아니라 팝오버인 이유 ───────────────────────────────────────────────
 * 이 셸은 세로 공간을 표에 준다(`page.tsx` 의 `height: 100vh` 기둥). 상시 띠를
 * 하나 더 세우면 그만큼 행이 줄고, 이 목록은 **하루의 31% 가 비어 있다**(v1 의
 * 500일 리플레이). 늘 있어야 할 만큼 늘 내용이 있지 않다.
 *
 * ── 그래도 방아쇠는 늘 있다 ─────────────────────────────────────────────────
 * 비어 있음 자체가 정보다("조용한 하루"). 변화가 없을 때 버튼이 사라지면 읽는
 * 사람은 "조용하다" 와 "이 기능이 없다" 를 구분할 수 없다.
 */

const LAYER = 'changelog';

const REASON_LABEL: Record<'transition' | 'move', string> = {
  transition: '구간 전환', // 극단 백분위 구간을 드나들었다
  move: '큰 변동', // 오늘의 |Δ| 가 그 종목 자기 역사에서 드물다
};

function EventLine({ e, onFocus }: { e: ChangeEvent; onFocus: (id: string) => void }) {
  return (
    <button
      type="button"
      className="sr-clog-line"
      onClick={() => onFocus(e.id)}
      title={`${e.label} — ${e.reasons.map((r) => REASON_LABEL[r]).join(', ')}`}
    >
      <TextLabel2 as="span" noWrap>
        {e.label}
      </TextLabel2>
      <span className="sr-clog-tags">
        {e.reasons.map((r) => (
          <span key={r} className="sr-clog-tag">
            {REASON_LABEL[r]}
          </span>
        ))}
      </span>
      {/* 변화는 **bp 로 고정**이다 — 이벤트의 기준은 언제나 D-1 이고, 그 규칙이
          여기서 단위를 고르는 자유를 없앤다(DESIGN §12). */}
      <span className={`sr-clog-delta ${dirClass(e.deltaBp)}`}>{fmtBp(e.deltaBp)}</span>
    </button>
  );
}

function Cluster({ c, onFocus }: { c: EventCluster; onFocus: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sr-clog-cluster">
      <EventLine e={c.leading} onFocus={onFocus} />
      {/* 연관 건은 **접혀 있다.** 커브가 통째로 움직인 날 스무 줄이 다 펼쳐지면
          그건 목록이 아니라 벽이고, 대표 한 줄이 이미 그 사실을 말했다. */}
      {c.count > 0 ? (
        <>
          <button type="button" className="sr-clog-more" onClick={() => setOpen((o) => !o)}>
            {open ? '관련 숨기기' : `연관 ${c.count}건`}
          </button>
          {open ? (
            <div className="sr-clog-related">
              {c.related.map((r) => (
                <EventLine key={r.id} e={r} onFocus={onFocus} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function ChangeLog({
  events,
  onFocus,
}: {
  events: EventCluster[];
  /** 한 줄을 누르면 그 종목으로 간다 — 커맨드 바·하단 띠와 **같은 이동**이다. */
  onFocus: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const n = events.length;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    pushLayer(LAYER);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isTopLayer(LAYER)) return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      popLayer(LAYER);
    };
  }, [open, close]);

  const focus = (id: string) => {
    onFocus(id);
    close();
  };

  return (
    <div className="sr-clog">
      <button
        type="button"
        className="sr-clog-trigger"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="어제 대비 오늘 기록된 변화 (D-1 고정)"
      >
        {n > 0 ? `변화 ${n}` : '변화 없음'}
      </button>
      {open ? (
        <>
          {/* 바깥을 누르면 닫힌다. 이 덮개는 **색이 없다** — 팝오버는 화면을
              가져가지 않고, 뒤의 표는 계속 읽혀야 한다. */}
          <div className="sr-clog-away" style={{ zIndex: Z_MODAL }} onMouseDown={close} />
          <div className="sr-clog-pop" style={{ zIndex: Z_MODAL + 1 }} role="dialog" aria-label="변화 기록">
            <div className="sr-clog-head">
              <TextCaption as="span" color="fgMuted">
                어제 대비 변화 · D-1 고정
              </TextCaption>
            </div>
            {n === 0 ? (
              <div className="sr-clog-empty">
                <TextCaption as="span" color="fgMuted">
                  오늘 기록된 변화가 없어요.
                </TextCaption>
              </div>
            ) : (
              events.map((c, i) => (
                <Cluster key={`${c.leading.id}-${i}`} c={c} onFocus={focus} />
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
