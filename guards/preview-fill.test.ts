/* 미리보기 pane 의 차트 높이는 **재서** 정한다, 상수로 빼서 정하지 않는다.
 *
 * 실측 2026-08-14 — 이 가드가 막는 회귀는 이렇게 생겼다:
 *
 *     히어로  128
 *     차트    732   ← `카드높이 − PREVIEW_CHROME_H(176)` 로 정했다
 *     범례     22
 *     통계    115   ← 카드 밖으로 **88px** 밀려 `.sr-card` 의 overflow 에 잘렸다
 *     ─────────
 *     실제 차트 아닌 것 = 128 + 22 + 115 = **265** (상수는 176, 89 부족)
 *
 * 화면에서는 「이 구간」·「변화」·「52주」 세 열이 **그냥 없었다.** 사라진 것이
 * 아니라 잘린 것이고, 잘린 쪽은 아무 표시도 남기지 않는다.
 *
 * 상수를 265 로 올리는 것은 답이 아니다 — 셋 다 고정 높이가 아니다:
 *   · 범례는 기준선이 있을 때만 선다(bp·ratio 차트엔 없다)
 *   · 통계 3열은 폭이 좁으면 접힌다
 *   · 히어로는 라벨이 길면 줄바꿈한다
 * 어떤 상수를 넣어도 어떤 화면에서는 틀린다.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = (rel: string) =>
  readFileSync(join(process.cwd(), rel), 'utf8')
    /* 주석 먼저 걷어낸다 — 위 설명문에 `PREVIEW_CHROME_H` 라고 적혀 있고, 안 걷으면
       이 가드가 자기 주석에 걸린다(이 리포에서 네 번 겪었다). */
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('미리보기 차트 높이', () => {
  const page = SRC('src/app/page.tsx');
  const pane = SRC('src/ui/PreviewPane.tsx');

  it('페이지가 차트 크롬 상수를 다시 만들지 않는다', () => {
    expect(page).not.toMatch(/PREVIEW_CHROME_H/);
  });

  it('본문 pane 은 재는 쪽(`fill`)으로 그린다', () => {
    /* `height={…}` 산술을 넘기던 자리. `fill` 이면 pane 이 남는 높이를 스스로 잰다. */
    // onEnlarge 와 fill 사이에 다른 prop 이 서도 된다(예: onOpenBacktest) —
    // 계약은 「본문 pane 이 fill 을 단다」이지 prop 의 이웃 관계가 아니다.
    expect(page).toMatch(/onEnlarge=\{previewRow[^}]*\}[\s\S]{0,400}?fill\s*\/>/);
  });

  it('그림 상자가 되먹임 없이 남는 높이를 갖는다', () => {
    /* `flexBasis={0}` 이 없으면 상자의 기본 크기가 자기 내용(=방금 잰 높이로 그린
       차트)이 되어, 잴 때마다 조금씩 자란다. 0 으로 못박아야 «남는 만큼»이 된다. */
    const boxes = pane.match(/flexBasis=\{fill \? 0 : undefined\}/g) ?? [];
    expect(boxes.length, '커브·히스토리 두 그림 상자 모두').toBe(2);

    const grows = pane.match(/flexGrow=\{fill \? 1 : undefined\}/g) ?? [];
    expect(grows.length, '두 상자 + 두 루트 열').toBe(4);
  });

  it('세 통계 열은 여전히 본문에 그려진다', () => {
    // 잘린 것을 「안 그리기」로 고치는 것도 회귀다. 오너가 보고 싶어한 정보다.
    expect(pane).toMatch(/<StatColumns row=\{row\} view=\{view\} u=\{u\} \/>/);
    expect(pane).toMatch(/title="이 구간"/);
  });
});
