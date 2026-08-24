/* 페이로드에 실려 오는데 아무 면도 안 쓰는 칸이 있나.
 *
 * ## 이 가드가 잡은 것
 *
 * 2026-08-24 에 넷을 잡았다. `engine_status.json` 의 **`known_seams`** ·
 * `tests` · `engine` 이 계약에 타입까지 있고(`contracts.ts::EngineStatus`)
 * 리베이크가 매번 프런트로 옮기는데, **어느 면도 렌더하지 않았다.**
 *
 * 이음매 셋 중 둘은 트레이더가 당장 알아야 하는 것이다 — IRS 다리에
 * 기간프리미엄이 안 오고, 국고 3년은 기대가설 평균만이다. 그걸 모르고 화면의
 * bp 를 읽으면 «커브가 이만큼» 을 «가격이 이만큼» 으로 읽는다.
 *
 * ## 왜 이런 게 조용히 생기나
 *
 * 백엔드가 칸을 늘리는 것과 프런트가 그 칸을 세우는 것이 **다른 세션**이다.
 * 계약(`contracts.ts`)에 타입을 다는 것까지는 같이 가는데, 렌더는 안 따라온다.
 * 타입은 「이 칸이 온다」 를 말하지 「이 칸을 쓴다」 를 말하지 않는다.
 *
 * ## 「쓴다」 를 어떻게 재나
 *
 * 소스에 그 이름이 **문자로** 있나만 본다. 무르지만 이 병에는 맞다 — 안 쓰는
 * 칸은 이름이 소스 어디에도 안 나온다. 주석은 걷어 낸다(주석에 이름을 적어
 * 놓고 렌더는 안 하는 것이 정확히 이 병이다).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments, walk } from './_source';

const ROOT = join(__dirname, '..');
const LAB = join(ROOT, 'src', 'lab', 'model');

/** 페이로드와 그 사본이 사는 자리. 프런트가 읽는 쪽을 본다. */
const PAYLOADS = [
  'artifacts/engine_status.json',
  'artifacts/assumptions.json',
  'artifacts/paper_anchors.json',
  'method/method_surface.json',
  'method/backtest_2021_cycle.json',
  'model/model_surface.json',
  'model/wiring_graph.json',
] as const;

/** 안 써도 되는 칸과 **그 이유**. 이유 없이 여기 넣지 마세요. */
const EXEMPT: Record<string, string> = {
  module: '페이로드가 자기 이름을 다는 태그예요. 화면에 낼 것이 아니에요.',
  data_edge_q:
    'assumptions 가 든 사본이에요. 화면은 engine_status.data_edge 쪽 한 벌만 ' +
    '읽어요 — 두 벌을 다 렌더하면 한쪽만 낡았을 때 화면이 자기와 다투게 돼요.',
  written_at:
    '리베이크가 이 파일을 **쓴 시각**이에요. 화면이 말하는 날짜는 기저를 구운 ' +
    'basis_as_of 이고, 그 둘이 같이 서면 트레이더가 어느 쪽을 볼지 고르게 돼요.',
};

/** 인용부호 문자군. **정규식 리터럴에서 꺼낸다.**
 *
 *  템플릿 리터럴 안에서 손으로 짜면 `\b` 가 정규식의 낱말 경계가 아니라
 *  **백스페이스 문자**가 된다. 2026-08-24 에 이 파일이 실제로 그랬고, 그래서
 *  가드가 «전부 안 쓰인다» 고 말했다 — 위반이 아니라 가드가 고장 난 것이었다. */
const QUOTE = /['"`]/.source;

const SOURCE = walk(LAB, ['.ts', '.tsx'])
  .map((f) => stripComments(readFileSync(f, 'utf8')))
  .join('\n');

describe('페이로드의 칸이 화면에 선다', () => {
  for (const rel of PAYLOADS) {
    it(`${rel} — 최상위 칸이 전부 쓰인다`, () => {
      const j = JSON.parse(readFileSync(join(LAB, rel), 'utf8')) as Record<string, unknown>;
      const unused = Object.keys(j).filter(
        (k) =>
          !(k in EXEMPT) &&
          !new RegExp('\\.' + k + '\\b|' + QUOTE + k + QUOTE).test(SOURCE),
      );
      expect(unused, `${rel} 의 이 칸들이 아무 데도 안 쓰여요`).toEqual([]);
    });
  }

  it('면제 목록의 칸은 이유를 든다 — 이유 없이 늘어나면 목록이 쓰레기통이 된다', () => {
    for (const [k, why] of Object.entries(EXEMPT)) {
      expect(why.length, k).toBeGreaterThan(20);
    }
  });

  it('가드가 스스로 위반을 잡는지 — 없는 이름은 안 쓰인 것으로 나와야 한다', () => {
    expect(new RegExp('\\.없는칸\\b').test(SOURCE)).toBe(false);
  });
});
