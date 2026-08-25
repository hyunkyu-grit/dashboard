import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { stripComments } from './_source';

/**
 * 한 행의 컨트롤은 **한 높이**다.
 *
 * ── 이 가드가 존재하는 이유 (실측, 2026-08-19) ────────────────────────────────
 * 백테스트·현금채권·시뮬의 폼 행은 `alignItems="flex-end"` 다. 바닥이 정렬되는
 * 규칙에서는 **블록 높이가 곧 라벨 높이**여서, 구성원 하나가 6px 높으면 그 칸의
 * 라벨만 6px 위로 올라간다. 실측 라벨 줄 스프레드는 18px 이었다.
 *
 * 원인은 폰트 패스의 비대칭 부작용이었다: 컨트롤 값 13px 규칙이 `Select` 는
 * `font="legal"` 로 상자까지 39→32 로 줄였지만, `TextInput` 은 `fontSize="legal"`
 * 이라 글자만 줄고 상자는 CDS `size="s"` 기본값(38)에 남았다. 2026-08-14 에
 * "Select·TextInput 둘 다 39px" 로 **검증됐던 등고가 그때 조용히 깨졌다**
 * (HANDOFF.md §8.21). 아무 테스트도 그걸 몰랐다 — 이 파일이 그 자리다.
 *
 * ── 무엇을 어떻게 보나 ──────────────────────────────────────────────────────
 * 렌더 높이는 jsdom 에서 못 재고(CDS 스타일시트가 안 실린다), 브라우저 계측은
 * 이 스위트의 일이 아니다. 그래서 **소스에서** 본다: `size="s"` 를 쓴 CDS
 * `TextInput` 은 반드시 `height={CONTROL_H}` 를 함께 지어야 한다. 그 둘이 같이
 * 있으면 렌더가 32 임을 브라우저에서 확인했고(커밋 009f957 의 before→after),
 * 하나라도 빠지면 그 칸이 38 로 돌아간다.
 *
 * 스코프는 `src/**` glob 이다. 컴포넌트를 손으로 열거하지 않는다 — 열거를 빠뜨린
 * 컴포넌트가 정확히 다음 결함이 앉는 자리다(이 리포는 그걸 세 번 겪었다).
 *
 * 주석·문자열: 주석은 먼저 걷어낸다(이 리포의 가드는 산문에 네 번 속았다 —
 * `color-source` 의 기록). 문자열 리터럴은 걷어내지 **않는다**: `height={32}` 도
 * `size="s"` 도 JSX 속성이라 문자열 안에 살지 않고, 예시 JSX 는 주석 제거로
 * 이미 사라진다.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

/** 이 앱의 기본 행 컨트롤 높이. `.sr-date`·`.sr-pillbtn`·`.sr-naviconbtn`·
 * `.sr-clog-trigger`·`.sr-window-close` 가 CSS 로 적는 값과 같은 수다. */
export const CONTROL_H = 32;

/**
 * 허용되는 컨트롤 높이 — **등고는 앱 전역 상수가 아니라 행의 성질이다.**
 *
 * 실측으로 배운 것(2026-08-19): Setting 의 조달 스프레드 칸을 32 로 내리자
 * 오히려 나빠졌다. 그 칸의 이웃은 Select 가 아니라 **SegmentedTabs 이고 그건
 * 36** 이라, 32 는 중심선을 2px 벌리고 CDS 기본값 38 은 1px 벌리고 **36 만이
 * 0** 이었다. 그래서 이 가드는 "무조건 32" 가 아니라 "**명시된 높이**를 지고,
 * 그 값이 이 집합 안" 을 요구한다. 어느 값을 고르는지는 그 행이 정하고, 고른
 * 이유는 호출부 주석이 적는다.
 */
const ROW_HEIGHTS = new Set([32, 36]);


function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** 한 JSX 요소의 여는 태그 본문을 잘라낸다(`<TextInput` … 첫 `>` 까지). */
function openingTags(body: string, tag: string): string[] {
  const out: string[] = [];
  const rx = new RegExp(`<${tag}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = rx.exec(body))) {
    // 속성 안의 `>`(화살표 함수 등)를 넘기려면 중괄호 깊이를 센다.
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

/** CSS 에 적힌 컨트롤 높이 선언(같은 수를 여러 곳이 리터럴로 적고 있다). */
function cssControlHeights(): { sel: string; h: number }[] {
  const css = fs.readFileSync(path.join(SRC, 'theme', 'type.css'), 'utf8');
  const lines = stripComments(css).split('\n');
  const out: { sel: string; h: number }[] = [];
  let sel = '';
  for (const line of lines) {
    const s = line.match(/^(\.[a-z0-9-]+(?:\s*[>,+~]\s*[a-z0-9.-]+)*)\s*\{/i);
    if (s) sel = s[1].trim();
    const h = line.match(/^\s*height:\s*(\d+)px/);
    if (h && /^\.sr-(date|pillbtn|naviconbtn|clog-trigger|window-close)$/.test(sel)) {
      out.push({ sel, h: Number(h[1]) });
    }
  }
  return out;
}

const files = walk(SRC);

describe('한 행 = 한 컨트롤 높이', () => {
  it('검사할 소스를 실제로 찾았다', () => {
    // 스코프가 비면 아래 전부가 공짜로 통과한다.
    expect(files.length).toBeGreaterThan(20);
  });

  it('size="s" 인 TextInput 은 전부 명시된 행 높이를 진다', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const body = stripComments(fs.readFileSync(f, 'utf8'));
      for (const tag of openingTags(body, 'TextInput')) {
        if (!/size=["']s["']/.test(tag)) continue;
        const m = tag.match(/height=\{(\d+)\}/);
        if (!m) offenders.push(`${path.relative(ROOT, f)}: height 없음`);
        else if (!ROW_HEIGHTS.has(Number(m[1])))
          offenders.push(`${path.relative(ROOT, f)}: height={${m[1]}}`);
      }
    }
    expect(
      offenders,
      `size="s" TextInput 이 명시 높이 없이(또는 ${[...ROW_HEIGHTS].join('/')} 밖의 값으로) 서 있어요.\n` +
        `CDS 기본값은 38 이라 Select(32)·.sr-date(32) 와 같은 행에서 그 칸만 6px 높아지고,\n` +
        `이 행들은 바닥 정렬이라 라벨까지 6px 따라 올라갑니다(실측 라벨 줄 스프레드 18px).\n` +
        `값은 그 행의 이웃이 정합니다 — 이웃이 SegmentedTabs 면 36 입니다(Setting 실측).`,
    ).toEqual([]);
  });

  it(`CSS 가 적는 컨트롤 높이는 전부 ${CONTROL_H} 이다`, () => {
    const rows = cssControlHeights();
    // 다섯 셀렉터가 모두 잡혀야 한다 — 하나라도 빠지면 파서가 눈이 먼 것이다.
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const wrong = rows.filter((r) => r.h !== CONTROL_H);
    expect(
      wrong.map((w) => `${w.sel}=${w.h}`),
      `컨트롤 높이가 ${CONTROL_H} 이 아닌 선택자가 있어요. 이 앱의 행 컨트롤은 한 높이입니다.`,
    ).toEqual([]);
  });

  /* ── 심어서 실패하는지 증명 ──────────────────────────────────────────────
     가드가 "찾지 못해서" 통과하는 것과 "위반이 없어서" 통과하는 것은 다르다.
     아래는 위반을 일부러 만들어 검사식이 실제로 잡는지 본다(파일은 안 건드린다). */
  describe('자기 검증 — 심은 위반을 잡는다', () => {
    const check = (src: string) =>
      openingTags(stripComments(src), 'TextInput')
        .filter((t) => /size=["']s["']/.test(t))
        .filter((t) => {
          const m = t.match(/height=\{(\d+)\}/);
          return !m || !ROW_HEIGHTS.has(Number(m[1]));
        });

    it('height 없는 size="s" TextInput 을 잡는다', () => {
      expect(check(`<TextInput size="s" fontSize="legal" value={x} />`)).toHaveLength(1);
    });

    it('행 높이 32 는 통과시킨다', () => {
      expect(check(`<TextInput size="s" height={32} value={x} />`)).toHaveLength(0);
    });

    it('행 높이 36 도 통과시킨다 — 이웃이 SegmentedTabs 인 행', () => {
      expect(check(`<TextInput size="s" height={36} />`)).toHaveLength(0);
    });

    it('CDS 기본값 38 은 잡는다 — 명시했어도 행 높이가 아니다', () => {
      expect(check(`<TextInput size="s" height={38} />`)).toHaveLength(1);
    });

    it('주석 속 예시 JSX 는 세지 않는다', () => {
      expect(check(`/* 예시: <TextInput size="s" /> 처럼 쓰면 안 된다 */`)).toHaveLength(0);
      expect(check(`// <TextInput size="s" />`)).toHaveLength(0);
    });

    it('속성 안의 화살표 함수가 여는 태그를 끊지 않는다', () => {
      // `=>` 의 `>` 에서 태그가 끝난 것으로 읽으면 height 를 못 보고 오탐한다.
      expect(check(`<TextInput size="s" onChange={(e) => f(e)} height={32} />`)).toHaveLength(0);
    });

    it('CSS 파서가 잘못된 높이를 잡는다', () => {
      const fake = '.sr-date {\n  height: 36px;\n}\n';
      const lines = fake.split('\n');
      let sel = '';
      const found: number[] = [];
      for (const line of lines) {
        const s = line.match(/^(\.[a-z0-9-]+)\s*\{/i);
        if (s) sel = s[1];
        const h = line.match(/^\s*height:\s*(\d+)px/);
        if (h && sel === '.sr-date') found.push(Number(h[1]));
      }
      expect(found).toEqual([36]);
      expect(found.filter((h) => h !== CONTROL_H)).toHaveLength(1);
    });
  });
});
