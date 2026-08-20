/* 가드가 쓰는 도구 자체를 시험한다.
 *
 * v1 패리티 레인 P2 (LANE-v1-parity-2026-08-20.md). v1 `guard-hygiene`.
 *
 * 소스를 훑는 가드 여섯이 `stripComments` 를 지난다. 그 함수가 조용히 틀리면
 * **여섯 가드가 한꺼번에 눈이 먼다** — 그리고 전부 초록이라 아무도 모른다.
 * 도구를 시험하지 않는 도구는 도구가 아니다.
 *
 * 2026-08-20 에 모으기 전까지 그 함수는 여섯 벌이었고 이미 갈려 있었다:
 * 다섯은 뒤따라오는 주석까지 걷었고 하나는 줄 전체가 주석일 때만 걷었다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments, walk } from './_source';

const ROOT = path.resolve(__dirname, '..');

describe('주석을 걷는다', () => {
  it('블록 주석이 사라진다', () => {
    expect(stripComments('const a = 1; /* 설명 */ const b = 2;')).not.toMatch(/설명/);
  });

  it('여러 줄 블록 주석도 사라진다', () => {
    const src = 'a\n/* 한 줄\n   두 줄 */\nb';
    const out = stripComments(src);
    expect(out).not.toMatch(/한 줄|두 줄/);
    expect(out).toMatch(/a/);
    expect(out).toMatch(/b/);
  });

  it('줄 주석이 사라진다 — **뒤따라오는 것도**', () => {
    expect(stripComments('const a = 1; // 설명')).not.toMatch(/설명/);
    expect(stripComments('// 줄 전체')).not.toMatch(/줄 전체/);
  });
});

describe('걷으면 안 되는 것을 안 걷는다', () => {
  it('URL 의 `//` 는 주석이 아니다', () => {
    /* 걷으면 그 줄의 나머지가 통째로 사라지고, 가드는 없는 코드를 검사한다. */
    const src = "const u = 'https://ecos.bok.or.kr/api'; const v = 1;";
    const out = stripComments(src);
    expect(out).toMatch(/ecos\.bok\.or\.kr/);
    expect(out).toMatch(/const v = 1/);
  });

  it('주석 안의 따옴표가 뒤의 코드를 삼키지 않는다', () => {
    const src = "/* 그는 'x' 라고 적었다 */\nconst kept = 'y';";
    const out = stripComments(src);
    expect(out).toMatch(/const kept = 'y'/);
  });

  it('문자열 안의 `/*` 도 파일을 통째로 먹지 않는다', () => {
    /* 정규식은 가장 가까운 `*​/` 에서 멈춘다. 파서였다면 짝이 안 맞는 순간
     * 파일 전체가 주석이 됐을 것이다. */
    const src = "const a = '/*'; const b = 2;\n/* 진짜 주석 */\nconst c = 3;";
    const out = stripComments(src);
    expect(out).toMatch(/const c = 3/);
  });
});

describe('줄 번호가 살아남는다', () => {
  it('블록 주석을 걷어도 줄 수가 같다', () => {
    /* 실패 문장이 "몇 번째 줄" 을 말하려면 걷은 자리에 줄바꿈이 남아야 한다. */
    const src = 'a\n/* 하나\n   둘\n   셋 */\nb';
    expect(stripComments(src).split('\n')).toHaveLength(src.split('\n').length);
  });

  it('줄 주석을 걷어도 줄 수가 같다', () => {
    const src = 'a // 설명\nb\n// 또\nc';
    expect(stripComments(src).split('\n')).toHaveLength(src.split('\n').length);
  });

  it('걷은 줄의 코드 부분은 제자리에 남는다', () => {
    const out = stripComments('const a = 1; // 뒤');
    expect(out.split('\n')[0]).toMatch(/const a = 1;/);
  });
});

describe('한 벌인지', () => {
  it('가드 트리에 stripComments 정의가 하나뿐이다', () => {
    /* 여섯 벌이던 시절에 이미 갈려 있었다. 다시 갈리는 순간을 여기서 잡는다. */
    const defs = walk(path.join(ROOT, 'guards'), ['.ts', '.tsx'])
      /* **줄 시작의 진짜 정의**만 센다. 그냥 낱말을 세면 이 파일이 자기
       * 정규식 리터럴을 정의로 세어 스스로 실패한다(실측 2026-08-20). */
      .filter((f) => /^(?:export )?function stripComments\(/m.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.basename(f));
    expect(defs).toEqual(['_source.ts']);
  });

  it('소스를 훑는 가드들이 그 한 벌을 쓴다', () => {
    const users = [
      'color-source',
      'control-parity',
      'motion-tokens',
      'production-env',
      'spacing-scale',
      'typography-ratchet',
    ];
    const missing = users.filter(
      (n) => !fs.readFileSync(path.join(ROOT, 'guards', `${n}.test.ts`), 'utf8')
        .includes("from './_source'"),
    );
    expect(missing).toEqual([]);
  });
});

describe('walk 가 훑는 범위', () => {
  it('빌드 산출물과 의존성은 안 훑는다 — 안 그러면 가드가 몇 분 걸린다', () => {
    const files = walk(path.join(ROOT, 'guards'), ['.ts']);
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => f.includes('.next'))).toBe(false);
  });

  it('실제로 파일을 찾는다 — 빈 목록을 훑고 초록을 내지 않는다', () => {
    expect(walk(path.join(ROOT, 'guards'), ['.ts']).length).toBeGreaterThan(20);
  });
});
