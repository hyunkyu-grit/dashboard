import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from './_source';
import {
  decodeFacets,
  decodeRange,
  decodeSort,
  encodeFacets,
  encodeRange,
  encodeSort,
} from '../src/terminal/urlState';
import { SHORTCUTS } from '../src/terminal/ShortcutHelp';
import { TABLE_SORT_KEYS } from '../src/terminal/apps/TableApp';

/**
 * 터미널 목업의 **키보드 문법과 주소 상태**를 지킨다.
 *
 * ── 왜 이 가드가 필요했나 (2026-08-27) ──────────────────────────────────────
 * 이 화면은 한 번 **마우스 전용**으로 지어졌다. 눌리는 것이 전부 `<g onClick>`
 * 이라 탭이 닿지 않았고, 표는 반대로 행마다 탭 정지를 둬서 348번 탭이 됐다.
 * 고치는 것은 한나절이었지만, 축을 하나 더 만드는 날 같은 자리를 다시 밟는 것은
 * 아무것도 막지 않는다 — «그림 위에 `onClick` 을 얹는다» 가 제일 쓰기 쉬운
 * 코드이기 때문이다.
 *
 * 그래서 세 가지를 잰다:
 *
 *   1. 그림 축은 **키보드 위젯**이어야 한다 — `role`·`tabIndex`·`aria-label`·
 *      `onKeyDown` 네 개가 한 벌이다. 셋만 있으면 탭은 닿는데 아무 일도 안
 *      일어나거나(핸들러 없음), 닿아도 이름이 없어 «무엇인지 모를 것» 이 된다.
 *   2. 단축키는 **화면에 적혀 있어야** 한다. 첫 판은 여덟 개 중 하나만 화면에
 *      있었고 나머지는 소스 주석에만 있었다 — 코드를 읽는 사람만 쓸 수 있는
 *      기능은 없는 기능이다.
 *   3. 주소 부호화는 **왕복이 손실 없어야** 한다. 공유한 주소가 다른 화면을
 *      열면 그 기능은 없느니만 못하다(틀린 것을 맞다고 말하므로).
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const TERM = path.join(ROOT, 'src', 'terminal');

const read = (rel: string) => stripComments(fs.readFileSync(path.join(TERM, rel), 'utf8'));

/** 그림으로 그려지는 축 셋. 표는 CDS `Table` 이라 문법이 다르다(roving 은 같지만
 *  `role` 은 표의 것을 쓴다). */
const PLOT_APPS = ['apps/GraphApp.tsx', 'apps/TimelineApp.tsx', 'apps/ChartApp.tsx'];

describe('터미널 — 그림 축은 키보드로 쓸 수 있다', () => {
  it('검사할 소스를 실제로 찾았다', () => {
    // 스코프가 비면 아래 전부가 공짜로 통과한다.
    for (const f of PLOT_APPS) {
      expect(fs.existsSync(path.join(TERM, f)), f).toBe(true);
    }
  });

  it.each(PLOT_APPS)('%s 는 초점을 받고 키를 듣는다', (f) => {
    const src = read(f);
    expect(src, `${f}: role="application" 이 없어요`).toContain('role="application"');
    expect(src, `${f}: tabIndex 가 없어요 — 탭이 닿지 않습니다`).toMatch(/tabIndex=\{0\}/);
    expect(src, `${f}: onKeyDown 이 없어요 — 닿아도 아무 일이 안 일어납니다`).toContain(
      'onKeyDown={onKeyDown}',
    );
    /* 이름은 «무엇인가» 만이 아니라 «여기서 화살표가 무엇을 하는가» 를 적는다 —
       규칙을 안 적으면 눌러 볼 이유가 없다. */
    expect(src, `${f}: aria-label 이 없어요`).toMatch(/aria-label="[^"]*화살표[^"]*"/);
  });

  it.each(PLOT_APPS)('%s 는 짚은 자리를 소리로 읽는다', (f) => {
    const src = read(f);
    expect(src, `${f}: aria-live 줄이 없어요 — 그림의 변화는 소리가 안 납니다`).toContain(
      'aria-live="polite"',
    );
  });

  /** 확대 키는 **축마다 같아야 한다.** 다르면 축을 바꿀 때마다 새로 배운다. */
  it.each(['apps/GraphApp.tsx', 'apps/TimelineApp.tsx', 'apps/ChartApp.tsx'])(
    '%s 의 확대 키는 + − 0 이다',
    (f) => {
      const src = read(f);
      for (const key of ["case '+':", "case '-':", "case '0':"]) {
        expect(src, `${f}: ${key} 가 없어요`).toContain(key);
      }
    },
  );

  it('눌리는 것의 판정은 24px 이상이다 (WCAG 2.2 §2.5.8)', () => {
    /* 그래프는 반지름 12(지름 24), 시간축은 폭 24 의 rect. 그림을 키우는 대신
       판정만 넓히는 것이 이 지침의 표준 해법이라, 두 수가 각자 자기 파일에 있다. */
    expect(read('apps/GraphApp.tsx')).toMatch(/const HIT_R = 12;/);
    expect(read('apps/TimelineApp.tsx')).toMatch(/className="sr-term-hit"[\s\S]{0,200}width=\{24\}/);
  });

  it('표는 탭 정지 한 칸이다 — 행마다가 아니라', () => {
    const src = read('apps/TableApp.tsx');
    expect(src, 'roving tabindex 가 아니에요 — 348행이 전부 탭 정지가 됩니다').toContain(
      'tabIndex={vi.index === active ? 0 : -1}',
    );
  });
});

describe('터미널 — 단축키는 화면에 적혀 있다', () => {
  /** 셸이 전역으로 듣는 키. 여기 있는 것은 `SHORTCUTS` 에도 있어야 한다. */
  const GLOBAL_KEYS: { probe: RegExp; inList: RegExp }[] = [
    { probe: /e\.key\.toLowerCase\(\) === 'k'/, inList: /Ctrl/ },
    { probe: /e\.key === '\/'/, inList: /^\/$/ },
    { probe: /e\.key === '\?'/, inList: /^\?$/ },
  ];

  it('셸이 듣는 전역 키가 목록에 있다', () => {
    const shell = read('TerminalShell.tsx');
    for (const { probe, inList } of GLOBAL_KEYS) {
      expect(shell, `셸이 ${probe} 를 안 듣습니다 — 목록과 코드가 갈렸어요`).toMatch(probe);
      expect(
        SHORTCUTS.some((s) => inList.test(s.keys)),
        `${inList} 가 SHORTCUTS 에 없어요 — 소스에만 있는 단축키가 됩니다`,
      ).toBe(true);
    }
  });

  it('Alt 조합키(이력·축)도 목록에 있다', () => {
    expect(SHORTCUTS.some((s) => /Alt \+ ← \/ →/.test(s.keys))).toBe(true);
    expect(SHORTCUTS.some((s) => /Alt \+ 1/.test(s.keys))).toBe(true);
  });

  it('한 글자 단축키는 끌 수 있다 (WCAG 2.1.4)', () => {
    const shell = read('TerminalShell.tsx');
    /* `singleKeys` 가 꺼지면 `/`·`?` 앞에서 되돌아 나가야 한다. 이 한 줄이
       그 기준을 만족시키는 전부라, 사라지면 조용히 미준수가 된다. */
    expect(shell).toContain('if (typing || !singleKeys) return;');
    /* 조합키는 그 스위치보다 **위에서** 처리돼야 한다 — 끄더라도 Ctrl+K 와
       Alt+숫자는 계속 들어야 하기 때문이다. */
    const gate = shell.indexOf('if (typing || !singleKeys) return;');
    expect(shell.indexOf("e.key.toLowerCase() === 'k'")).toBeLessThan(gate);
    expect(shell.indexOf('e.altKey && !e.ctrlKey')).toBeLessThan(gate);
  });

  it('모든 항목에 «무엇을 하는가» 가 적혀 있다', () => {
    for (const s of SHORTCUTS) {
      expect(s.what.length, `${s.keys} 의 설명이 너무 짧아요`).toBeGreaterThan(4);
    }
  });
});

describe('터미널 — 주소는 앱의 훅을 쓰고, 왕복이 손실 없다', () => {
  it('주소 쓰기를 새로 만들지 않았다', () => {
    /* `ui/useUrlState.ts` 가 이 앱의 규약을 진다(라우터 금지 — v1 의 프로덕션
       전용 라우터 사고). 두 벌이 되면 한쪽만 그 사고를 기억한다. */
    const shell = read('TerminalShell.tsx');
    expect(shell).toContain("from '@/ui/useUrlState'");
    for (const f of ['TerminalShell.tsx', 'urlState.ts']) {
      expect(read(f), `${f} 가 history 를 직접 씁니다`).not.toMatch(/history\.(replace|push)State/);
      expect(read(f), `${f} 가 라우터로 주소를 씁니다`).not.toMatch(/useRouter|router\./);
    }
  });

  it('패싯은 왕복해도 같은 집합이다', () => {
    const sel = {
      kind: new Set(['BSS', '국고채']),
      tenor: new Set(['3Y']),
      rv: new Set(['Score 상위 25%']),
    };
    const back = decodeFacets(encodeFacets(sel));
    expect(new Set(Object.keys(back))).toEqual(new Set(['kind', 'tenor', 'rv']));
    expect([...back.kind!].sort()).toEqual(['BSS', '국고채']);
    expect([...back.rv!]).toEqual(['Score 상위 25%']);
  });

  it('빈 선택은 주소에 안 적힌다', () => {
    expect(encodeFacets({})).toBeUndefined();
    expect(encodeFacets({ kind: new Set() })).toBeUndefined();
    expect(decodeFacets(undefined)).toEqual({});
  });

  it('모르는 패싯 키가 든 옛 주소는 무시된다', () => {
    /* 화면이 깨지는 대신 그 조각만 빠진다 — 공유해 둔 주소가 배포 뒤에 죽지
       않게 하는 값싼 보험이다. */
    expect(decodeFacets('counterparty~ABC;tenor~3Y')).toEqual({ tenor: new Set(['3Y']) });
  });

  it('구분자가 든 값은 **적히지 않는다** — 다른 필터로 복원되느니', () => {
    expect(encodeFacets({ kind: new Set(['a|b']) })).toBeUndefined();
  });

  it('구간은 날 경계로 넓혀 적히고, 끝날의 객체가 살아 있다', () => {
    /* 브러시는 하루 안의 아무 시각이나 낸다(픽셀을 시각으로 되돌린 값이라).
       그 두 시각이 같은 날짜 쌍으로 적혀야 한다. */
    const lo = Date.UTC(2026, 0, 2) + 3_600_000;
    const hi = Date.UTC(2026, 2, 4) + 7_200_000;
    const raw = encodeRange([lo, hi]);
    expect(raw).toBe('2026-01-02..2026-03-04');

    const back = decodeRange(raw)!;
    /* 끝날의 객체(그날 UTC 자정)가 구간 안에 있어야 한다 — 이 화면의 필터가
       `t >= lo && t <= hi` 이고 모든 `t` 가 UTC 자정이라, 끝을 자정으로 적으면
       그 하루가 통째로 빠진다. */
    expect(back[0]).toBeLessThanOrEqual(Date.UTC(2026, 0, 2));
    expect(back[1]).toBeGreaterThanOrEqual(Date.UTC(2026, 2, 4));

    /* 그리고 한 번 더 적어도 같은 주소여야 한다 — 화면이 구간을 되읽어 다시
       쓰는 일이 있고(칩·복원), 거기서 하루씩 밀리면 조용히 창이 자란다. */
    expect(encodeRange(back)).toBe(raw);
  });

  it('망가진 구간은 «구간 없음» 이다', () => {
    expect(decodeRange('nonsense')).toBeNull();
    expect(decodeRange('2026-03-04..2026-01-02')).toBeNull();
    expect(decodeRange(undefined)).toBeNull();
  });

  it('정렬은 왕복하고, 모르는 열은 기본으로 떨어진다', () => {
    const spec = { key: 'score' as const, desc: false };
    expect(decodeSort(encodeSort(spec), TABLE_SORT_KEYS, { key: 'z', desc: true })).toEqual(spec);
    expect(decodeSort('counterparty:desc', TABLE_SORT_KEYS, { key: 'z', desc: true })).toEqual({
      key: 'z',
      desc: true,
    });
  });
});
