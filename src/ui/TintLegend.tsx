'use client';

import { TextCaption } from '@coinbase/cds-web/typography';

import {
  MATRIX_FLOOR,
  MATRIX_FULL,
  MATRIX_PCT_HI,
  MATRIX_PCT_LO,
} from '@/table/tint';

/**
 * 틴트가 무슨 뜻인지 말하는 한 줄.
 *
 * 매트릭스는 168칸이 전부 칠해질 수 있는 면이고, 그 색이 **수준이 아니라
 * 움직임**이라는 것, 그리고 강도가 **그 칸 자기 과거와 비교한 드묾**이라는 것을
 * 아무것도 말해주지 않았다. 진한 칸을 보고 "금리가 높다" 로 읽으면 정반대의
 * 결론에 닿는다.
 *
 * 견본의 알파는 **진짜 눈금의 양 끝**(`MATRIX_FLOOR`..`MATRIX_FULL`)이라 범례가
 * 칸과 어긋날 수 없다. 색상은 토큰이라 스킴이 바뀌면 범례도 같이 바뀐다.
 *
 * 작고 조용하다 — 이건 기능이 아니라 **열쇠**다.
 */

/** 강 → 약. 칸이 쓰는 등급 그대로. */
const STEPS = [MATRIX_FULL, (MATRIX_FLOOR + MATRIX_FULL) / 2, MATRIX_FLOOR];

function swatch(alpha: number, up: boolean): React.CSSProperties {
  const hue = up ? 'var(--sr-up)' : 'var(--sr-down)';
  return {
    backgroundColor: `color-mix(in srgb, ${hue} ${(alpha * 100).toFixed(0)}%, transparent)`,
  };
}

export function TintLegend() {
  return (
    <div className="sr-tintlegend">
      <div className="sr-tintlegend-row">
        <TextCaption as="span" color="fgMuted">
          하락
        </TextCaption>
        <div className="sr-tintlegend-strip">
          {STEPS.map((a, i) => (
            <span key={`d${i}`} className="sr-tintlegend-sw" style={swatch(a, false)} />
          ))}
          {/* 칠하지 않은 가운데 — 작은 움직임은 **색이 없다**. 이 칸이 없으면
              범례가 "약한 색 = 약한 움직임" 이라고 말하게 되는데, 실제 규칙은
              「백분위 {MATRIX_PCT_LO} 아래는 아예 안 칠한다」다. */}
          <span className="sr-tintlegend-sw sr-tintlegend-none" />
          {[...STEPS].reverse().map((a, i) => (
            <span key={`u${i}`} className="sr-tintlegend-sw" style={swatch(a, true)} />
          ))}
        </div>
        <TextCaption as="span" color="fgMuted">
          상승
        </TextCaption>
      </div>
      <TextCaption as="span" color="fgMuted">
        칸이 진할수록 그 포워드의 과거 일간 변동 대비 오늘 움직임이 드물어요
        (백분위 {MATRIX_PCT_LO} 부터 칠하고 {MATRIX_PCT_HI} 에서 가장 진해요).
      </TextCaption>
    </div>
  );
}
