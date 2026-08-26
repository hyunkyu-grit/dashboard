import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { stripComments } from './_source';

/**
 * 간격은 **한 계단** 위에 선다.
 *
 * ── 왜 이 가드가 필요했나 (실측, 2026-08-19) ─────────────────────────────────
 * 이 앱의 간격 값은 네 갈래에서 나온다: CDS 스타일 prop(222) · `type.css` px
 * 리터럴(299) · 숫자 layout prop(96) · 인라인 style(68). 그리고 스페이싱·크기
 * **토큰은 0건**이었다. 같은 역할(행 컨트롤 높이 32)을 네 곳이 각각 리터럴로
 * 적고 있었고, 다섯 번째가 다른 값(38)을 갖게 됐을 때 아무것도 그것을 잡지
 * 못했다 — 그 결함이 `control-parity` 가 생긴 이유다.
 *
 * ── 계단이 CDS 것과 어긋나 있다는 사실부터 ──────────────────────────────────
 * `sauronTheme.ts:73` 이 `space['1']` 을 8 → **6** 으로 덮는다. `ROW_H = 60` 을
 * 정확히 맞추기 위한 것이고(셀 내부 패딩 6+6), 그래서 이 앱의 계단은
 *
 *     0.25→2   0.5→4   0.75→6   1→6(재정의)   1.5→12   2→16   3→24   4→32
 *
 * 이다. 두 가지가 따라온다: (a) `0.75` 와 `1` 이 **같은 6** 으로 떨어지고,
 * (b) **8 은 prop 으로 도달할 수 없다** — 그런데 `type.css` 는 8 을 20번 쓴다.
 * 즉 두 갈래가 구조적으로 어긋나 있다. `space['1']` 은 ROW_H 를 지탱하므로
 * 되돌릴 수 없다(하드스톱). 그래서 이 가드는 **8 을 계단에 포함**해서 현실을
 * 적고, 그 밖의 값만 사유를 요구한다.
 *
 * ── 주석·문자열 ────────────────────────────────────────────────────────────
 * 주석은 먼저 걷어낸다(이 리포의 가드는 산문에 네 번 속았다 — `color-source`).
 * 문자열 리터럴은 걷어내지 않는다: 간격은 JSX 속성값(`gap={2}`)이나 CSS 선언
 * (`padding: 8px`)이라 문자열 안에 살지 않고, 주석 속 예시는 주석 제거로 이미
 * 사라진다.
 *
 * ── 스코프 ─────────────────────────────────────────────────────────────────
 * `src/**` glob. 컴포넌트를 손으로 열거하지 않는다 — 열거를 빠뜨린 컴포넌트가
 * 정확히 다음 결함이 앉는 자리다.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

/** 이 앱의 간격 계단(px). 위 주석의 산술 그대로 + CSS 가 실제로 쓰는 8. */
const SCALE = new Set([0, 2, 4, 6, 8, 12, 16, 24, 32]);

/** CDS 스타일 prop 에 넣어도 되는 계단 값(전부 SCALE 로 떨어진다). */
const PROP_STEPS = new Set(['0', '0.25', '0.5', '0.75', '1', '1.5', '2', '3', '4']);

/**
 * 계단 밖인데 남겨 둔 값 — **사유가 없으면 남길 수 없다.**
 *
 * 규칙: 새 값을 여기 추가하려면 왜 계단 위로 못 올라가는지, 올리면 무엇이
 * 움직이는지를 적어야 한다. 그리고 아래 테스트가 **쓰이지 않는 예외를 잡는다**
 * — 자리를 뜬 예외가 남아 계단을 조용히 헐겁게 만드는 것을 막는다.
 */
const ALLOW: Record<number, string> = {
  10:
    '드 팩토 다섯째 계단. 일곱 선택자가 쓴다(.sr-megaitem/.sr-drawer-tab/' +
    '.sr-clog-trigger/.sr-clog-empty/.sr-clog-more/.sr-matrix-foot/.sr-rv-bar). ' +
    '8 이나 12 로 올리면 일곱 표면의 기하가 동시에 움직이므로 각각 재측정이 필요하다 ' +
    '— 이번 패스가 결함으로 측정한 목록에는 없어서 손대지 않았다.',
  7:
    '.sr-rv-divided tbody td — 1px border-top 과 합쳐 랭킹 표 행 높이를 만드는 값. ' +
    '8 로 올리면 행마다 2px, 67행이 움직인다(동시 레인이 방금 이 표를 맞췄다).',
  5: '.sr-clog-line — 변화기록 한 줄의 세로 인셋. 4 로 내리는 것이 옳아 보이나 팝오버 줄 간격 재측정이 필요해 이번 패스에서는 사유만 남긴다.',
  14: '.sr-simcard — 좌우 14/상하 12 의 비대칭 인셋. 12 로 맞추면 시뮬 여섯 카드의 폭 산술을 다시 재야 한다.',
  1:
    '.sr-a11y-only margin — 눈에 안 보이고 낭독기에만 읽히는 텍스트를 1px 로 ' +
    '오려 두는 표준 수법이다(2026-08-26 캔버스 차트 이관). 이 1px 은 «간격» 이 ' +
    '아니라 **오려낼 상자의 크기**라 계단과 같은 축의 값이 아니다. 8 로 올리면 ' +
    '그 상자가 화면에 보이기 시작한다.',
  20: '.sr-waterfall padding-top — 워터폴 막대 위 라벨이 앉는 자리. 16/24 중 어느 쪽도 라벨과 막대의 광학 간격을 그대로 두지 못한다.',
};


function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

const SPACING_PROP =
  /\b(padding|paddingX|paddingY|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingStart|paddingEnd|margin|marginX|marginY|marginTop|marginBottom|marginLeft|marginRight|gap|rowGap|columnGap)=\{(-?[0-9.]+)\}/g;

const SPACING_DECL = /(?:^|[\s;{])(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?:\s*([^;}]+)/g;

/** 간격 선언 한 줄에서 px 값들. `calc()`·`var()`·%·auto 는 계단의 일이 아니다. */
function pxValues(decl: string): number[] {
  if (/var\(|calc\(|%|auto/.test(decl)) return [];
  return [...decl.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Math.abs(Number(m[1])));
}

const tsxFiles = walk(SRC, ['.tsx']);
const cssFiles = walk(SRC, ['.css']);

/** 실제로 쓰이고 있는 계단 밖 값 → 어디서 */
function offScale(): Map<number, Set<string>> {
  const found = new Map<number, Set<string>>();
  for (const f of cssFiles) {
    const body = stripComments(fs.readFileSync(f, 'utf8'));
    for (const m of body.matchAll(SPACING_DECL)) {
      for (const v of pxValues(m[1])) {
        if (SCALE.has(v)) continue;
        if (!found.has(v)) found.set(v, new Set());
        found.get(v)!.add(path.relative(ROOT, f));
      }
    }
  }
  return found;
}

describe('간격은 한 계단 위에 선다', () => {
  it('검사할 소스를 실제로 찾았다', () => {
    // 스코프가 비면 아래 전부가 공짜로 통과한다.
    expect(tsxFiles.length).toBeGreaterThan(20);
    expect(cssFiles.length).toBeGreaterThanOrEqual(3);
  });

  it('CDS 스타일 prop 의 값은 전부 계단 값이다', () => {
    const bad: string[] = [];
    for (const f of tsxFiles) {
      const body = stripComments(fs.readFileSync(f, 'utf8'));
      for (const m of body.matchAll(SPACING_PROP)) {
        if (!PROP_STEPS.has(m[2])) bad.push(`${path.relative(ROOT, f)}: ${m[1]}={${m[2]}}`);
      }
    }
    expect(
      bad,
      `CDS 간격 prop 에 계단 밖 값이 들어갔어요. 쓸 수 있는 값: ${[...PROP_STEPS].join(', ')}\n` +
        `(이 앱은 space['1'] 이 6 이라 8px 은 prop 으로 못 만듭니다 — CSS 쪽에서 8px 을 쓰세요.)`,
    ).toEqual([]);
  });

  it('CSS 의 간격 px 는 계단 위이거나, 사유가 적힌 예외다', () => {
    const found = offScale();
    const unexplained = [...found.entries()]
      .filter(([v]) => !(v in ALLOW))
      .map(([v, where]) => `${v}px (${[...where].join(', ')})`);
    expect(
      unexplained,
      `계단(${[...SCALE].join('/')}) 밖 간격이 사유 없이 들어왔어요.\n` +
        `계단으로 올리거나, 못 올리는 이유와 올렸을 때 움직이는 것을 ALLOW 에 적어 주세요.`,
    ).toEqual([]);
  });

  it('쓰이지 않는 예외는 남겨 두지 않는다', () => {
    const found = offScale();
    const stale = Object.keys(ALLOW)
      .map(Number)
      .filter((v) => !found.has(v));
    expect(
      stale,
      `ALLOW 에 있는데 소스에서 사라진 값이에요 — 지워 주세요(예외가 남으면 계단이 헐거워집니다).`,
    ).toEqual([]);
  });

  it('모든 예외에 사유 문장이 있다', () => {
    for (const [v, reason] of Object.entries(ALLOW)) {
      expect(reason.length, `${v}px 의 사유가 너무 짧아요`).toBeGreaterThan(30);
    }
  });

  /* ── 심어서 실패하는지 증명 ──────────────────────────────────────────────── */
  describe('자기 검증 — 심은 위반을 잡는다', () => {
    const propBad = (src: string) =>
      [...stripComments(src).matchAll(SPACING_PROP)].filter((m) => !PROP_STEPS.has(m[2]));
    const cssBad = (src: string) => {
      const out: number[] = [];
      for (const m of stripComments(src).matchAll(SPACING_DECL))
        for (const v of pxValues(m[1])) if (!SCALE.has(v)) out.push(v);
      return out;
    };

    it('계단 밖 prop 값을 잡는다', () => {
      expect(propBad('<Box padding={2.5} />')).toHaveLength(1);
      expect(propBad('<Box gap={7} />')).toHaveLength(1);
    });

    it('계단 위 prop 값은 통과시킨다', () => {
      expect(propBad('<Box padding={2} gap={1.5} marginTop={0.25} />')).toHaveLength(0);
    });

    it('계단 밖 CSS px 를 잡는다', () => {
      expect(cssBad('.x { padding: 9px 3px; }')).toEqual([9, 3]);
      expect(cssBad('.x { gap: 13px; }')).toEqual([13]);
    });

    it('계단 위 CSS px 는 통과시킨다', () => {
      expect(cssBad('.x { padding: 8px 16px; margin: 0 24px; gap: 12px; }')).toEqual([]);
    });

    it('주석 속 예시는 세지 않는다', () => {
      expect(cssBad('/* padding: 13px 은 금지 */')).toEqual([]);
      expect(propBad('/* <Box gap={7} /> 처럼 쓰지 말 것 */')).toHaveLength(0);
    });

    it('토큰·calc·%·auto 는 계단의 일이 아니다', () => {
      expect(cssBad('.x { padding: var(--sr-pad); }')).toEqual([]);
      expect(cssBad('.x { margin: calc(100% - 13px); }')).toEqual([]);
      expect(cssBad('.x { padding: 0 auto; gap: 50%; }')).toEqual([]);
    });

    it('border/height 같은 다른 속성의 px 는 안 본다', () => {
      // 1px 헤어라인이나 32px 높이가 간격 계단에 끌려 들어오면 오탐이 된다.
      expect(cssBad('.x { border-top: 1px solid red; height: 33px; }')).toEqual([]);
    });
  });
});
