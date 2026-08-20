'use client';

/* 크레딧 RV 사분면 — **미리보기 pane** [OWNER — "백테스트처럼": 주인공(랭킹)
 * 옆에서 hover 를 따라오는 자리, Backtest 의 PreviewPane 문법].
 *
 *   x = Relative RV (σ) — z 3성분 합성(40/40/20). 경계 = 0. 오른쪽 = 평소보다
 *       넓다 = 싸다 (deviation 만 — 원칙 ③).
 *   y = BEP Coverage (σ) — 버퍼 ÷ 3M 실현 변동성. 경계 = 1σ [출발값].
 *
 * **크기는 실측이다**(useMeasure) [OWNER 2026-08-19 — "패널을 꽉 채우는 게
 * 나을 거 같다"]: 고정 viewBox 를 meet 로 끼우면 남는 쪽이 여백이 된다.
 * 컨테이너의 실제 픽셀로 좌표를 계산해 왜곡 없이 채운다(손 차트들의 관용구).
 *
 * **점은 잉크 중립이다** [OWNER 2026-08-19 3차 확정 — "사분면만 중립으로"]:
 * 방향색 점(넓음 적/타이트 청)을 하루 써 보니 옆 모니터의 빨강=주의와 사전이
 * 충돌했다. 방향은 위치(x=0 좌우)와 유망 스크림이 말하고, 점은 잉크.
 * **속빈 마커(헤지 불가)도 은퇴** [OWNER — "헤지수단 명시 빼기": 표기가
 * 사라지면 마커는 설명 불가한 수수께끼가 된다]. shortable 게이트는 서버
 * 계약에 잔존한다.
 *
 * **리드아웃은 커서 옆 작은 패널**(공용 ReadoutCard) [OWNER — svg 이름표는
 * 점들과 겹쳐 안 보였다]. 성분 분해(캐리/롤·z 셋)도 이 카드가 진다 — native
 * title(키보드·터치 불가)의 대체 [OWNER]. 표 행 hover/포커스에도 같은 카드가
 * 그 점 위치에 뜬다.
 *
 * **연동은 양방향** [OWNER] — 표 행 hover → 점 강조(highlightId), 점 hover →
 * 표 행 강조·스크롤(onHover 콜백).
 *
 * 점수를 재계산하지 않는다(§16) — relRv·coverage 는 서버 값, 여기는 좌표 변환뿐.
 */

import { useState } from 'react';

import { HStack, VStack } from '@coinbase/cds-web/layout';
import { TextLabel2, TextLegal } from '@coinbase/cds-web/typography';

import { READOUT_CARD_MAX, ReadoutCard, readoutLeft } from '@/ui/ReadoutCard';
import { useMeasure } from '@/ui/useMeasure';

import type { RvCreditItem } from './api';
import { bp1, sig } from './fmt';

const PAD = { top: 24, right: 16, bottom: 44, left: 48 };

/* 이 표면이 카드 폭 상수(200)를 들고 있었다 — 기본 148 에서 "버퍼 +10.8bp
 * (1.2σ)" 가 삐져나갔기 때문이다(실측 2026-08-19 [OWNER]). 2026-08-20 에
 * 카드가 스스로 `max-content` 로 폭을 잡게 되면서 이 상수가 필요 없어졌다 —
 * 호출부가 자기 최장 줄을 계산하는 일 자체가 함정이었다. 클램프만 상한을
 * 쓴다(`READOUT_CARD_MAX`). */

/** Coverage 의 유망 경계(σ) — 버퍼가 평소 3M 변동 한 단위를 흡수하는 선
 * [트레이더 출발값]. */
export const COVERAGE_LINE = 1;

function nice(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** ReadoutCard 안의 한 줄 — 공용 카드의 줄 문법(라벨 뮤트 · 값 등폭 우측). */
function Row({ k, v }: { k: string; v: string }) {
  return (
    <HStack justifyContent="space-between" gap={1}>
      <TextLegal as="span" color="fgMuted" noWrap>
        {k}
      </TextLegal>
      <TextLabel2 as="span" tabularNumbers noWrap>
        {v}
      </TextLabel2>
    </HStack>
  );
}

export function RvScatter({
  items,
  onSelect,
  highlightId,
  onHover,
}: {
  items: RvCreditItem[];
  onSelect: (p: RvCreditItem) => void;
  /** 랭킹 표에서 hover 중인 항목 — 그 점이 커지고 링이 붙는다. */
  highlightId?: string | null;
  /** 점 hover → 표의 그 행이 따라온다(역방향 연동). */
  onHover?: (p: RvCreditItem | null) => void;
}) {
  const [hover, setHover] = useState<RvCreditItem | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [measureRef, mw, mh] = useMeasure<HTMLDivElement>();
  /* 실측 전 첫 프레임은 0 — 폴백 크기로 그려두면 다음 프레임에 맞는다. */
  const W = mw || 640;
  const H = mh || 400;

  /* 좌표가 있는 항목만 선다 — σ 미확정은 아래 한 줄이 개수로 말한다. */
  const pts = items.filter(
    (p): p is RvCreditItem & { relRv: number; coverage: number } =>
      p.relRv != null && p.coverage != null,
  );
  const unplaced = items.length - pts.length;
  const favorable = pts.filter((p) => p.relRv > 0 && p.coverage >= COVERAGE_LINE).length;

  /* x 는 0 대칭 — 경계가 0 인데 도메인이 쏠리면 "가운데" 가 거짓말이 된다. */
  const xAbs = Math.max(1.5, ...pts.map((p) => Math.abs(p.relRv)));
  const x0 = -xAbs * 1.08;
  const x1 = xAbs * 1.08;
  const yLo = Math.min(0, ...pts.map((p) => p.coverage));
  /* y 도메인은 **3σ 에서 캡** — outlier 둘(10σ급)이 축을 늘리면 이 축의
     질문(1σ 경계 근처의 분해능)이 죽는다(3차 크리틱 실측: 1σ ≈ 30px, 38점이
     110px 에 압축). 초과점은 상단 가장자리에 앉고 리드아웃이 실값을 말한다. */
  const Y_CAP = 3;
  const yHi = Math.max(
    COVERAGE_LINE * 1.5,
    Math.min(Y_CAP, Math.max(...pts.map((p) => p.coverage))),
  );
  const yPad = (yHi - yLo) * 0.08 || 1;
  const y0 = yLo - yPad;
  const y1 = yHi + yPad;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const X = (v: number) => PAD.left + ((v - x0) / (x1 - x0)) * plotW;
  const Y = (v: number) => PAD.top + (1 - (v - y0) / (y1 - y0)) * plotH;

  return (
    /* 카드가 전폭 문법이라 가장자리 인셋은 이 컴포넌트가 진다. */
    <VStack gap={0.5} width="100%" paddingX={2} paddingBottom={1.5} flexGrow={1} minHeight={0}>
      <div
        ref={measureRef}
        className="sr-plot sr-rv-plotfill"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - r.left;
          setHoverX(readoutLeft(x, r.width));
        }}
      >
        <svg
          className="sr-rv-scatter"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`크레딧 RV 사분면 — ${pts.length}개 중 ${favorable}개가 평소보다 넓고 여유 있는 구역이에요`}
        >
          {/* 유망 사분면(오른쪽·위)만 옅은 스크림. */}
          <rect
            x={X(0)}
            y={Y(y1)}
            width={X(x1) - X(0)}
            height={Y(COVERAGE_LINE) - Y(y1)}
            fill="color-mix(in srgb, var(--sr-up) 5%, transparent)"
          />
          {/* 프레임 — 바닥·왼쪽 축선만(차트 카드의 헤어라인 규율). */}
          <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="var(--color-bgLine)" />
          <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--color-bgLine)" />
          {/* 사분면 경계 — x = 0, y = 1σ. */}
          <line x1={X(0)} x2={X(0)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--color-bgLine)" />
          <line x1={PAD.left} x2={W - PAD.right} y1={Y(COVERAGE_LINE)} y2={Y(COVERAGE_LINE)} stroke="var(--color-bgLine)" />

          {/* 사분면 라벨 — 두 축의 말 그대로 서술 [OWNER 2026-08-19 — "싸고
              버팀/비싸지만 방어적" 계열은 어휘가 거칠다고 교체]. x 축이 "평소
              대비" 이탈이고 y 축이 버퍼의 여유이므로, 라벨도 그 두 사실만
              말한다 — 싸다/비싸다 같은 가치 판단 단어를 얹지 않는다. */}
          <text x={W - PAD.right - 6} y={PAD.top + 16} textAnchor="end" className="sr-rv-quad">
            평소보다 넓음 · 여유 있음
          </text>
          <text x={W - PAD.right - 6} y={H - PAD.bottom - 8} textAnchor="end" className="sr-rv-quad">
            평소보다 넓음 · 여유 부족
          </text>
          <text x={PAD.left + 6} y={PAD.top + 16} className="sr-rv-quad">
            평소보다 좁음 · 여유 있음
          </text>
          <text x={PAD.left + 6} y={H - PAD.bottom - 8} className="sr-rv-quad">
            평소보다 좁음 · 여유 부족
          </text>

          {[-Math.round(xAbs * 10) / 10, 0, Math.round(xAbs * 10) / 10].map((v) => (
            <text key={v} x={X(v)} y={H - PAD.bottom + 18} textAnchor="middle" className="sr-rv-tick">
              {v === 0 ? '0' : sig(v)}
            </text>
          ))}
          <text x={PAD.left + plotW / 2} y={H - 6} textAnchor="middle" className="sr-rv-tick">
            상대 RV (σ) — 오른쪽일수록 평소보다 넓어요
          </text>
          {[0, COVERAGE_LINE].map((v) => (
            <text key={v} x={PAD.left - 8} y={Y(v) + 4} textAnchor="end" className="sr-rv-tick">
              {nice(v)}
            </text>
          ))}
          <text x={PAD.left} y={14} className="sr-rv-tick">
            Coverage (σ) — 버퍼 ÷ 3M 변동
          </text>

          {pts.map((p) => {
            const cx = X(p.relRv);
            /* 캡 초과점은 상단 가장자리에 앉는다(중심이 프레임 안에 남게 8px
               여유) — 지우면 "왜 없지"가 되고, 축을 늘리면 화면이 죽는다. */
            const cy = Math.max(PAD.top + 8, Y(Math.min(p.coverage, y1)));
            const on = hover === p || p.seriesId === highlightId;
            return (
              <g key={p.seriesId}>
                {on ? (
                  <circle cx={cx} cy={cy} r={10} fill="none" stroke="var(--color-fg)" strokeWidth={1} opacity={0.4} />
                ) : null}
                <circle
                  data-id={p.seriesId}
                  cx={cx}
                  cy={cy}
                  r={on ? 7 : 5.5}
                  fill="var(--color-fg)"
                  stroke="var(--color-fg)"
                  strokeWidth={1.5}
                  className="sr-rv-dot"
                  aria-hidden
                  onMouseEnter={() => {
                    setHover(p);
                    onHover?.(p);
                  }}
                  onMouseLeave={() => {
                    setHover(null);
                    onHover?.(null);
                  }}
                  onClick={() => onSelect(p)}
                />
              </g>
            );
          })}
        </svg>

        {/* 커서 옆 작은 패널 — Main·Backtest 의 그 카드 [OWNER — svg 이름표는
            점들과 겹쳐 안 보였다]. 표 행 hover/포커스에도 그 점 위치에 뜨고,
            성분 분해(캐리/롤·z 셋)까지 진다 — native title 의 대체 [OWNER]. */}
        {(() => {
          const active = hover ?? pts.find((p) => p.seriesId === highlightId) ?? null;
          if (!active) return null;
          const left = hover
            ? hoverX
            : Math.min(
                Math.max(0, X(active.relRv ?? 0) + 12),
                Math.max(0, W - READOUT_CARD_MAX - 8),
              );
          /* 줄 순서는 랭킹 표의 열 순서(버퍼 → BEP → 상대 RV)를 따르고, z 는
             한 줄에 셋을 욱여넣지 않는다 — 148 카드에서 그 줄이 밖으로
             삐져나가던 원인이었다. */
          return (
            <ReadoutCard
              title={`${active.sectorLabel} ${active.tenor}`}
              left={left}
            >
              <Row k="스프레드" v={`${bp1(active.nowBp)}bp`} />
              <Row
                k="버퍼"
                v={`${sig(active.bufferBp)}bp${active.coverage != null ? ` (${active.coverage.toFixed(1)}σ)` : ''}`}
              />
              <Row k="BEP" v={`${bp1(active.bepSpreadBp)}bp`} />
              <Row k="상대 RV" v={active.relRv != null ? `${sig(active.relRv, 2)}σ` : '—'} />
              <Row k="z 절대" v={active.zAbs != null ? String(active.zAbs) : '—'} />
              <Row k="z 섹터" v={active.zSector != null ? String(active.zSector) : '—'} />
              <Row k="z 커브" v={active.zCurve != null ? String(active.zCurve) : '—'} />
              <Row k="캐리 + 롤" v={`${sig(active.carryBp)} + ${sig(active.rollBp)}bp`} />
            </ReadoutCard>
          );
        })()}
      </div>

      {/* 각주 한 줄 — 마커 열쇠가 없어져(잉크 단일) 안내만 남았다. */}
      <HStack gap={1.5} alignItems="center" flexWrap="wrap">
        <TextLegal as="span" color="fgMuted">
          오른쪽 위가 평소보다 넓고 여유 있는 자리예요 · 누르면 이력이 열려요
        </TextLegal>
        {unplaced > 0 ? (
          <TextLegal as="span" color="fgMuted">
            σ 미확정 {unplaced}개는 좌표가 없어 못 섰어요
          </TextLegal>
        ) : null}
      </HStack>
    </VStack>
  );
}
