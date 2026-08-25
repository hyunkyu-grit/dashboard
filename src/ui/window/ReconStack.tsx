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
  /** 잔차 = 평가 − 추정(합계) [OWNER, 2026-08-25 — 감사록 F4]. 서버가 행마다
   * 보내던 값인데 화면에 자리가 없어, 추정과 평가가 어긋나는 이유를 표가
   * 말하지 못했다. 숫자가 하나라도 있으면 열이 서고, 표 밑 각주가 뜻을
   * 말한다. 가로합 항등식(평가+캐리+롤다운(+조달)=그날 손익)에는 안 든다. */
  residual?: number | null;
  carry: number | null;
  rolldown: number | null;
  /** 조달 — 현금채권 대사에만 있다 [OWNER, 2026-08-14]. 필드가 하나라도 있으면
   * 조달 열이 서고, 없으면 IRS 모양 그대로다. 서버가
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

/** 꼬리 열의 트랙 폭. 여기를 바꾸면 아래 sticky right 계단과 표 전체 폭 계산을
 * **같이** 옮겨야 하는데, 셋 다 이 상수를 곱하므로 상수만 바꾸면 같이 움직인다.
 *
 * 11 → 15 [OWNER 2026-08-25 겹침 금지]: 11 은 한글 헤더("그날 손익")가 안
 * 접히는 폭이었지 **숫자의 폭이 아니었다**. 이 표의 돈은 원 단위 그대로다
 * (만/억 접기 금지 — 모듈 머리) — 수십억 북이면 `+12,345,678,901` 이 14글리프,
 * 부호까지 15 다. 쉼표 숫자엔 줄바꿈 기회가 없어 11ch 트랙을 그대로 넘어
 * 왼쪽 이웃 위로 새어 나갔다. */
const TAIL_CH = 15;
const DATE_CH = 7;
const KIND_CH = 5;

/** 13px 헤더의 `ch` ≠ 14px 본문의 `ch`. 헤더가 본문 트랙과 같은 자리를 가리키려면
 * 환산해서 넘긴다 — `ch` 는 **그 요소 자신의** 폰트에서 '0' 의 진행폭이다. */
const headCh = (n: number) => `calc(${n}ch * 14 / 13)`;

export interface ReconStackGroup {
  label: string;
  cols: { key: string; label: string }[];
}

export function ReconStack({
  days,
  tenors,
  groups,
  note,
  defaultOrder = 'asc',
  maxHeight = '30vh',
}: {
  /** 언제나 **오름차순**으로 준다 — 보이는 순서는 이 컴포넌트의 상태(날짜 헤더
   * 토글)이지 호출자의 배열이 아니다. */
  days: ReconStackDay[];
  tenors: string[];
  /** 격자를 **두 덩어리로 가른다** [OWNER, 2026-08-21 — 혼합 북].
   *
   * 스왑 KRD 는 IRS 제로커브 노드, 채권 KRD 는 민평 노드에 실린 감도다. 같은
   * "3Y" 라는 이름을 쓰지만 다른 위험이라 한 칸에 더할 수 없고, 그래서 열쇠에
   * 접두사가 붙어 온다(`S:3Y`·`B:3Y`) — 화면에 적히는 것은 `label`(테너)뿐이고
   * 어느 커브인지는 그룹 머리가 말한다. 없으면 격자가 하나다(한 종류뿐인 북),
   * 그때 `tenors` 가 곧 열쇠이자 라벨이다. */
  groups?: ReconStackGroup[];
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

  /* 열은 **열쇠와 라벨이 다를 수 있다.** 격자가 하나면 둘이 같고(테너 문자열),
     둘로 갈리면 열쇠에 접두사가 붙는다. 아래는 전부 이 목록으로만 돈다 —
     `tenors` 를 직접 훑는 자리가 남으면 접두사가 화면에 새어 나온다. */
  const cols: { key: string; label: string }[] = groups?.length
    ? groups.flatMap((g) => g.cols)
    : tenors.map((t) => ({ key: t, label: t }));
  /* 머리를 **세우는** 조건과 열쇠를 **읽는** 조건은 다르다. 그룹이 하나뿐이면
     가를 것이 없어 머리는 안 서지만, 열쇠는 여전히 `groups` 것이다(`tenors` 를
     라벨로 쓰면 접두사가 화면에 새어 나온다). */
  const banded = groups && groups.length > 1 ? groups : null;
  /* 그룹 경계에 서는 열쇠 — 헤어라인 하나로 "여기서부터 다른 커브" 를 말한다.
     첫 그룹의 첫 열은 빠진다(왼쪽 범례의 경계가 이미 거기 있다). */
  const sepKeys = new Set(
    banded ? banded.slice(1).map((g) => g.cols[0]?.key).filter(Boolean) : [],
  );

  /* 오른쪽 범례의 하루 칸들(rowSpan=3). 조달 열은 **말할 것이 있을 때만** 선다.
     판정이 «필드가 있나» 가 아니라 «숫자가 하나라도 있나» 인 이유 [2026-08-21]:
     백테스트는 조달이 없는 북에서 필드를 아예 안 싣지만, 시뮬레이션은 응답이
     고정 모델을 지나므로 스왑만 있는 북에도 `funding: null` 이 전 행에 실린다.
     «필드 존재» 로 재면 그 표에 250줄짜리 «—» 조달 칸이 선다 — 스왑에는 조달이라는
     질문 자체가 없는데. 숫자로 재면 두 화면이 한 규칙으로 옳다. */
  const hasFunding = days.some((d) => typeof d.funding === 'number');
  /* 잔차 열도 같은 규칙 [OWNER, 2026-08-25 — 감사록 F4]: 숫자가 하나라도
     있을 때만 선다. 자리는 평가 바로 뒤 — 읽는 순서가 «합계(추정) → 평가 →
     그 차(잔차)» 라서다. 뜻은 표 밑 각주가 말한다. */
  const hasResidual = days.some((d) => typeof d.residual === 'number');
  const summaryCols: { label: string; get: (d: ReconStackDay) => number | null }[] = [
    { label: '평가', get: (d) => d.valuation },
    ...(hasResidual
      ? [{ label: '잔차', get: (d: ReconStackDay) => d.residual ?? null }]
      : []),
    { label: '캐리', get: (d) => d.carry },
    { label: '롤다운', get: (d) => d.rolldown },
    ...(hasFunding
      ? [{ label: '조달', get: (d: ReconStackDay) => d.funding ?? null }]
      : []),
    { label: '그날 손익', get: (d) => d.actual },
  ];
  const tailCols = summaryCols.length + 1; // 맨 앞의 합계 열

  const tenorW = tenorWidth(
    cols.map((c) => c.label),
    days.flatMap((d) =>
      METRICS.flatMap((m) => cols.map((c) => cellText(m, d[m][c.key] ?? null))),
    ),
  );

  /* 히트맵 농도의 기준은 **표 전체**의 max|KRD| — 날마다 다시 잡으면 작은 날의 작은
     값이 큰 날의 큰 값과 같은 진하기가 된다. */
  const krdScale = Math.max(
    ...days.flatMap((d) => cols.map((c) => Math.abs(d.krd[c.key] ?? 0))),
    0,
  );

  const rowTotal = (d: ReconStackDay, m: Metric): number | null => {
    // KRD 의 합계는 **두 커브가 다 1bp 움직였을 때**의 원/bp 다. 열을 섞는 것과
    // 다른 셈이다(칸 하나가 두 위험을 뜻하는 게 아니라, 북 전체의 평행이동이다).
    if (m === 'krd') return cols.reduce((s, c) => s + (d.krd[c.key] ?? 0), 0);
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
            width: `calc(${DATE_CH}ch + ${KIND_CH}ch + ${cols.length} * (${tenorW}) + ${tailCols} * ${TAIL_CH}ch)`,
          }}
        >
          <colgroup>
            <col style={{ width: `${DATE_CH}ch` }} />
            <col style={{ width: `${KIND_CH}ch` }} />
            {cols.map((c) => (
              <col key={c.key} style={{ width: tenorW }} />
            ))}
            {Array.from({ length: tailCols }, (_, i) => (
              <col key={i} style={{ width: `${TAIL_CH}ch` }} />
            ))}
          </colgroup>
          <thead>
            {/* 격자를 가르는 머리 — 혼합 북에서만 [OWNER, 2026-08-21].
                꼬리 칸을 빈 `th` 로 **그대로 한 벌 더** 세우는 이유: 오른쪽
                범례는 `right` 오프셋 사다리로 고정되는데, `colSpan` 하나로
                덮으면 그 사다리가 이 줄에서만 끊겨 가로 스크롤 중 밑이 샌다
                (이 표의 첫 규율 — 트랙과 오프셋이 자로 맞아야 한다). */}
            {banded ? (
              <tr className="sr-recon-grouprow">
                <th className="sr-recon-th sr-recon-pin" style={{ left: 0 }} />
                <th
                  className="sr-recon-th sr-recon-pin sr-recon-edge-l"
                  style={{ left: headCh(DATE_CH) }}
                />
                {banded.map((g, gi) => (
                  <th
                    key={g.label}
                    colSpan={g.cols.length}
                    className={`sr-recon-th${gi > 0 ? ' sr-recon-groupsep' : ''}`}
                  >
                    {/* 라벨은 **가로 스크롤을 따라 붙는다.** 가운데 정렬이던 첫
                        판은 열다섯 칸의 중앙에 서서 화면 밖에 있었다(실측
                        2026-08-21: DOM 에는 있는데 눈에는 없다). 왼쪽 고정
                        열(날짜+구분)의 바로 오른쪽에 붙어, 그 격자가 보이는
                        동안 이름도 같이 보인다 — 이 표의 «범례는 사방 고정»
                        규율과 같은 이유다. */}
                    <span
                      className="sr-recon-grouplabel"
                      style={{ left: headCh(DATE_CH + KIND_CH) }}
                    >
                      {g.label}
                    </span>
                  </th>
                ))}
                {[
                  ['합계', summaryCols.length] as [string, number],
                  ...summaryCols.map(
                    (c, i) => [c.label, summaryCols.length - 1 - i] as [string, number],
                  ),
                ].map(([label, step]) => (
                  <th
                    key={`grp-${label}`}
                    className={`sr-recon-th sr-recon-right sr-recon-pin${
                      step === summaryCols.length ? ' sr-recon-edge-r' : ''
                    }`}
                    style={{ right: step === 0 ? 0 : headCh(step * TAIL_CH) }}
                  />
                ))}
              </tr>
            ) : null}
            <tr className={banded ? 'sr-recon-hasgroups' : undefined}>
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
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`sr-recon-th sr-recon-center${
                    sepKeys.has(c.key) ? ' sr-recon-groupsep' : ''
                  }`}
                >
                  {c.label}
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
                    {cols.map((c) => {
                      const v = d[m][c.key] ?? null;
                      return (
                        <td
                          key={c.key}
                          className={`sr-recon-td sr-recon-center${
                            sepKeys.has(c.key) ? ' sr-recon-groupsep' : ''
                          }`}
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
      {hasResidual ? (
        <p className="sr-recon-note">
          잔차 = 평가 − 추정(합계) — 전일 감도의 선형 추정이 못 담는 몫이에요(감도의 하루
          감쇠 × 서 있는 충격, 볼록성, 리픽싱). 가로 합계(평가+캐리+롤다운
          {hasFunding ? '+조달' : ''})에는 안 들어가요.
        </p>
      ) : null}
      {note ? <p className="sr-recon-note">{note}</p> : null}
    </div>
  );
}
