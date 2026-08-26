import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * **CDS 오버레이는 루트 프로바이더를 요구한다** — 그리고 없으면 **조용히 틀린다.**
 *
 * `@coinbase/cds-web/overlays/Portal.js`:
 *
 *     if (disablePortal || isSSR() || !document.getElementById(containerId))
 *       return <Fragment>{children}</Fragment>;
 *
 * `PortalProvider` 가 `#portalRoot`(그 안에 `#tooltipContainer` 등)를 `document.body`
 * 에 붙이지 않으면 이 분기가 참이 되어 오버레이가 **트리거 안에** 렌더된다.
 * 예외도 경고도 콘솔 한 줄도 없다.
 *
 * 이 리포가 그 대가를 치렀다: rv 랭킹 표의 툴팁이 `<th>` 안에 그려져 그 칸의
 * `nowrap` 을 상속했고, 패널이 한 줄 높이로 서서 긴 문장이 밖으로 흘렀다
 * [OWNER 2026-08-19 — "패널 밖으로 글씨가 빠져나가"]. 그때 CSS 로 증상을 덮었고
 * 뿌리는 2026-08-26 까지 남아 있었다.
 *
 * 실측(2026-08-26, 수리 후 라이브): `#portalRoot` z-index 100001 · body 직속 ·
 * 컨테이너 다섯 · 툴팁 `inPortal true` / `inTh false` · 패널 292×81 안에 텍스트
 * 229×53 3줄, 넘침 없음.
 */

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const providers = read('src/app/providers.tsx');

describe('CDS 오버레이 포털', () => {
  it('`PortalProvider` 를 CDS 에서 임포트한다', () => {
    expect(providers).toMatch(
      /import \{ PortalProvider \} from '@coinbase\/cds-web\/overlays'/,
    );
  });

  it('앱 루트에 마운트돼 있다', () => {
    expect(providers).toMatch(/<PortalProvider>/);
    expect(providers).toMatch(/<\/PortalProvider>/);
  });

  it('`ThemeProvider` **안쪽**이다 — 밖이면 다크에서 오버레이만 라이트로 뜬다', () => {
    /* `Portal` 은 포털 트리에 테마를 다시 세우며 `useTheme()` 로 현재 테마를
       읽는다(`overlays/Portal.js` 의 isolated ThemeProvider). 프로바이더 밖에
       있으면 그 조회가 기본 테마로 떨어진다. */
    const theme = providers.indexOf('<ThemeProvider');
    const portal = providers.indexOf('<PortalProvider>');
    const portalEnd = providers.indexOf('</PortalProvider>');
    const themeEnd = providers.indexOf('</ThemeProvider>');
    expect(theme).toBeGreaterThan(-1);
    expect(portal).toBeGreaterThan(theme);
    expect(portalEnd).toBeLessThan(themeEnd);
  });

  it('프로바이더는 하나뿐이다 — 둘이면 포털 루트를 서로 떼어낸다', () => {
    /* `PortalHost` 의 cleanup 이 `portalRoot.remove()` 라, 두 번째 프로바이더가
       언마운트되면서 첫 번째의 루트까지 지울 수 있다(그 파일의 "Avoid removing
       child from other provider" 주석이 그 위험을 적어 둔 자리다). */
    const files = fs
      .readdirSync(path.join(__dirname, '..', 'src', 'app'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => read(path.join('src/app', f)));
    const mounts = files.reduce(
      (n, t) => n + (t.match(/<PortalProvider[\s>]/g)?.length ?? 0),
      0,
    );
    expect(mounts).toBe(1);
  });
});

describe('툴팁 폭은 prop 이 진다 — CSS 우회가 아니라', () => {
  it('`.sr-rv-tiptext` 우회가 되살아나지 않았다', () => {
    /* 그 클래스의 `max-width: 236px` 는 같은 컴포넌트의 `maxWidth={280}` prop 을
       덮고 있었다 — 두 곳이 같은 것을 말하면 한쪽만 고쳐지는 날이 온다. */
    const css = read('src/theme/type.css');
    expect(css).not.toMatch(/\.sr-rv-tiptext\s*\{/);
    for (const f of ['src/rv/RankingTable.tsx', 'src/mr/MrPage.tsx']) {
      expect(read(f)).not.toMatch(/className="sr-rv-tiptext"/);
    }
  });

  it('두 `ThHelp` 가 여전히 `maxWidth` prop 으로 폭을 말한다', () => {
    for (const f of ['src/rv/RankingTable.tsx', 'src/mr/MrPage.tsx']) {
      expect(read(f)).toMatch(/maxWidth=\{\d+\}/);
    }
  });
});
