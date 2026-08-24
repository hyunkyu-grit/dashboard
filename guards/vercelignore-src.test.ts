/* `src/` 는 통째로 배포된다.
 *
 * ## 이 가드가 잡은 것
 *
 * `.vercelignore` 에 `data/` 가 앞의 `/` 없이 적혀 있었다. `.gitignore` 문법과
 * 똑같이 **어느 깊이든** 걸리므로, 뿌리의 25MB 워크북뿐 아니라 `src/data/` 까지
 * 업로드에서 빠졌다. 2026-08-24 배포가 그 자리에서 죽었다:
 *
 *     Module not found: Can't resolve '@/data/calendar.json'
 *     ./src/lab/model/strategy/meetings.ts
 *
 * ## 왜 로컬에서는 안 보였나
 *
 * `.vercelignore` 는 **업로드 목록**만 자르지 로컬 빌드가 읽는 트리를 안 자른다.
 * `next build` 는 멀쩡히 통과했다. 이 종류의 결함은 **배포에서만** 보인다 —
 * 그래서 파일을 읽어서 재는 가드가 필요하다.
 *
 * 그리고 오늘까지 안 터진 이유는 `src/data/` 를 **프런트에서 import 한 파일이
 * 오늘 처음 생겼기** 때문이다. 잠복한 채로 며칠을 지났다.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

/** 주석과 빈 줄을 걷은 패턴들. */
function patterns(): string[] {
  return readFileSync(join(ROOT, '.vercelignore'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

/** `src/` 아래의 모든 디렉터리·파일 이름(경로 아님). */
function namesUnderSrc(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      out.add(name);
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
    }
  };
  walk(join(ROOT, 'src'));
  return out;
}

describe('.vercelignore', () => {
  it('뿌리만 가리키는 패턴은 앞에 / 를 단다 — 안 그러면 src 안까지 지운다', () => {
    const names = namesUnderSrc();
    const dangerous: string[] = [];
    for (const p of patterns()) {
      if (p.startsWith('!')) continue;      // 되살리는 줄
      if (p.startsWith('/')) continue;      // 뿌리에 못 박힘 — 안전
      if (p.includes('*')) continue;        // 글롭은 아래 시험이 따로 본다
      const bare = p.replace(/\/$/, '');
      if (names.has(bare)) dangerous.push(p);
    }
    expect(
      dangerous,
      `이 패턴들이 src/ 안의 같은 이름까지 지워요 — 앞에 "/" 를 다세요`,
    ).toEqual([]);
  });

  it('글롭은 src 안의 소스 확장자를 안 건드린다', () => {
    const globs = patterns().filter((p) => p.includes('*') && !p.startsWith('!'));
    for (const g of globs) {
      for (const ext of ['.ts', '.tsx', '.css', '.json']) {
        expect(g, `${g} 가 src 의 ${ext} 를 지울 수 있어요`).not.toBe(`*${ext}`);
      }
    }
  });

  /* 실제로 import 되는 파일이 실재하는지도 같이 본다. 위 두 시험은 «패턴이
     위험한가» 를 보지 «그 파일이 있는가» 는 안 본다. */
  it('프런트가 import 하는 src/data 파일이 실재한다', () => {
    const src = readFileSync(
      join(ROOT, 'src', 'lab', 'model', 'strategy', 'meetings.ts'),
      'utf8',
    );
    expect(src).toContain("from '@/data/calendar.json'");
    expect(existsSync(join(ROOT, 'src', 'data', 'calendar.json'))).toBe(true);
  });
});
