import fs from 'node:fs';
import path from 'node:path';

import { ThemeProvider } from '@coinbase/cds-web';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ChangeEvent, EventCluster } from '@/lib/api';
import { ChangeLog } from '@/ui/ChangeLog';
import { layerDepth, resetLayers } from '@/ui/window/escapeStack';

/**
 * 변화 기록 — 이 규칙은 **이미 계산되고 있었고 아무 데도 안 그려졌다**
 * (`WallSummary.events`). 그래서 이 가드가 지키는 첫 번째 것은 "그려진다" 이다.
 *
 * 두 번째는 **빈 상태**다. 하루의 31% 가 비어 있고, 그때 방아쇠가 사라지면
 * "조용한 하루" 와 "이 기능이 없다" 가 구분되지 않는다.
 */

const ROOT = path.resolve(import.meta.dirname, '..');

function ev(id: string, label: string, deltaBp: number, reasons: ChangeEvent['reasons']): ChangeEvent {
  return { id, label, kind: 'outright', unit: '%', now: 2.5, pct: 98, deltaBp, reasons, anchor: id };
}

const EVENTS: EventCluster[] = [
  {
    leading: ev('10Y', '10Y', 7.5, ['move']),
    related: [ev('9Y', '9Y', 6.9, ['move']), ev('8Y', '8Y', 6.1, ['transition'])],
    count: 2,
  },
  { leading: ev('3Y-10Y', '3s10s', -4.2, ['transition']), related: [], count: 0 },
];

afterEach(() => {
  resetLayers();
});

function draw(events: EventCluster[], onFocus: (id: string) => void = () => {}) {
  return render(
    <ThemeProvider theme={defaultTheme} activeColorScheme="light">
      <ChangeLog events={events} onFocus={onFocus} />
    </ThemeProvider>,
  );
}

describe('변화 기록', () => {
  it('방아쇠가 건수를 말한다', () => {
    draw(EVENTS);
    expect(screen.getByText('변화 2')).toBeTruthy();
  });

  it('변화가 없어도 방아쇠는 남는다', () => {
    draw([]);
    // 사라지면 "조용한 하루" 를 말할 자리가 없어진다.
    expect(screen.getByText('변화 없음')).toBeTruthy();
  });

  it('빈 날에는 이유를 적는다', () => {
    draw([]);
    fireEvent.click(screen.getByText('변화 없음'));
    expect(screen.getByText('오늘 기록된 변화가 없어요.')).toBeTruthy();
  });

  it('연관 건은 접힌 채로 열린다', () => {
    const { container } = draw(EVENTS);
    fireEvent.click(screen.getByText('변화 2'));
    // 커브가 통째로 움직인 날 스무 줄이 다 펼쳐지면 목록이 아니라 벽이 된다.
    expect(container.querySelectorAll('.sr-clog-line').length).toBe(2);
    fireEvent.click(screen.getByText('연관 2건'));
    expect(container.querySelectorAll('.sr-clog-line').length).toBe(4);
  });

  it('한 줄을 누르면 그 종목 id 로 이동한다', () => {
    const seen: string[] = [];
    draw(EVENTS, (id) => seen.push(id));
    fireEvent.click(screen.getByText('변화 2'));
    fireEvent.click(screen.getByText('3s10s'));
    expect(seen).toEqual(['3Y-10Y']);
  });

  it('고르면 팝오버가 닫힌다', () => {
    const { container } = draw(EVENTS);
    fireEvent.click(screen.getByText('변화 2'));
    fireEvent.click(screen.getByText('3s10s'));
    expect(container.querySelector('.sr-clog-pop')).toBeNull();
  });

  it('열려 있는 동안만 Esc 겹에 올라탄다', () => {
    const { container } = draw(EVENTS);
    expect(layerDepth()).toBe(0);
    fireEvent.click(screen.getByText('변화 2'));
    expect(layerDepth()).toBe(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('.sr-clog-pop')).toBeNull();
    expect(layerDepth()).toBe(0);
  });

  it('변화는 bp 로 고정이다', () => {
    // 이벤트의 기준은 언제나 D-1 이고(DESIGN §12), 그 규칙이 단위 선택의 자유를
    // 없앤다 — 여기서 종목 단위로 찍으면 스프레드와 아웃라이트가 다른 눈금이 된다.
    const src = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'ChangeLog.tsx'), 'utf8');
    expect(src).toMatch(/fmtBp\(e\.deltaBp\)/);
    expect(src).not.toMatch(/fmtLevel|fmtDelta\(/);
  });

  it('페이지가 실제로 이 화면을 세운다', () => {
    // 이 기능이 orphan 이었던 것이 애초의 결함이다 — 붙어 있는지 확인한다.
    const page = fs.readFileSync(path.join(ROOT, 'src', 'app', 'page.tsx'), 'utf8');
    expect(page).toContain('<ChangeLog');
    expect(page).toContain('events={data.summary.events}');
  });
});
