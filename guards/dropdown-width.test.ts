import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from './_source';

/**
 * 드롭다운 목록은 **가장 긴 항목만큼** 넓다 [OWNER 2026-08-25 — "산금채 AAA
 * 이런거 다 잘려서 나오잖아"].
 *
 * CDS `Select` 의 목록은 그냥 두면 컨트롤보다 좁게 잡힌다. 이 제품의 항목은
 * 토큰이 아니라 이름·문장이라(「산금채 AAA」·「스티프너 (10Y 페이 · 3Y 리시브)」)
 * 좁은 목록에서는 **글자마다 접힌다** — 실측 2026-08-25: 「산금 / 채 / AA / A」.
 * 답은 `styles={DROPDOWN_STYLES}`(`ui/window/popup.ts`: width max-content ·
 * minWidth 120 · maxWidth 340) 하나이고, 창 안의 Select 들은 전부 지고 있었는데
 * 제목 줄의 `compact` 필터 둘만 안 지고 있었다.
 *
 * 낱말이 접히는 병의 다른 얼굴이라 「낱말 중간 줄바꿈 금지」와 한 몸이다:
 * 저쪽은 뿌리에서 `word-break` 를 끊고, 이쪽은 **접힐 이유 자체**를 없앤다.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

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

/** 한 JSX 요소의 여는 태그 본문(`<Select` … 첫 `>` 까지). 중괄호 깊이를 세서
 *  속성 안의 `>`(화살표 함수)를 넘긴다 — control-parity 가드와 같은 기법. */
function openingTags(body: string, tag: string): string[] {
  const out: string[] = [];
  const rx = new RegExp(`<${tag}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = rx.exec(body))) {
    let depth = 0;
    for (let i = m.index; i < body.length; i++) {
      const c = body[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) {
        out.push(body.slice(m.index, i + 1));
        break;
      }
    }
  }
  return out;
}

describe('드롭다운 목록 폭', () => {
  const files = walk(SRC);

  it('잴 소스를 실제로 찾았다', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('모든 `Select` 가 목록 폭 규칙을 진다', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const body = stripComments(fs.readFileSync(f, 'utf8'));
      for (const tag of openingTags(body, 'Select')) {
        if (!/styles=\{DROPDOWN_STYLES\}/.test(tag)) {
          offenders.push(path.relative(ROOT, f));
        }
      }
    }
    expect(
      offenders,
      `styles={DROPDOWN_STYLES} 없는 Select 가 있어요 — 목록이 좁게 잡혀 라벨이\n` +
        `글자마다 접힙니다(「산금 / 채 / AA / A」). 근거는 ui/window/popup.ts.\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('폭 규칙 자체는 한 곳에만 있다', () => {
    const popup = stripComments(fs.readFileSync(path.join(SRC, 'ui', 'window', 'popup.ts'), 'utf8'));
    expect(popup).toMatch(/width:\s*["']max-content["']/);
    expect(popup).toMatch(/minWidth:\s*\d+/);
    /* 상한이 없으면 긴 라벨 하나가 목록을 화면 밖으로 민다(popup.ts 의 근거). */
    expect(popup).toMatch(/maxWidth:\s*\d+/);
  });
});
