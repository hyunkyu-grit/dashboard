import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 컨트롤 값은 13px — **모든 창·모든 화면의 규칙** [OWNER 2026-08-19 — "이거
 * 백테스트 창 뿐만 아니라 모든 창에 있어서 규칙처럼 박아야 해"].
 *
 * CDS 는 size="s" 여도 Select/TextInput 의 값 텍스트를 body(16px)로 찍는다.
 * 이 제품의 컨트롤 주변은 전부 13px 이다 — 칸 라벨(caption), 날짜 입력
 * (`ui/IsoDateField`), 조건 바. 값만 16px 이면 그 칸이 화면에서 혼자 크고, 실제로
 * 백테스트 창의 종목·방향·규모가 그랬다.
 *
 * 줄이는 자리는 prop 하나다: Select 는 `font="legal"`, TextInput 은
 * `fontSize="legal"`(legal = 13px, `sauronTheme.ts`). `styles.controlValueNode`
 * 는 **안 먹힌다** — 감싸는 DIV 인라인에 앉아 값 `<p>` 자신의 body 아토믹
 * 클래스에 진다(실측 2026-08-19, `ui/window/popup.ts` 의 기록).
 *
 * ── 왜 렌더가 아니라 소스를 읽나 ────────────────────────────────────────────
 * jsdom 은 CDS 스타일시트를 안 싣는다 — 계산된 font-size 를 물으면 환경이
 * 거짓을 답한다(`ch-context.test.ts` 의 같은 판단). 규칙이 사는 자리는 호출부의
 * prop 이고, 그 prop 의 존재는 소스가 정직하게 말한다.
 */

const SRC_ROOT = path.resolve(import.meta.dirname, '../src');

function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return e.name.endsWith('.tsx') ? [p] : [];
  });
}

/** `<Tag` 여는 태그의 prop 구간(첫 `>` 까지)들. 주석 속 태그는 없다 — 이
 * 리포의 JSX 주석은 `{/* … *\/}` 라 태그 모양이 아니다. */
function openingTags(src: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const end = src.indexOf('>', m.index);
    out.push(src.slice(m.index, end === -1 ? src.length : end + 1));
  }
  return out;
}

describe('컨트롤 값 13px 규칙 — 새 Select/TextInput 이 규칙을 빠뜨리면 여기서 죽는다', () => {
  const files = tsxFiles(SRC_ROOT);

  it('모든 CDS Select 호출부는 font="legal" 을 진다', () => {
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      if (!src.includes("from '@coinbase/cds-web/alpha/select'")) continue;
      for (const t of openingTags(src, 'Select')) {
        expect(t, `${path.relative(SRC_ROOT, f)} 의 ${t.slice(0, 60)}…`).toMatch(
          /font="legal"/,
        );
      }
    }
  });

  it('모든 CDS TextInput 호출부는 fontSize="legal" 을 진다', () => {
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      if (!src.includes("from '@coinbase/cds-web/controls'")) continue;
      for (const t of openingTags(src, 'TextInput')) {
        expect(t, `${path.relative(SRC_ROOT, f)} 의 ${t.slice(0, 60)}…`).toMatch(
          /fontSize="legal"/,
        );
      }
    }
  });

  it('날짜 입력도 13px 에 서 있다 — 이제 CSS 가 아니라 **prop** 이 진다', () => {
    /* `.sr-date`(네이티브 `<input type="date">` 의 CSS 훅)가 지던 규칙이다.
       2026-08-26 에 CDS `DateInput` 으로 옮기면서 그 클래스가 사라졌고, 같은
       명제는 `ui/IsoDateField` 의 `fontSize: 'legal'` 이 진다 — legal 이 곧
       13px 다(`sauronTheme.ts`). 재는 자리가 옮겨졌을 뿐 명제는 그대로다. */
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/ui/IsoDateField.tsx'),
      'utf8',
    );
    expect(src).toMatch(/fontSize: 'legal' as const/);
  });
});
