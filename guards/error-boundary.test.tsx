import fs from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from '@/ui/ErrorBoundary';

/**
 * 렌더 예외가 **영역 밖으로 못 나간다**.
 *
 * 두 가지를 잰다. ① 경계 자체가 실제로 잡는지. ② 잡아야 할 영역에 **경계가 걸려
 * 있는지** — 컴포넌트만 있고 아무도 안 쓰면 이 기능은 없는 것과 같고, 그 상태는
 * 화면을 봐도 (예외가 나기 전까지는) 티가 안 난다.
 */

const ROOT = path.resolve(import.meta.dirname, '..');

function Boom(): never {
  throw new Error('테스트용 폭발');
}

describe('렌더 경계', () => {
  beforeEach(() => {
    // React 는 잡힌 예외도 콘솔에 다시 뱉는다. 그 소음이 실패처럼 읽히므로 막되,
    // 경계가 자기 줄을 실제로 쓰는지는 아래에서 따로 잰다.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('멀쩡할 땐 아이를 그대로 그린다', () => {
    render(
      <ErrorBoundary region="표" fallback="표를 그리지 못했어요.">
        <p>내용</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('내용')).toBeTruthy();
  });

  it('던지면 대체물이 서고, 예외는 위로 안 나간다', () => {
    expect(() =>
      render(
        <ErrorBoundary region="표" fallback="표를 그리지 못했어요.">
          <Boom />
        </ErrorBoundary>,
      ),
    ).not.toThrow();
    expect(screen.getByText('표를 그리지 못했어요.')).toBeTruthy();
  });

  it('원인 메시지를 화면에 남긴다', () => {
    // 이 줄이 없으면 결함 신고가 "뭔가 안 나와요" 가 되고 아무것도 못 찾는다.
    render(
      <ErrorBoundary region="표" fallback="표를 그리지 못했어요.">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('테스트용 폭발')).toBeTruthy();
  });

  it('영역 이름을 콘솔에 적는다', () => {
    render(
      <ErrorBoundary region="미리보기" fallback="차트를 그리지 못했어요.">
        <Boom />
      </ErrorBoundary>,
    );
    const said = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0]))
      .join('\n');
    expect(said).toMatch(/미리보기/);
  });

  it('대체물은 role="alert" 로 선다', () => {
    render(
      <ErrorBoundary region="표" fallback="표를 그리지 못했어요.">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('「다시 시도」 버튼을 달지 않는다', () => {
    // 렌더 결함은 다시 그려도 같은 자리에서 또 죽는다. 없는 회복을 제안하지 않는다
    // — 가져오기 실패(`DataState.ErrorState`)와 구분되는 지점이 이것이다.
    render(
      <ErrorBoundary region="표" fallback="표를 그리지 못했어요.">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('화면의 네 영역이 각자 경계를 진다', () => {
    const page = fs.readFileSync(path.join(ROOT, 'src', 'app', 'page.tsx'), 'utf8');
    for (const region of ['오버뷰', '표', '미리보기', '시뮬레이션', '백테스트 창', '확대 창']) {
      expect(page, `${region} 영역에 경계가 없다`).toContain(`region="${region}"`);
    }
  });
});
