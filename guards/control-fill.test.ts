import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from './_source';

/**
 * 컨트롤은 **제 상자를 채운다** — 가로 얼라인의 가드
 * [OWNER 2026-08-25: "간격이 띄엄띄엄이고 … 전체적인 사이트에서의 «얼라인» 이 없다"].
 *
 * 이 리포는 얼라인을 오래 세로로만 쟀다(등고 32·바닥 정렬). 눈에 걸린 것은
 * 가로였다 — 백테스트 북 한 줄의 컨트롤 사이 빈틈이 **62·97·12·23px**.
 * 원인 셋을 이 파일이 잠근다.
 *
 * ① CDS `Select` 는 제 상자를 안 채운다(트리거가 «지금 값» 만큼만 넓다).
 *    `DROPDOWN_STYLES` 의 `root/control: width 100%` 가 그 일을 하고, 모든
 *    Select 가 그 상수를 진다는 것은 `dropdown-width` 가 이미 잰다.
 * ② `Field` 가 앱에 **하나** 여야 한다. 2026-08-25 까지 넷이었고 라벨 타이포가
 *    `TextCaption`·`TextLegal`·`font=legal`·`font=caption` 으로 갈려 있었다.
 * ③ `Field` 는 `flexGrow` 로 채운다. `width: "100%"` 로 하면 폭을 안 준 행에서
 *    100% 가 «행 전체» 가 되어 칸마다 줄이 바뀐다(전략 실험 창 실측 — 컨트롤
 *    여덟이 세로로 늘어섰다). 그리고 그 규약의 짝으로, `Field` 는 폭을 주는
 *    `Box` 안에 있어야 한다.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const FIELD_HOME = path.join(SRC, 'ui', 'ControlCard.tsx');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      walk(p, out);
    } else if (e.name.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

describe('컨트롤은 제 상자를 채운다', () => {
  const files = walk(SRC);

  it('잴 소스를 실제로 찾았다', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('`Field` 는 앱에 하나뿐이다', () => {
    const defs: string[] = [];
    for (const f of files) {
      const body = stripComments(fs.readFileSync(f, 'utf8'));
      if (/function Field\b/.test(body)) defs.push(path.relative(ROOT, f));
    }
    expect(
      defs,
      '`Field` 가 여러 곳에 정의돼 있어요 — 화면마다 같은 칸이 다르게 생깁니다.\n' +
        '공용은 `ui/ControlCard.tsx` 이고 나머지는 임포트해 쓰세요.\n' +
        defs.join('\n'),
    ).toEqual([path.relative(ROOT, FIELD_HOME)]);
  });

  it('`Field` 는 `flexGrow` 로 채운다 — `width="100%"` 가 아니다', () => {
    const body = stripComments(fs.readFileSync(FIELD_HOME, 'utf8'));
    const field = body.slice(body.indexOf('function Field'));
    expect(field).toMatch(/flexGrow=\{1\}/);
    expect(
      /<VStack[^>]*width="100%"/.test(field),
      'Field 에 width="100%" 를 주면 폭을 안 준 행에서 칸마다 줄이 바뀝니다.',
    ).toBe(false);
  });

  it('드롭다운 폭 규칙이 트리거까지 채운다', () => {
    const popup = stripComments(
      fs.readFileSync(path.join(SRC, 'ui', 'window', 'popup.ts'), 'utf8'),
    );
    /* 이게 없으면 종목 칸 168px 안에서 트리거가 83px 로 앉아 85px 이 죽는다. */
    expect(popup).toMatch(/root:\s*\{\s*width:\s*["']100%["']\s*\}/);
    expect(popup).toMatch(/control:\s*\{\s*width:\s*["']100%["']\s*\}/);
  });

  /**
   * 가로 행에 선 `Field` 는 폭을 받아야 한다 — **다만 이 가드는 그것을 못 잰다.**
   *
   * 규약은 `<Box width={N}><Field>` 이고 백테스트·전략 실험은 그렇게 서 있다.
   * 그런데 시뮬 화면에는 폭을 **안쪽 컨트롤**이 지는 두 번째 관례가 있다
   * (`<Field><NumField width={90}/></Field>`) — 결과는 같지만 라벨이 컨트롤보다
   * 길면 그 칸만 넓어져 형제와 어긋난다. 그리고 세로 스택 안의 `Field`(시작일·
   * 마감일 같은 읽기 값)는 폭이 없어도 맞다.
   *
   * 「가로 행에 섰는가」를 소스만 보고 가리는 규칙을 아직 못 세웠다. 여기서
   * 못 박으면 정당한 세로 스택 여섯을 거짓 적발한다(실측 2026-08-25: 시뮬
   * 열 곳 중 넷이 그 경우). 그래서 **잴 수 있는 것만 잠그고**, 못 박지 못한
   * 부분은 CLAUDE.md 「얼라인」 절의 사람 규칙으로 남긴다. [미해결]
   */
  it.skip('가로 행의 `Field` 는 폭을 받는다 — 판정 규칙 미정 [미해결]', () => {});
});
