'use client';

/* 크레딧 RV 사분면 — **미리보기 pane** [OWNER — "백테스트처럼": 주인공(랭킹)
 * 옆에서 hover 를 따라오는 자리, Backtest 의 PreviewPane 문법].
 *
 *   x = 월환산 총수익 (bp/월) — (캐리 + 롤 + 재투자) ÷ H. **듀레이션으로 안
 *       나눈다** = "한 달에 몇 bp 버나". 경계 = 오늘 후보 중앙값.
 *   y = 지난주 스프레드의 창 백분위 (%) — 직전 5영업일 평균을 52주/전체 분포에서
 *       midrank 로. 경계 = 50.
 *
 * **두 축은 2026-08-20 에 갈렸다** [OWNER — 트레이더 피드백 "BEP·상대 RV 가
 * 무슨 말인지 잘 모르겠다"]. 전임자는 x=Relative RV(σ) · y=BEP Coverage(σ) 로
 * 둘 다 σ 였고, 읽는 사람이 두 σ 의 뜻을 외워야 했다. 새 두 축은 각자 자기
 * 단위로 말한다 — bp/월과 백분위.
 *
 * x 경계가 0 이 아니라 **중앙값**인 이유: 조달 차감 후에도 후보 대부분이 양수라
 * (앵커 실측 6.8~11.5bp/월) 0 을 그으면 전부 오른쪽에 몰려 사분면이 죽는다.
 * y 의 경계가 "자기 이력의 중앙"이므로 x 도 "오늘 후보들의 중앙"으로 짝을
 * 맞췄고, 축 라벨이 그 사실을 쓴다.
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
 * 점수를 재계산하지 않는다(§16) — trMonthBp·pctLastWeek 는 서버 값, 여기는
 * 좌표 변환과 **중앙값 하나**뿐이다(경계선을 그으려면 필요하고, 서버가 주는
 * 값들의 순서 통계라 새 사실을 만들지 않는다).
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

/** y 축(지난주 스프레드 백분위)의 사분면 경계 — 자기 이력의 중앙. */
export const PCT_LINE = 50;

/** 순서 통계 하나 — x 경계선. 짝수 개면 두 가운데의 평균. */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((p, q) => p - q);
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
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

  /* 좌표가 있는 항목만 선다 — 백분위 미확정은 아래 한 줄이 개수로 말한다.
     (x 는 항상 있다 — 버퍼가 정의되는 후보만 서버가 항목으로 싣는다.) */
  const pts = items.filter(
    (p): p is RvCreditItem & { pctLastWeek: number } => p.pctLastWeek != null,
  );
  const unplaced = items.length - pts.length;

  /* x 경계 = 오늘 후보 중앙값(파일 머리의 근거). y 경계 = 50. */
  const xMid = median(pts.map((p) => p.trMonthBp));
  const favorable = pts.filter(
    (p) => p.trMonthBp >= xMid && p.pctLastWeek >= PCT_LINE,
  ).length;

  /* x 도메인은 실측 범위 + 8% — 대칭으로 잡을 이유가 없다(0 이 경계가 아니다).
     한 점뿐이면 폭이 0 이 되므로 최소 폭을 준다. */
  const xLo = Math.min(...pts.map((p) => p.trMonthBp), xMid);
  const xHi = Math.max(...pts.map((p) => p.trMonthBp), xMid);
  const xPad = (xHi - xLo) * 0.08 || 1;
  const x0 = xLo - xPad;
  const x1 = xHi + xPad;
  /* y 는 **0~100 고정** — 백분위는 정의상 그 안이고, 실측 범위로 늘였다 줄이면
     "50 이 가운데" 라는 이 축의 유일한 읽기가 날마다 움직인다. 옛 축(σ)이
     3σ 캡을 둬야 했던 이유가 도메인이 열려 있었기 때문인데, 여기서는 애초에
     닫혀 있어 캡이 필요 없다. */
  const y0 = -4;
  const y1 = 104;

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
          aria-label={`크레딧 RV 사분면 — ${pts.length}개 중 ${favorable}개가 중앙값보다 많이 벌고 평소보다 넓은 구역이에요`}
        >
          {/* 유망 사분면(오른쪽·위)만 옅은 스크림. */}
          <rect
            x={X(xMid)}
            y={Y(y1)}
            width={X(x1) - X(xMid)}
            height={Y(PCT_LINE) - Y(y1)}
            fill="color-mix(in srgb, var(--sr-up) 5%, transparent)"
          />
          {/* 프레임 — 바닥·왼쪽 축선만(차트 카드의 헤어라인 규율). */}
          <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="var(--color-bgLine)" />
          <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--color-bgLine)" />
          {/* 사분면 경계 — x = 후보 중앙값, y = 50%. */}
          <line x1={X(xMid)} x2={X(xMid)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--color-bgLine)" />
          <line x1={PAD.left} x2={W - PAD.right} y1={Y(PCT_LINE)} y2={Y(PCT_LINE)} stroke="var(--color-bgLine)" />

          {/* 사분면 라벨 — 두 축의 말 그대로 서술 [OWNER 2026-08-19 — "싸고
              버팀/비싸지만 방어적" 계열은 어휘가 거칠다고 교체]. 가치 판단
              단어를 얹지 않는 그 규율은 그대로이고, 두 축이 바뀐 만큼 문구도
              바뀌었다 — x 는 버는 돈, y 는 평소 대비 스프레드 폭이다. */}
          <text x={W - PAD.right - 6} y={PAD.top + 16} textAnchor="end" className="sr-rv-quad">
            많이 벌고 · 평소보다 넓음
          </text>
          <text x={W - PAD.right - 6} y={H - PAD.bottom - 8} textAnchor="end" className="sr-rv-quad">
            많이 벌지만 · 평소보다 좁음
          </text>
          <text x={PAD.left + 6} y={PAD.top + 16} className="sr-rv-quad">
            덜 벌고 · 평소보다 넓음
          </text>
          <text x={PAD.left + 6} y={H - PAD.bottom - 8} className="sr-rv-quad">
            덜 벌고 · 평소보다 좁음
          </text>

          {[xLo, xMid, xHi].map((v, i) => (
            <text
              key={i}
              x={X(v)}
              y={H - PAD.bottom + 18}
              textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
              className="sr-rv-tick"
            >
              {v.toFixed(1)}
            </text>
          ))}
          <text x={PAD.left + plotW / 2} y={H - 6} textAnchor="middle" className="sr-rv-tick">
            한 달에 버는 돈 (bp) — 가운데 선이 후보 중앙값이에요
          </text>
          {[0, PCT_LINE, 100].map((v) => (
            <text key={v} x={PAD.left - 8} y={Y(v) + 4} textAnchor="end" className="sr-rv-tick">
              {v}
            </text>
          ))}
          <text x={PAD.left} y={14} className="sr-rv-tick">
            지난주 스프레드 백분위 (%) — 위쪽이 평소보다 넓어요
          </text>

          {pts.map((p) => {
            const cx = X(p.trMonthBp);
            /* y 도메인이 0~100 으로 닫혀 있어 캡·클램프가 필요 없다 — 백분위는
               정의상 그 안에 있다(옛 σ 축이 3σ 캡을 둬야 했던 자리). */
            const cy = Y(p.pctLastWeek);
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
                Math.max(0, X(active.trMonthBp) + 12),
                Math.max(0, W - READOUT_CARD_MAX - 8),
              );
          /* 줄 순서는 랭킹 표의 열 순서(월수익 → 백분위 → 버퍼 → 상대 RV)를
             따르고, z 는 한 줄에 셋을 욱여넣지 않는다 — 148 카드에서 그 줄이
             밖으로 삐져나가던 원인이었다. **두 축이 맨 위**다: 점의 위치를
             설명하는 두 숫자가 카드의 첫 두 줄이어야 한다. */
          return (
            <ReadoutCard
              title={`${active.sectorLabel} ${active.tenor}`}
              left={left}
            >
              <Row k="한 달 수익" v={`${sig(active.trMonthBp)}bp`} />
              <Row
                k="지난주 백분위"
                v={
                  active.pctLastWeek != null
                    ? `${active.pctLastWeek.toFixed(0)}%${
                        active.lastWeekBp != null ? ` (${bp1(active.lastWeekBp)}bp)` : ''
                      }`
                    : '—'
                }
              />
              <Row k={`${active.baseLabel} 대비`} v={`${bp1(active.nowBp)}bp`} />
              <Row k="버퍼" v={`${sig(active.bufferBp)}bp`} />
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
          오른쪽 위가 많이 벌면서 평소보다 넓은 자리예요 · 누르면 이력이 열려요
        </TextLegal>
        {unplaced > 0 ? (
          <TextLegal as="span" color="fgMuted">
            백분위 미확정 {unplaced}개는 좌표가 없어 못 섰어요
          </TextLegal>
        ) : null}
      </HStack>
    </VStack>
  );
}
