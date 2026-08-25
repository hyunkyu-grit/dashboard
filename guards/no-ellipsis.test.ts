import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from './_source';

/**
 * 말줄임 절대 금지 [OWNER 2026-08-25 — "국고 3M 이 국고… 로 나오면 안 된다,
 * 진짜 눈에 안 들어오면 안 돼"]. CLAUDE.md 의 같은 이름 절이 규칙 본문이다.
 *
 * 잘린 라벨은 판정만 남고 그것이 무엇인지가 사라지는 병의 칸 단위 판본이다
 * (발행 캘린더의 익명 점 세 개를 걷어낸 그 판단). 칸이 좁으면 폭을 최장
 * 라벨로 실측해 잡거나 줄바꿈으로 두 줄에 세운다 — 글자를 자르지 않는다.
 *
 * 잰다: CSS 의 `text-overflow`(clip 도 생략의 사촌이라 속성 자체를 막는다),
 * TS/TSX 의 inline `textOverflow`, CDS 의 `overflow="truncate"`. 진행 중
 * 표기("갱신 중…")의 '…' 문자는 문장 부호라 이 가드의 대상이 아니다.
 *
 * 허용 목록은 없다 — 목록이 생기는 순간 다음 칸이 그 목록에 줄을 선다.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const SEARCH_DIRS = ['src'];
const EXTS = new Set(['.ts', '.tsx', '.css']);

const BANNED: { name: string; re: RegExp }[] = [
  { name: 'CSS text-overflow', re: /text-overflow\s*:/ },
  { name: 'inline textOverflow', re: /\btextOverflow\b/ },
  { name: 'CDS overflow="truncate"', re: /overflow\s*=\s*["']truncate["']/ },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      walk(full, out);
    } else if (EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

describe('말줄임 금지', () => {
  const files = SEARCH_DIRS.flatMap((d) => {
    const abs = path.join(ROOT, d);
    return fs.existsSync(abs) ? walk(abs) : [];
  });

  it('잴 소스가 있다', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('어느 칸도 글자를 잘라 …로 두지 않는다', () => {
    const hits: string[] = [];
    for (const f of files) {
      const body = stripComments(fs.readFileSync(f, 'utf8'));
      for (const b of BANNED) {
        if (b.re.test(body)) {
          hits.push(`${path.relative(ROOT, f)} — ${b.name}`);
        }
      }
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });
});
