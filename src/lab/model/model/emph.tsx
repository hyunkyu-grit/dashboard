/* 페이로드 문장 안의 `**강조**` 를 실제 굵은 글씨로 바꾼다.
 *
 * ## 왜 필요했나
 *
 * 이 두 면의 문장은 대부분 **정적 JSON** 에서 온다(`model_surface.json` ·
 * `method_surface.json` · `wiring_graph.json`). 그 문장을 쓰는 자리는
 * `backend/wiring/surfaces.py` 이고, 거기서는 마크다운으로 강조를 적는 것이
 * 자연스럽다 — 같은 문장이 진단 문서에도 들어가기 때문이다.
 *
 * 그런데 React 는 문자열을 그대로 그린다. 실측 2026-08-21: 화면에
 * 「완전예견 \*\*적층 선형해\*\*라」 가 별표째 찍혔다. 강조가 강조가 아니라
 * **잡음**이 된 것이다.
 *
 * 고르는 길은 둘이었다 — 페이로드에서 별표를 걷거나, 화면이 읽거나. 걷으면
 * 강조가 통째로 사라진다(그 문장들에서 굵은 부분이 곧 요점이다). 그래서 읽는다.
 *
 * ## 마크다운을 구현하는 게 아니다
 *
 * `**` 한 가지만 본다. 링크도 목록도 코드도 안 다룬다 — 페이로드가 그것들을 안
 * 쓰고, 쓰기 시작하면 여기가 아니라 그 문장을 고쳐야 한다.
 */

import { Fragment } from 'react';

/** `**` 쌍으로 자른다. 짝이 안 맞는 별표는 **글자 그대로** 남긴다. */
export function splitEmphasis(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  let rest = text;
  while (rest.length > 0) {
    const open = rest.indexOf('**');
    if (open < 0) break;
    const close = rest.indexOf('**', open + 2);
    if (close < 0) break;
    if (open > 0) out.push({ text: rest.slice(0, open), bold: false });
    out.push({ text: rest.slice(open + 2, close), bold: true });
    rest = rest.slice(close + 2);
  }
  if (rest.length > 0) out.push({ text: rest, bold: false });
  return out.filter((p) => p.text.length > 0);
}

/** 페이로드 문장 하나. `<Text>` 안에 그대로 넣는다. */
export function Emph({ t }: { t: string | null | undefined }) {
  if (!t) return null;
  return (
    <>
      {splitEmphasis(t).map((p, i) => (
        <Fragment key={i}>{p.bold ? <b>{p.text}</b> : p.text}</Fragment>
      ))}
    </>
  );
}
