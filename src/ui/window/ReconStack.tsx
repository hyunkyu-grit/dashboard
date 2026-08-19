'use client';

/* 일별 대사 스택 [v1 OWNER, 2026-08-11 — "탭 1개에 KRD·Bp변화·PnL변화를 몰아야
 * … 1일차 KRD, BP변화, PnL를 각각 가로줄로 구성해서 쌓아서 80일치면 240개의
 * 가로줄"].
 *
 * 하루가 가로줄 **셋**이다: KRD(전일 종가 = 그날 아침의 테너별 감도 — 추정이 곱한
 * 바로 그 값 [v1 OWNER, 2026-08-11 — "전일걸 가져와서 붙이는게 대사하기 편하지
 * 않을까"]) · Δbp(테너별 금리 변화) · 손익(KRD × Δbp 선형 추정). 세 줄이 같은 블록
 * 안에서 곱셈으로 닫히므로 눈이 전일 블록으로 오갈 일이 없다. 마지막 블록은 이월
 * 앵커다 — 마지막 날의 종가 KRD(다음 영업일로 들고 가는 리스크)만 있고 Δbp·손익은
 * null(—) 이다.
 *
 * 렌즈 토글(한 번에 한 지표)은 v1 에서 은퇴했다: 트레이딩 시스템 화면과 나란히 놓고
 * 줄 단위로 맞춰 보는 것이 이 표의 목적인데, 시스템 쪽은 세 값이 같이 보이고 이쪽은
 * 하나씩만 보였다. 80영업일 240줄이 요구사항 그 자체다.
 *
 * **백테스트 창과 시뮬레이션 창이 같은 컴포넌트를 쓴다** — `WindowDrawer` 의 전례
 * ("껍데기가 두 벌이면 '둘 다에 존재한다' 가 곧 거짓"). 트레이더 피드백 5 가 요구한
 * 것이 정확히 "둘 다에" 였다.
 *
 * ── 표 규율 ────────────────────────────────────────────────────────────────
 *  - **원 단위 그대로** [v1 OWNER, 2026-08-10] — 자릿수가 곧 판단이다. 24,141 이
 *    "2만원" 이면 시스템의 24,141 과 맞는지 말할 수 없다. 이 화면만 억/만을 안 접는다.
 *  - **전 테너 열이 그대로 선다** [v1 OWNER, 2026-08-12]. KRD 가 전 기간 0 인 열을
 *    숨기던 구 규율은 은퇴했다 — 0 인 열은 — 로 선다. 리스크가 없다는 사실도 대사의
 *    일부다.
 *  - 넘치는 폭은 **보이는 스크롤바**가 받는다 [v1 OWNER, 같은 날 2차]. 이 컴포넌트가
 *    양축 스크롤 컨테이너(높이 캡)라서 가로 바가 표 바닥이 아니라 눈앞의 컨테이너
 *    바닥에 선다. 드래그 팬은 v1 이 같은 날 만들었다 걷어냈다.
 *  - **범례는 사방 고정** [v1 OWNER, 같은 날 2차 — "좌우의 범례 … 열과 행 고정"]:
 *    테너 헤더는 위, 날짜·구분은 왼쪽, 합계~그날 손익은 오른쪽. 격자 가운데만 흐른다.
 *  - 열 폭은 세 지표의 최장 문자열로 잰다(`ch`) — 줄마다 폭이 다르면 격자가 세로로
 *    안 읽힌다.
 *  - KRD 줄은 히트맵(배경=부호, 농도=크기, 글자는 잉크), Δbp·손익 줄은 방향색 글자 —
 *    `theme/tint.ts` 의 "한 셀 한 채널".
 *  - Δbp 는 소수 둘째 자리(하루 0.17bp 가 정수 반올림에 지워진다).
 *
 * ── 왜 CDS `Table` 이 아닌가 ───────────────────────────────────────────────
 * DESIGN §5.4 의 예외 조항 그대로다: **CDS 에 대응물이 없다.** 이 표가 서려면
 * `<colgroup>` 으로 트랙을 못박아야 하고(아래 폭 주석), 셀마다 sticky 오프셋이
 * 필요하고, 날짜·요약 칸이 `rowSpan=3` 이어야 한다. 셋 다 `Table` 이 노출하지 않는
 * 개념이다. 게다가 `TableCell` 은 좌우 16px 씩 32px 을 먹어서(§5.6) `ch` 로 적은
 * 오프셋과 실제 트랙이 어긋난다.
 */

import { useState } from 'react';

import { directionVar, tintFor } from '@/theme/tint';

export interface ReconStackDay {
  /** ISO 날짜 — 행 키이자 화면의 MM-DD */
  date: string;
  /** 툴팁. 연도와 (시뮬) D+n 을 진다. */
  title?: string;
  krd: Record<string, number>;
  dbp: Record<string, number | null>;
  est: Record<string, number>;
  /** 이월 앵커 블록에서 null — 아직 오지 않은 날이다. */
  estTotal: number | null;
  valuation: number | null;
  carry: number | null;
  rolldown: number | null;
  /** 조달 — 현금채권 대사에만 있다 [OWNER, 2026-08-14]. 필드가 하나라도 있으면
   * 조달 열이 서고(꼬리 여섯), 없으면 IRS 모양 그대로다(꼬리 다섯). 서버가
   * 이미 음수로 준다 — 여기서 부호를 다시 주지 않는다. */
  funding?: number | null;
  actual: number | null;
}

type Metric = 'krd' | 'dbp' | 'est';
const METRICS: Metric[] = ['krd', 'dbp', 'est'];
const METRIC_LABEL: Record<Metric, string> = { krd: 'KRD', dbp: 'Δbp', est: '손익' };

/** 원 단위 그대로, 부호 포함. 만/억 접기 금지 — 모듈 주석의 첫 규율이다. */
function Won({ v }: { v: number | null | undefined }) {
  if (typeof v !== 'number') return <span className="sr-recon-blank">—</span>;
  return (
    <span style={{ color: directionVar(v) }}>
      {`${v > 0 ? '+' : ''}${Math.round(v).toLocaleString('en-US')}`}
    </span>
  );
}

function cellText(metric: Metric, v: number | null): string {
  if (v === null || v === 0) return '—';
  return metric === 'dbp' ? v.toFixed(2) : Math.round(v).toLocaleString('en-US');
}

/** 최장 문자열 글자 수 + 좌우 여백. */
function tenorWidth(labels: string[], cells: string[]): string {
  const longest = Math.max(...labels.map((s) => s.length), ...cells.map((s) => s.length), 4);
  return `calc(${longest}ch + 8px)`;
}

/** 꼬리 열의 트랙 폭. 한글 헤더("그날 손익")가 안 접히는 폭이다. 여기를 바꾸면
 * 아래 sticky right 계단과 표 전체 폭 계산을 **같이** 옮겨야 한다 — 셋이 어긋나면
 * 고정 열 사이로 밑이 샌다. */
const TAIL_CH = 11;
const DATE_CH = 7;
const KIND_CH = 5;

/** 13px 헤더의 `ch` ≠ 14px 본문의 `ch`. 헤더가 본문 트랙과 같은 자리를 가리키려면
 * 환산해서 넘긴다 — `ch` 는 **그 요소 자신의** 폰트에서 '0' 의 진행폭이다. */
const headCh = (n: number) => `calc(${n}ch * 14 / 13)`;

export function ReconStack({
  days,
  tenors,
  note,
  defaultOrder = 'asc',
  maxHeight = '30vh',
}: {
  /** 언제나 **오름차순**으로 준다 — 보이는 순서는 이 컴포넌트의 상태(날짜 헤더
   * 토글)이지 호출자의 배열이 아니다. */
  days: ReconStackDay[];
  tenors: string[];
  /** 표 아래 한 줄 — 잘린 창 같은 데이터 사실. */
  note?: string;
  /** 첫 표시 방향 [v1 OWNER, 2026-08-11 — "날짜는 오름차순 내림차순 선택할 수
   * 있게"]. 기본값이 표면마다 다른 이유는 데이터의 성격이다: 백테스트는 실제
   * 이력이라 최신이 위(대사는 보통 어제·오늘부터), 시뮬레이션은 미래 경로라
   * 시간순(D+0 이 위). 토글은 그 기본을 읽는 사람이 뒤집게 할 뿐이다. */
  defaultOrder?: 'asc' | 'desc';
  /** 스크롤 컨테이너의 세로 캡. 이 컴포넌트가 자기 안에서 세로로 스크롤해야 헤더
   * 고정이 성립하고 가로 바가 눈앞에 선다. **서랍 캡(38vh) 보다 작아야 한다** —
   * 바깥 서랍이 스크롤하기 시작하면 고정이 도로 깨진다(스크롤러는 하나여야 한다). */
  maxHeight?: string;
}) {
  const [order, setOrder] = useState<'asc' | 'desc'>(defaultOrder);

  if (days.length === 0) {
    return <p className="sr-recon-empty">이 실행에는 일별 대사가 없어요.</p>;
  }
  const shown = order === 'asc' ? days : [...days].reverse();

  /* 오른쪽 범례의 하루 칸들(rowSpan=3). 조달 열은 현금채권 대사에서만 선다 —
     `funding` 필드의 존재가 곧 판정이고, IRS 대사는 필드 자체가 없다. */
  const hasFunding = days.some((d) => d.funding !== undefined);
  const summaryCols: { label: string; get: (d: ReconStackDay) => number | null }[] = [
    { label: '평가', get: (d) => d.valuation },
    { label: '캐리', get: (d) => d.carry },
    { label: '롤다운', get: (d) => d.rolldown },
    ...(hasFunding
      ? [{ label: '조달', get: (d: ReconStackDay) => d.funding ?? null }]
      : []),
    { label: '그날 손익', get: (d) => d.actual },
  ];
  const tailCols = summaryCols.length + 1; // 맨 앞의 합계 열

  const tenorW = tenorWidth(
    tenors,
    days.flatMap((d) => METRICS.flatMap((m) => tenors.map((t) => cellText(m, d[m][t] ?? null)))),
  );

  /* 히트맵 농도의 기준은 **표 전체**의 max|KRD| — 날마다 다시 잡으면 작은 날의 작은
     값이 큰 날의 큰 값과 같은 진하기가 된다. */
  const krdScale = Math.max(...days.flatMap((d) => tenors.map((t) => Math.abs(d.krd[t] ?? 0))), 0);

  const rowTotal = (d: ReconStackDay, m: Metric): number | null => {
    if (m === 'krd') return tenors.reduce((s, t) => s + (d.krd[t] ?? 0), 0);
    if (m === 'est') return d.estTotal;
    return null; // Δbp 의 테너 합은 아무 뜻이 없다
  };

  return (
    /* 스크롤 사슬이 여기서 끊기면 안 된다 — 이 바깥 `div` 가 블록이면 서랍이
       눌려도 아래 스크롤러가 안 줄고 서랍 밖으로 삐져나간다(실측 2026-08-14:
       서랍 219px 안에서 스택이 273px). 그래서 여기도 열 flex 다. */
    <div className="sr-recon-root">
      <div className="sr-recon-scroll" style={{ maxHeight }}>
        {/* 폭은 `width:100%` + minWidth 가 아니라 **정확한 명시 폭**이다: `table-fixed`
            는 표 폭과 `<col>` 합이 다르면 차이를 트랙에 재분배하고, 그러면 `ch` 로 적은
            sticky 오프셋과 실제 트랙 경계가 어긋나 고정 열 사이로 밑 내용이 샌다.
            폭 == 트랙 합이면 재분배가 0 이라 오프셋이 자로 맞는다. */}
        <table
          className="sr-recon"
          style={{
            width: `calc(${DATE_CH}ch + ${KIND_CH}ch + ${tenors.length} * (${tenorW}) + ${tailCols} * ${TAIL_CH}ch)`,
          }}
        >
          <colgroup>
            <col style={{ width: `${DATE_CH}ch` }} />
            <col style={{ width: `${KIND_CH}ch` }} />
            {tenors.map((t) => (
              <col key={t} style={{ width: tenorW }} />
            ))}
            {Array.from({ length: tailCols }, (_, i) => (
              <col key={i} style={{ width: `${TAIL_CH}ch` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {/* 날짜 헤더가 곧 정렬 토글이다. 정렬 대상이 날짜 하나뿐이라 화살표는
                  항상 보인다: 지금 방향이 상태이고, 누르면 뒤집힌다. */}
              <th className="sr-recon-th sr-recon-pin" style={{ left: 0 }}>
                <button
                  type="button"
                  className="sr-recon-sort"
                  onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}
                  title={
                    order === 'asc'
                      ? '오래된 날짜부터 — 누르면 최신부터'
                      : '최신 날짜부터 — 누르면 오래된 것부터'
                  }
                >
                  날짜{order === 'asc' ? ' ↑' : ' ↓'}
                </button>
              </th>
              {/* 왼쪽 범례의 **안쪽 경계** — 이 밑으로 격자가 지나간다는 표식
                  (`sr-recon-edge-l`, type.css 의 근거). */}
              <th
                className="sr-recon-th sr-recon-pin sr-recon-edge-l"
                style={{ left: headCh(DATE_CH) }}
              >
                구분
              </th>
              {tenors.map((t) => (
                <th key={t} className="sr-recon-th sr-recon-center">
                  {t}
                </th>
              ))}
              {/* 오른쪽 범례 — 뒤에서부터 11ch 트랙씩 쌓인다. 조달 열이 서면
                  여섯, 아니면 다섯이다. */}
              {[
                ['합계', summaryCols.length] as [string, number],
                ...summaryCols.map(
                  (c, i) => [c.label, summaryCols.length - 1 - i] as [string, number],
                ),
              ].map(([label, step]) => (
                <th
                  key={label}
                  className={`sr-recon-th sr-recon-right sr-recon-pin${
                    // 오른쪽 범례의 안쪽 경계 = 가장 왼쪽 칸(합계).
                    step === summaryCols.length ? ' sr-recon-edge-r' : ''
                  }`}
                  style={{ right: step === 0 ? 0 : headCh(step * TAIL_CH) }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((d) =>
              METRICS.map((m, mi) => {
                const total = rowTotal(d, m);
                return (
                  <tr
                    key={`${d.date}-${m}`}
                    // 하루의 경계만 헤어라인 — 세 줄이 한 덩어리로 읽힌다.
                    className={mi === 0 ? 'sr-recon-daytop' : undefined}
                  >
                    {/* 왼쪽 범례 — 먼 테너를 보는 중에도 어느 날의 어느 줄인지가
                        남는다. 불투명 배경이 필수다: 밑을 지나는 히트맵 틴트가
                        비치면 안 된다. 구분 칸의 13px 는 **안쪽 span** 에 있다 —
                        `td` 가 13px 이면 left 의 `ch` 가 트랙과 다른 자로 풀린다. */}
                    {mi === 0 && (
                      <td
                        className="sr-recon-td sr-recon-stick sr-recon-top"
                        style={{ left: 0 }}
                        rowSpan={3}
                        title={d.title ?? d.date}
                      >
                        {d.date.slice(5)}
                      </td>
                    )}
                    <td
                      className="sr-recon-td sr-recon-stick sr-recon-edge-l"
                      style={{ left: `${DATE_CH}ch` }}
                    >
                      <span className="sr-recon-kind">{METRIC_LABEL[m]}</span>
                    </td>
                    {tenors.map((t) => {
                      const v = d[m][t] ?? null;
                      return (
                        <td
                          key={t}
                          className="sr-recon-td sr-recon-center"
                          style={
                            m === 'krd'
                              ? { background: tintFor(v ?? 0, krdScale) }
                              : v === null || v === 0
                                ? undefined
                                : { color: directionVar(v) }
                          }
                        >
                          {v === null || v === 0 ? (
                            <span className="sr-recon-blank">—</span>
                          ) : (
                            cellText(m, v)
                          )}
                        </td>
                      );
                    })}
                    {/* 오른쪽 범례. ⚠ 오프셋을 진 셀에 굵기를 얹으면 안 된다 —
                        `ch` 는 그 요소 폰트의 '0' 진행폭이고 미디엄의 0 이 살짝
                        넓어 44ch 가 13px 어긋난다(v1 실측). 굵기는 안쪽 span 이 진다. */}
                    <td
                      className="sr-recon-td sr-recon-stick sr-recon-right sr-recon-edge-r"
                      style={{ right: `${summaryCols.length * TAIL_CH}ch` }}
                    >
                      <span className="sr-recon-strong">
                        {total === null ? (
                          <span className="sr-recon-blank">—</span>
                        ) : m === 'krd' ? (
                          Math.round(total).toLocaleString('en-US')
                        ) : (
                          <Won v={total} />
                        )}
                      </span>
                    </td>
                    {mi === 0 &&
                      summaryCols.map((c, ci) => {
                        const step = summaryCols.length - 1 - ci;
                        const v = c.get(d);
                        return (
                          <td
                            key={c.label}
                            className="sr-recon-td sr-recon-stick sr-recon-right sr-recon-top"
                            style={{ right: step === 0 ? 0 : `${step * TAIL_CH}ch` }}
                            rowSpan={3}
                          >
                            {step === 0 ? (
                              <span className="sr-recon-strong">
                                <Won v={v} />
                              </span>
                            ) : (
                              <Won v={v} />
                            )}
                          </td>
                        );
                      })}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      {note ? <p className="sr-recon-note">{note}</p> : null}
    </div>
  );
}
