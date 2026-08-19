'use client';

/* 동일섹터 레인 (레인 A) — 만기 × Δy 격자, 칸 = H 보유 총수익 bp.
 *
 * **결정 숫자는 격자가 아니라 스왑점 목록이다** — 1bp 격자는 껍질 멤버를
 * 건너뛴다(rv1 실측: KDB 10Y 의 승리 구간 +5.2~+5.7bp 는 정수 bp 를 하나도 안
 * 품는다). 격자는 지형을 읽는 밀도이고, "어느 Δy 에서 갈아타나"는 아래 스왑점
 * 줄이 말한다.
 *
 * "껍질"(전 Δy 상단 볼록껍질)과 "창 안 승자"(±50bp 안에서 실제로 이김)는
 * **다른 집합이다**(PN-2) — 표는 두 사실을 딴 칸으로 적는다.
 *
 * CDS `Table` 금지(셀당 32px 함정) — ReconStack 선례의 손 표. 틴트는
 * `theme/tint.ts` 하나다(채도=크기·색상=부호·글자는 잉크).
 */

import { HStack, VStack } from '@coinbase/cds-web/layout';
import { TextCaption, TextLabel2, TextLegal } from '@coinbase/cds-web/typography';

import { tintFor } from '@/theme/tint';

import type { RvSector } from './api';

export function SectorLane({
  sector,
  dys,
  hMonths,
}: {
  sector: RvSector;
  dys: number[];
  hMonths: number;
}) {
  const scale = Math.max(
    ...sector.candidates.flatMap((c) => c.tr.map((v) => Math.abs(v))),
    0,
  );

  return (
    <VStack gap={0.75} width="100%">
      <div className="sr-rv-scroll">
        <table className="sr-rv-table">
          <thead>
            <tr>
              <th className="sr-rv-th sr-rv-left">만기</th>
              {dys.map((dy) => (
                <th key={dy} className="sr-rv-th">
                  {dy > 0 ? `+${dy}` : dy}
                </th>
              ))}
              <th className="sr-rv-th">버퍼</th>
              {/* "승리 구간" → "1등 구간" [OWNER 2026-08-19 — 어휘 순화 컨펌]. */}
              <th className="sr-rv-th">1등 구간</th>
            </tr>
          </thead>
          <tbody>
            {sector.candidates.map((c) => (
              <tr key={c.tenor}>
                {/* ◆ 껍질(볼록껍질 소속) 마커는 은퇴했다 [OWNER 2026-08-19 —
                    쉬운 문장으로 고쳐 써도 "없애도 될 듯"]. 그 기하 사실은
                    화면의 어떤 결정도 바꾸지 않았고, 창 안 1등은 격자 테두리
                    띠와 1등 구간 열이 이미 말한다. 서버 계약의 `inHull` 은
                    잔존한다(api.ts) — 표시만 내려갔다. */}
                <td className="sr-rv-td sr-rv-left">{c.tenor}</td>
                {/* 1등 구간은 **격자 위에 테두리 띠**로도 선다 [OWNER — "테이블
                    자체적으로 시각적으로 표현"]: winFrom..winTo 에 드는 칸이
                    띠가 되고, 오른쪽 숫자 열은 정확한 경계를 말한다. */}
                {c.tr.map((v, i) => {
                  const dy = dys[i];
                  const win =
                    c.winFrom != null && c.winTo != null && dy >= c.winFrom && dy <= c.winTo;
                  const cls = [
                    'sr-rv-td',
                    win ? 'sr-rv-win' : '',
                    win && (i === 0 || dys[i - 1] < (c.winFrom as number)) ? 'sr-rv-win-start' : '',
                    win && (i === dys.length - 1 || dys[i + 1] > (c.winTo as number))
                      ? 'sr-rv-win-end'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <td key={dy} className={cls} style={{ background: tintFor(v, scale) }}>
                      {v.toFixed(0)}
                    </td>
                  );
                })}
                <td className="sr-rv-td">
                  {c.maturityHold ? '만기 보유' : c.bepBp != null ? c.bepBp.toFixed(0) : '—'}
                </td>
                <td className="sr-rv-td">
                  {c.winFrom != null && c.winTo != null
                    ? `${c.winFrom > 0 ? '+' : ''}${c.winFrom}..${c.winTo > 0 ? '+' : ''}${c.winTo}`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 표 밖 줄들은 카드 가장자리 인셋(16px)을 여기서 진다 — 표가 전폭이
          된 카드 문법(Main)의 몫. */}
      <VStack gap={0.75} paddingX={2} paddingBottom={1.5}>
        {/* 결정 숫자 — 교체점 목록("스왑점"에서 순화 [OWNER 2026-08-19]).
            Δy 가 이 값을 지나면 1등이 바뀐다. */}
        <HStack gap={1.5} alignItems="baseline" flexWrap="wrap">
          <TextLabel2 as="span">교체점</TextLabel2>
          {sector.swapPoints.length === 0 ? (
            <TextCaption as="span" color="fgMuted">
              창(±50bp) 안에 없어요
            </TextCaption>
          ) : (
            sector.swapPoints.map((p) => (
              <TextLegal key={`${p.from}-${p.to}`} as="span" tabularNumbers noWrap>
                {p.from}→{p.to} {p.dyBp > 0 ? '+' : ''}
                {p.dyBp.toFixed(1)}bp
              </TextLegal>
            ))
          )}
        </HStack>
        <TextLegal as="span" color="fgMuted">
          칸은 금리가 그만큼 움직였을 때 {hMonths}개월 들고 있으면 얻는 수익(bp)이에요.
          테두리 친 칸이 그 만기가 1등인 구간이고, 교체점을 지나면 1등이 바뀌어요.
        </TextLegal>
      </VStack>
    </VStack>
  );
}
