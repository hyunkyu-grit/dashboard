'use client';

import { TextCaption, TextLabel2 } from '@coinbase/cds-web/typography';

import type { ForwardsPayload } from '@/lib/api';
import { fmtLevel, levelHeadText, levelHeadTitle } from '@/lib/format';
import { matrixTint } from '@/table/tint';

import { TintLegend } from './TintLegend';

/**
 * 포워드를 **표로** 본다 — 시작 21행 × 만기 8열 [v1 §8].
 *
 * 목록과 같은 데이터이고 다른 질문에 답한다. 목록은 "이 포워드가 얼마인가" 이고,
 * 표는 "**어디가 움직였나**" 다 — 140행을 스크롤해서는 절대 볼 수 없는 것이 색의
 * 모양이다. 그래서 셀의 값은 잉크(수준)이고 셀의 **배경**이 전일 변화다.
 *
 * ── 격자 안에 선을 긋지 않는다 [v1 carry, Pass B] ───────────────────────────
 * 칸끼리 변을 공유해서 하나의 면을 이룬다. 칸 사이에 줄을 그으면 그 면이 다시
 * 흩어진 점들로 쪼개진다 — 구조는 틴트와 고정 헤더, 그리고 왼쪽 두 열이 진다.
 * 유일하게 남는 테두리는 **고시 교차점** 표시인데, 그건 칸 사이의 줄이 아니라
 * 한 칸의 성질이다.
 *
 * ── 왼쪽 두 열은 고정이다 ───────────────────────────────────────────────────
 * 가로로 스크롤해도 행이 무엇인지 잃지 않는다. 고정 셀의 배경은 **불투명**이어야
 * 한다 — 아니면 밑을 지나는 틴트가 비쳐서 고정 열까지 격자처럼 읽힌다(v2 의
 * `ReconStack` 이 같은 자리에서 같은 규칙을 진다).
 *
 * ── CDS `Table` 이 아닌 이유 ────────────────────────────────────────────────
 * CDS `TableCell` 은 좌우로 16px 씩, 셀마다 32px 을 먹는다(이 리포 실측
 * 2026-08-14). 열이 열 개인 숫자 격자에서 그건 320px 의 순수 여백이고, 그러면
 * 창 하나에 표가 안 들어간다. `ReconStack` 도 같은 이유로 손으로 짠 `<table>`
 * 이다 — 이 리포에 이미 있는 선례를 따른다.
 */
export function ForwardMatrix({ payload }: { payload: ForwardsPayload }) {
  return (
    <div className="sr-matrix-wrap">
      <table className="sr-matrix">
        <thead>
          <tr>
            {/* 투명도는 **라벨 span 에** 준다. 고정 셀 자체에 주면 그 셀의 불투명
                배경까지 같이 가라앉아서 밑의 행이 비친다. */}
            <th className="sr-matrix-stick sr-matrix-start">
              <TextCaption as="span" color="fgMuted">
                시작
              </TextCaption>
            </th>
            <th className="sr-matrix-stick sr-matrix-date">
              <TextCaption as="span" color="fgMuted">
                날짜
              </TextCaption>
            </th>
            {payload.tenors.map((t) => (
              <th key={t} className="sr-matrix-th">
                {t.replace('F', '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payload.startPoints.map((sp, i) => (
            <tr key={sp.label}>
              {/* ON 행은 격자의 기준점이지만 그건 **현물 커브**다 — 오버나이트
                  시작은 곧 오늘이다. 포워드인 척하지 않고 이름을 그렇게 적는다
                  (목록에서는 아예 빠지는 행이고, 여기서는 기준으로 남는다). */}
              <td className="sr-matrix-stick sr-matrix-start">
                {sp.label === 'ON' ? '현물' : sp.label}
              </td>
              <td className="sr-matrix-stick sr-matrix-date">
                <TextCaption as="span" color="fgMuted">
                  {sp.date}
                </TextCaption>
              </td>
              {payload.tenors.map((tenor) => {
                const cell = payload.grid[tenor]?.[i];
                if (!cell) return <td key={tenor} className="sr-matrix-td" />;
                return (
                  <td
                    key={tenor}
                    /* 자기 과거 대비 등급 틴트(§J) — 그날 격자의 최대가 아니라
                       이 칸 자신의 과거와 비교한다. `table/tint.ts` 참조. */
                    style={matrixTint(cell.movePct, cell.deltas.d1 > 0)}
                    className={`sr-matrix-td${cell.live ? ' sr-matrix-live' : ''}`}
                    title={`${sp.label}x${tenor.replace('F', '')}`}
                  >
                    {fmtLevel(cell.values.now, '%')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sr-matrix-foot">
        <TintLegend />
        <TextCaption as="span" color="fgMuted">
          테두리가 있는 칸은 양쪽 다리가 고시 만기인 교차점이에요 · 수준은{' '}
          <span title={levelHeadTitle(payload.asof)}>{levelHeadText(payload.asof)}</span> 종가
        </TextCaption>
      </div>
    </div>
  );
}

/**
 * 주요 포워드 여섯 — 실제로 호가되는 것들.
 *
 * 여기서 보여주는 것은 **수준과 그 수준의 자리**다: 52주 최저↔최고 트랙 위에
 * 지금이 어디인지, 그리고 그 안에서 평균이 어디인지. v1 이 이 블록에서 기저별
 * 수준 열들을 걷어낸 이유가 기록돼 있다 — 그 열들이 본 표의 **변화** 열과 같은
 * 머리글(MTD·YTD)을 달고 다른 양(수준)을 보여주고 있었다.
 */
export function KeyForwardBlock({ payload }: { payload: ForwardsPayload }) {
  return (
    <table className="sr-keyfwd">
      <thead>
        <tr>
          <th className="sr-keyfwd-name">
            <TextLabel2 as="span">주요 포워드</TextLabel2>
          </th>
          <th className="sr-keyfwd-now">
            <TextCaption as="span" color="fgMuted" title={levelHeadTitle(payload.asof)}>
              {levelHeadText(payload.asof)}
            </TextCaption>
          </th>
          {/* 트랙의 양 끝은 **한 번만** 이름을 얻는다 — 행마다 적으면 여섯 번
              같은 말을 하게 되고, 그 반복이 트랙 자체를 안 보이게 만든다. */}
          <th className="sr-keyfwd-track">
            <span className="sr-keyfwd-ends">
              <TextCaption as="span" color="fgMuted">
                52주 최저
              </TextCaption>
              <TextCaption as="span" color="fgMuted">
                52주 최고
              </TextCaption>
            </span>
          </th>
          <th className="sr-keyfwd-pct">
            <TextCaption as="span" color="fgMuted">
              백분위
            </TextCaption>
          </th>
        </tr>
      </thead>
      <tbody>
        {payload.keyForwards.map((kf) => {
          const { min, max, avg, pct } = kf.range1y;
          const now = kf.values.now;
          const hasGauge = min != null && max != null && pct != null && max > min;
          const frac = hasGauge ? Math.min(1, Math.max(0, (now - min) / (max - min))) : 0;
          const avgFrac =
            hasGauge && avg != null ? Math.min(1, Math.max(0, (avg - min) / (max - min))) : null;
          const extreme = hasGauge && isExtreme(pct);
          return (
            <tr key={kf.label}>
              <td className="sr-keyfwd-name">{kf.label}</td>
              <td className="sr-keyfwd-now">{fmtLevel(now, '%')}</td>
              <td className="sr-keyfwd-track">
                {hasGauge ? (
                  <GaugeTrack frac={frac} avgFrac={avgFrac} extreme={extreme} />
                ) : (
                  <TextCaption as="span" color="fgMuted">
                    —
                  </TextCaption>
                )}
              </td>
              <td className={`sr-keyfwd-pct${extreme ? ' sr-keyfwd-extreme' : ''}`}>
                {hasGauge ? Math.round(pct) : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** 자기 52주 범위의 양 끝 근처면 "극단" 이다. 표시가 꽉 찬 잉크가 되므로
 * 99분위 행이 72분위 행과 구별된다. */
const GAUGE_EXTREME_PCT = 90;

function isExtreme(pct: number): boolean {
  return pct >= GAUGE_EXTREME_PCT || pct <= 100 - GAUGE_EXTREME_PCT;
}

/** 52주 최저→최고 트랙, 지금까지의 채움, 그 위의 표시, 그리고 **평균 눈금** 하나.
 * 고저만으로는 범위가 얼마나 넓은지밖에 모른다 — 평균이 있어야 지금이 그 안에서
 * 어디인지 읽힌다.
 *
 * 극단인지 아닌지는 **밝기**로 구분한다(색상이 아니라) — 방향색은 이 트랙의
 * 뜻이 아니고, 여기에 빨강/파랑을 쓰면 상승·하락을 말하는 것처럼 보인다. */
function GaugeTrack({
  frac,
  avgFrac,
  extreme,
}: {
  frac: number;
  avgFrac: number | null;
  extreme: boolean;
}) {
  const pos = `${(frac * 100).toFixed(1)}%`;
  return (
    <div className="sr-gauge">
      <div className="sr-gauge-fill" style={{ width: pos }} />
      {avgFrac != null ? (
        <div className="sr-gauge-avg" style={{ left: `${(avgFrac * 100).toFixed(1)}%` }} />
      ) : null}
      <div
        className={`sr-gauge-dot${extreme ? ' sr-gauge-extreme' : ''}`}
        style={{ left: pos }}
      />
    </div>
  );
}
