'use client';

import { Box, VStack } from '@coinbase/cds-web/layout';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@coinbase/cds-web/tables';
import { Text, TextCaption } from '@coinbase/cds-web/typography';

import type { ForwardsPayload } from '@/lib/api';
import { fmtDelta, fmtLevel, levelHeadText, levelHeadTitle } from '@/lib/format';
import { rangePosition } from '@/lib/range';
import { rangeText } from '@/table/cells';
import { BASIS_LABEL } from '@/table/InstrumentTable';
import { HEADER_H, ROW_H } from '@/table/rowHeight';
import { directionClass, directionGlyph, matrixTint, tintStyle, unsignedDelta } from '@/table/tint';

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
 * 여기서 보여주는 것은 **수준과 그 수준의 자리**다: 52주 최저↔최고 위에 지금이
 * 어디인지. v1 이 이 블록에서 기저별 수준 열들을 걷어낸 이유가 기록돼 있다 —
 * 그 열들이 본 표의 **변화** 열과 같은 머리글(MTD·YTD)을 달고 다른 양(수준)을
 * 보여주고 있었다. 이제 그 자리에는 진짜 변화 열이 선다.
 *
 * ── 손으로 짠 표를 접었다 [감사 2026-08-25] ─────────────────────────────────
 * 이 블록은 위의 격자와 달리 **좁은 표**(여섯 행·여덟 열)라 `ForwardMatrix` 의
 * 면제 사유(셀당 32px × 열 열 개)가 적용되지 않는다. 그런데도 손으로 짠
 * `<table class="sr-keyfwd">` 였고, 그래서 Main 목록과 다르게 늙어 있었다:
 * 행 높이가 26(캐논 60)이고, 변화 열이 아예 없고, 52주 자리는 이 블록에만
 * 있는 `.sr-gauge` 로 그려졌다. 셋 다 캐논에 이미 있는 부품이다. 지금은
 * CDS `Table` + `ROW_H` + `.sr-name-stack` + 틴트 네 부품 + `.sr-track` 으로
 * 서고, 이 파일이 새로 정의하는 것은 **없다**.
 *
 * 캐논에서 벗어나는 곳 하나: 변화는 **1D 만** 세운다. MTD·YTD 까지 세우면
 * 서랍 폭(창 1080)에서 열이 밀린다 — 「말줄임 절대 금지」가 폭 문제를 글자
 * 자르기로 풀지 말라고 하므로, 자르는 대신 열을 고른다.
 */
export function KeyForwardBlock({ payload }: { payload: ForwardsPayload }) {
  return (
    <Table
      variant="ruled"
      bordered
      /* 여섯 행이 전부라 스크롤 컨테이너가 필요 없다 — 머리 40 + 6×60. */
      height={HEADER_H + ROW_H * payload.keyForwards.length}
      accessibilityLabel="주요 포워드"
    >
      {/* 타이포는 `Text font="…"` — 이 블록은 새 코드라 CDS 가 폐기한 shorthand
          (`TextCaption` 등)를 쓰지 않는다(`guards/typography-ratchet`). 위의 격자는
          그 래칫이 세는 기존 사용이라 건드리지 않는다. */}
      <TableHeader sticky>
        <TableRow style={{ height: HEADER_H }}>
          <TableCell as="th" scope="col">
            <Text as="span" font="caption" color="fgMuted">주요 포워드</Text>
          </TableCell>
          <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
            <Text as="span" font="caption" color="fgMuted" title={levelHeadTitle(payload.asof)}>
              {levelHeadText(payload.asof)}
            </Text>
          </TableCell>
          <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
            <Text as="span" font="caption" color="fgMuted">{BASIS_LABEL.d1}</Text>
          </TableCell>
          <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
            <Text as="span" font="caption" color="fgMuted">52주 저점</Text>
          </TableCell>
          <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
            <Text as="span" font="caption" color="fgMuted">고점</Text>
          </TableCell>
          <TableCell as="th" scope="col" className="sr-num">
            <Text as="span" font="caption" color="fgMuted">위치</Text>
          </TableCell>
          <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
            <Text as="span" font="caption" color="fgMuted">백분위</Text>
          </TableCell>
        </TableRow>
      </TableHeader>

      <TableBody>
        {payload.keyForwards.map((kf) => {
          const { min, max, avg, pct } = kf.range1y;
          const now = kf.values.now;
          const d1 = kf.deltas.d1;
          /* 자리는 `lib/range.ts` 가 낸다 — Main 목록의 트랙과 **같은 함수**다.
             둘이 각자 계산하던 시절에 하나가 순위 백분위로 새어 나갔다
             (2026-08-20 수리). */
          const posPct = rangePosition(now, min, max);
          const extreme = pct != null && isExtreme(pct);
          return (
            <TableRow
              key={kf.label}
              style={{ height: ROW_H }}
              /* 「자기 52주 범위의 끝에 와 있다」는 **행의 사실**이다 — 백분위 칸의
                 잉크가 그것을 말하고, 이 속성은 그 사실을 가드가 잴 수 있게 남긴다
                 (`data-sr-row`·`data-sr-divider` 와 같은 용법). */
              data-sr-extreme={extreme ? 'true' : undefined}
            >
              {/* 이름 칸은 두 줄 스택 — 둘째 줄은 목록과 **같은 문장**이다
                  (`table/cells.ts::subText` 의 「1년 평균 …」). 평균이 여기 있으니
                  트랙은 자리 하나만 말하면 된다. */}
              <TableCell>
                <VStack as="span" className="sr-name-stack">
                  <Text as="span" font="label1" noWrap>{kf.label}</Text>
                  <Text as="span" font="legal" color="fgMuted" noWrap>
                    1년 평균 {rangeText(avg, '%')}%
                  </Text>
                </VStack>
              </TableCell>
              <TableCell className="sr-num" justifyContent="flex-end">
                <Text as="span" font="label2" tabularNumbers noWrap>{fmtLevel(now, '%')}</Text>
              </TableCell>
              {/* 변화 셀 = 캐논 네 부품 한 벌(배경 틴트·방향 클래스·↗↘·무부호). */}
              <TableCell className="sr-num" justifyContent="flex-end" style={tintStyle(d1)}>
                <Text as="span" font="label2" tabularNumbers noWrap className={directionClass(d1)}>
                  {directionGlyph(d1)}
                  {directionGlyph(d1) ? ' ' : ''}
                  {unsignedDelta(fmtDelta(d1, '%'))}
                </Text>
              </TableCell>
              <TableCell className="sr-num" justifyContent="flex-end">
                <Text as="span" font="label2" tabularNumbers noWrap>{rangeText(min, '%')}</Text>
              </TableCell>
              <TableCell className="sr-num" justifyContent="flex-end">
                <Text as="span" font="label2" tabularNumbers noWrap>{rangeText(max, '%')}</Text>
              </TableCell>
              <TableCell className="sr-num">
                {posPct == null ? (
                  <Text as="span" font="label2" color="fgMuted" noWrap>—</Text>
                ) : (
                  /* `.sr-track` 은 폭 없는 블록이라(Main 에선 `.sr-range` 격자가
                     폭을 준다) 여기서는 고정폭 상자가 트랙 길이를 진다 — 없으면
                     2px 짜리 점으로 접힌다(2026-08-25 실측). */
                  <Box as="span" width={96} display="block">
                    <span
                      className="sr-track"
                      title={`52주 최저↔최고의 ${Math.round(posPct)}% 지점`}
                      /* `.sr-track` 은 뒤쪽 여백 12px 을 달고 있다 — Main 의
                         `.sr-range` 격자에서 다음 칸(세타)과 벌리려는 것이다.
                         여기서는 트랙이 칸의 마지막이라 그 여백이 오른쪽 끝을
                         12px 밀어 머리글 「위치」와 어긋난다(실측 2026-08-25).
                         이 칸에서만 0 으로 둔다. */
                      style={{ marginInlineEnd: 0 }}
                    >
                      <span className="sr-track-mark" style={{ left: `${posPct}%` }} />
                    </span>
                  </Box>
                )}
              </TableCell>
              {/* 극단은 **밝기**로 말한다(색상이 아니라) — 방향색은 이 열의 뜻이
                  아니고, 여기 빨강/파랑을 쓰면 상승·하락을 말하는 것처럼 보인다. */}
              <TableCell className="sr-num" justifyContent="flex-end">
                <Text
                  as="span"
                  font="label2"
                  tabularNumbers
                  noWrap
                  color={extreme ? 'fg' : 'fgMuted'}
                >
                  {pct == null ? '—' : Math.round(pct)}
                </Text>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** 자기 52주 범위의 양 끝 근처면 "극단" 이다. 백분위가 꽉 찬 잉크가 되므로
 * 99분위 행이 72분위 행과 구별된다. */
const GAUGE_EXTREME_PCT = 90;

function isExtreme(pct: number): boolean {
  return pct >= GAUGE_EXTREME_PCT || pct <= 100 - GAUGE_EXTREME_PCT;
}
