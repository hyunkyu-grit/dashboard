/* 경로의 **대소문자**가 파일명과 정확히 같은가.
 *
 * 빌드 호스트는 Windows 고 Vercel 은 Linux 다. NTFS 는 대소문자를 구별하지
 * 않으므로 `@/ui/topnav` 와 `@/ui/TopNav` 가 여기서는 둘 다 열린다. Linux 에서는
 * 하나만 열린다. 그래서 이 계열의 오타는 **로컬에서 영영 안 보이고 프로덕션
 * 에서만** 터진다 — 그것도 빌드 실패라는 정직한 모양으로.
 *
 * 검사 대상 셋:
 *
 *   1. TS/TSX 의 상대·`@/` import 가 실제 파일명과 글자 그대로 같은가
 *   2. CSS 의 `url()` 이 `public/` 의 실제 파일명과 같은가
 *   3. 파일명에 Windows 예약문자가 없는가 (특히 `:` — NTFS 에서 콜론은 대체
 *      데이터 스트림으로 새고, 그 결과는 **0바이트 파일**이다)
 *
 * `fs.existsSync` 로는 1·2 를 검사할 수 없다. Windows 에서 그 함수가 대소문자를
 * 무시하기 때문이다. 그래서 여기서는 부모 디렉터리를 `readdirSync` 로 읽어
 * **목록에 그 이름이 그대로 있는지**를 본다.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const rel = (full: string) => path.relative(ROOT, full).replace(/\\/g, '/');

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}

/** 이 경로의 각 조각이 부모 디렉터리 목록에 **글자 그대로** 있는가.
 * 없으면 실제로 있는 이름을 돌려준다(오타를 눈으로 바로 잇게). */
function caseMismatch(absolute: string): string | null {
  const parts = path.relative(ROOT, absolute).split(path.sep);
  let here = ROOT;
  for (const part of parts) {
    let entries: string[];
    try {
      entries = readdirSync(here);
    } catch {
      return `${rel(here)} 는 디렉터리가 아니다`;
    }
    if (entries.includes(part)) {
      here = path.join(here, part);
      continue;
    }
    const lookalike = entries.find((e) => e.toLowerCase() === part.toLowerCase());
    return lookalike
      ? `${rel(path.join(here, part))} → 실제 이름은 "${lookalike}"`
      : `${rel(path.join(here, part))} 가 없다`;
  }
  return null;
}

/** import 지정자 → 있을 법한 파일 절대경로들. 첫 번째로 존재하는 것이 답이다. */
function candidates(spec: string, fromFile: string): string[] {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return []; // 패키지 — node_modules 의 일이다

  const exts = ['', '.ts', '.tsx', '.css', '.json', '.js', '.mjs'];
  const out = exts.map((e) => base + e);
  for (const e of ['.ts', '.tsx']) out.push(path.join(base, `index${e}`));
  return out;
}

const SPEC = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

const SOURCES = walk(path.join(ROOT, 'src'), ['.ts', '.tsx']).concat(
  walk(path.join(ROOT, 'guards'), ['.ts', '.tsx']),
);

describe('import 경로의 대소문자', () => {
  it('훑을 파일이 실제로 있다', () => {
    expect(SOURCES.length).toBeGreaterThan(80);
  });

  it('상대·@/ import 가 전부 실제 파일명과 글자 그대로 같다', () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const text = readFileSync(file, 'utf8');
      for (const [, spec] of text.matchAll(SPEC)) {
        const paths = candidates(spec, file);
        if (paths.length === 0) continue;
        /* 하나라도 정확히 일치하면 통과. 하나도 없으면, 대소문자만 다른 것이
         * 있는지 보고 있으면 그것을 이름 대며 실패시킨다. */
        if (paths.some((p) => caseMismatch(p) === null)) continue;
        const near = paths.map((p) => caseMismatch(p)).find((m) => m?.includes('실제 이름은'));
        if (near) offenders.push(`${rel(file)}: "${spec}" → ${near}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('판정기가 대소문자만 다른 경로를 실제로 잡는다', () => {
    // 심어서 실패하는지: 존재하는 파일의 이름을 소문자로 눕혀 본다.
    const planted = path.join(ROOT, 'src', 'ui', 'topnav.tsx');
    expect(caseMismatch(planted)).toContain('실제 이름은 "TopNav.tsx"');
    // 그리고 진짜 이름은 통과한다.
    expect(caseMismatch(path.join(ROOT, 'src', 'ui', 'TopNav.tsx'))).toBeNull();
  });
});

describe('CSS 가 가리키는 자산', () => {
  const CSS = walk(path.join(ROOT, 'src'), ['.css']);
  const URLREF = /url\(\s*['"]?(\/[^'")]+)['"]?\s*\)/g;

  it('url() 의 파일명이 public/ 의 실제 이름과 같다', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const file of CSS) {
      for (const [, href] of readFileSync(file, 'utf8').matchAll(URLREF)) {
        if (href.startsWith('/_next/') || href.startsWith('//')) continue;
        checked += 1;
        const miss = caseMismatch(path.join(ROOT, 'public', href.slice(1)));
        if (miss) offenders.push(`${rel(file)}: url("${href}") → ${miss}`);
      }
    }
    // 폰트 하나는 반드시 검사됐어야 한다(빈 목록을 훑고 초록을 내지 않도록).
    expect(checked).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

describe('파일명 자체', () => {
  const TREES = ['src', 'guards', 'public', 'design'];

  it('Windows 예약문자가 없다', () => {
    /* 콜론이 특히 위험하다: `git checkout` 이 NTFS 에서 `a:b` 를 쓰면 내용이
     * 대체 데이터 스트림으로 새고 남는 파일은 0바이트다. 조용하다. */
    const offenders: string[] = [];
    for (const tree of TREES) {
      for (const file of walk(path.join(ROOT, tree), [''])) {
        if (/[:*?"<>|]/.test(path.basename(file))) offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('한 디렉터리 안에 대소문자만 다른 이름이 없다', () => {
    /* Linux 에서는 공존할 수 있고 Windows 에서는 못 한다 — 체크아웃이 하나를
     * 조용히 덮어쓴다. 반대 방향의 같은 함정이다. */
    const offenders: string[] = [];
    const dirs: string[] = TREES.map((t) => path.join(ROOT, t));
    while (dirs.length) {
      const dir = dirs.pop() as string;
      const entries = readdirSync(dir);
      const seen = new Map<string, string>();
      for (const name of entries) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) dirs.push(full);
        const key = name.toLowerCase();
        const prior = seen.get(key);
        if (prior) offenders.push(`${rel(dir)}: "${prior}" vs "${name}"`);
        else seen.set(key, name);
      }
    }
    expect(offenders).toEqual([]);
  });
});
