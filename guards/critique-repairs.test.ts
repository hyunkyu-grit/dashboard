import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 2026-08-19 전체 앱 크리틱(30/40)의 수리 여섯이 되돌아가지 않게 하는 핀.
 * 각 수리의 "왜"는 코드의 주석이 지고, 여기는 그 주석이 가리키는 사실이
 * 소스에 남아 있는지만 본다.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('critique repairs, 2026-08-19', () => {
  it('핀 행: aria-current 가 상태·시각 둘 다 진다 (aria-selected 는 은퇴)', () => {
    const table = read('src/table/InstrumentTable.tsx');
    // role=table 의 행에서 aria-selected 는 무효 — 접근성 트리에 안 잡힌다.
    expect(table).not.toContain('aria-selected={row.id');
    expect(table).toContain("aria-current={row.id === selectedId ? 'true' : undefined}");
    const css = read('src/theme/type.css');
    expect(css).toMatch(/tr\[aria-current='true'\] > td \{\s*background: var\(--sr-control\)/);
  });

  it('점프가 표를 스크롤한다 — 가상화 인덱스로, 이미 보이면 안 움직인다', () => {
    const table = read('src/table/InstrumentTable.tsx');
    expect(table).toContain("virtualizer.scrollToIndex(selectedIndex, { align: 'auto' })");
  });

  it('메가메뉴 스크림이 곧 닫기 표면이다', () => {
    const nav = read('src/ui/TopNav.tsx');
    expect(nav).toMatch(/sr-megascrim[\s\S]{0,80}onClick=\{\(\) => setOpen\(null\)\}/);
  });

  it('커맨드 바는 은퇴했다 [OWNER] — 부품·CSS·이벤트 전부', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/ui/CommandBar.tsx'))).toBe(false);
    const css = read('src/theme/type.css');
    expect(css).not.toContain('sr-cmd');
    expect(css).not.toContain('sr-navslash');
    const nav = read('src/ui/TopNav.tsx');
    expect(nav).not.toContain('sr-commandbar');
  });

  it('정렬 헤더의 접근 이름은 사람 말이다 (PUA 글리프가 이름에 못 들어간다)', () => {
    const table = read('src/table/InstrumentTable.tsx');
    expect(table).toContain('aria-label={`${BASIS_LABEL[b]} 변화 — 눌러서 정렬`}');
  });

  it('확대 창 안에서는 pane 이 이름을 다시 그리지 않는다', () => {
    const pane = read('src/ui/PreviewPane.tsx');
    expect(pane).toMatch(/chartOnly \? \(\s*<span aria-hidden="true" \/>/);
  });

  it('시뮬 스트림의 에러 페이로드를 프런트가 읽는다', () => {
    const api = read('src/sim/api.ts');
    expect(api).toContain('"detail" in parsed');
  });

  it('컨트롤 등고 32 [OWNER "가로세로 얼라인"] — 우측 유틸리티 줄과 제목 줄 트리거', () => {
    const css = read('src/theme/type.css');
    expect(css).toMatch(/\.sr-naviconbtn \{[^}]*height: 32px/);
    expect(css).toMatch(/\.sr-clog-trigger \{[^}]*height: 32px/);
    // 제목 줄 우측의 창 트리거는 CDS Button(36)이 아니라 32px pill 문법이다.
    const page = read('src/app/page.tsx');
    expect(page).not.toMatch(/<Button[^>]*>\s*백테스트/);
    expect(page).toMatch(/className="sr-rv-pillbtn"[\s\S]{0,200}백테스트/);
    expect(page).toMatch(/className="sr-rv-pillbtn"[\s\S]{0,80}표로 보기/);
  });
});
