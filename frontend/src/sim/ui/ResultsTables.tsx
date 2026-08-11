"use client";

/**
 * 결과 화면의 표 네 개 [OWNER, 2026-08-06].
 *
 *   포지션별 기여 · 테너별 KRD · 일별 손익 · 정산 현금흐름
 *
 * 넷 다 이미 응답에 있는 값을 읽기만 한다 — 여기서 계산하는 것은 정렬과
 * 합계뿐이고, 합계도 "표가 전체를 설명하는가"를 눈으로 확인시키려고 둔다.
 *
 * 긴 표는 **스크롤 컨테이너 안에서** 스크롤한다. 페이지가 스크롤하지 않는
 * 셸이므로, 377행짜리 표를 그대로 흘리면 셸 밖으로 나간다.
 */

import { useMemo, useState } from "react";

import { formatKrwAxisSigned, formatPercent } from "@/sim/lib/format";
import { directionVar, tintFor } from "@/sim/theme/tint";
import { ReconStack, type ReconStackDay } from "@/ui/ReconStack";
import { Section, Segmented } from "@/sim/ui/primitives";
import type { DecompositionDailyPoint, SimulateResponse } from "@/sim/api/simulate-dto";

/** 표 머리. sticky라 스크롤해도 열 이름이 남는다 — 남지 않으면 스무 행쯤
 * 내려간 뒤로는 어느 열이 무엇인지 알 수 없다. 배경은 **불투명**이어야 한다:
 * 반투명이면 밑을 지나가는 행이 비쳐 글자가 겹친다. */
function Th({
  children,
  right,
  center,
}: {
  children: React.ReactNode;
  right?: boolean;
  center?: boolean;
}) {
  return (
    <th
      className={`sticky top-0 z-10 bg-tile py-2 text-callout font-normal text-ink-2 ${
        center ? "text-center" : right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Money({ v }: { v: number | null | undefined }) {
  if (typeof v !== "number") return <span className="text-ink-3">—</span>;
  return <span style={{ color: directionVar(v) }}>{formatKrwAxisSigned(v)}</span>;
}

/** 대사 표 전용 — **원 단위 그대로** [OWNER, 2026-08-10].
 *
 * format.ts 의 만/억 접기는 "억/만 아래 자릿수는 이 화면의 어떤 판단도 바꾸지
 * 않는다"는 전제 위에 서 있는데, 대사 표는 그 전제의 예외다: 외부 시스템의
 * 숫자와 **자릿수까지** 맞춰 보는 표라 원 단위가 곧 판단이다. 24,141원이
 * "2만"으로 접히면 시스템의 24,141과 맞는지 다른지 말할 수 없다. */
function MoneyWon({ v }: { v: number | null | undefined }) {
  if (typeof v !== "number") return <span className="text-ink-3">—</span>;
  return (
    <span style={{ color: directionVar(v) }}>
      {`${v > 0 ? "+" : ""}${Math.round(v).toLocaleString("en-US")}`}
    </span>
  );
}

// ── 1. 포지션별 기여 ────────────────────────────────────────────────────────

type ContribSort = "total" | "mtm" | "carry";

export function ContributionTable({ run }: { run: SimulateResponse }) {
  const rows = run.swapContributions ?? [];
  const [sort, setSort] = useState<ContribSort>("total");
  const [side, setSide] = useState<"top" | "bottom">("top");

  const shown = useMemo(() => {
    const sorted = [...rows].sort((a, b) => b[sort] - a[sort]);
    // 상위/하위 각 12행. 377행을 다 보여주는 것은 "누가 끌었나"라는 질문에
    // 답하는 게 아니라 질문을 사용자에게 되돌려주는 것이다.
    return side === "top" ? sorted.slice(0, 12) : sorted.slice(-12).reverse();
  }, [rows, sort, side]);

  if (rows.length === 0) {
    return (
      <Section title="포지션별 기여">
        <p className="pb-4 text-body text-ink-2">
          이 실행에는 포지션별 기여가 없어요. 스왑이 제외된 실행이거나 예전 결과예요.
        </p>
      </Section>
    );
  }

  const shownSum = shown.reduce((s, r) => s + r.total, 0);
  const allSum = rows.reduce((s, r) => s + r.total, 0);

  return (
    <Section
      title="포지션별 기여"
      aside={
        <div className="flex items-center gap-2">
          <Segmented
            label="정렬 기준"
            value={sort}
            onChange={setSort}
            options={[
              { value: "total", label: "합계" },
              { value: "mtm", label: "평가" },
              { value: "carry", label: "캐리" },
            ]}
          />
          <Segmented
            label="상위 하위"
            value={side}
            onChange={setSide}
            options={[
              { value: "top", label: "상위" },
              { value: "bottom", label: "하위" },
            ]}
          />
        </div>
      }
    >
      <p className="pb-2 text-body text-ink-2">
        어느 스왑이 손익을 끌었는지 보여줘요. {rows.length.toLocaleString()}건 중{" "}
        {shown.length}건이고, 이 {shown.length}건이 전체 {formatKrwAxisSigned(allSum)} 가운데{" "}
        {formatKrwAxisSigned(shownSum)}을 설명해요.
      </p>
      <div className="max-h-[360px] overflow-y-auto">
        <table className="w-full text-body">
          <thead>
            <tr>
              <Th>종목</Th>
              <Th>방향</Th>
              <Th right>명목</Th>
              <Th right>고정금리</Th>
              <Th right>평가</Th>
              <Th right>캐리</Th>
              <Th right>합계</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.positionId} className="border-t border-edge">
                <td className="max-w-0 truncate py-1.5 pr-3" title={r.positionName}>
                  {r.positionName}
                </td>
                <td className="py-1.5 pr-3 text-ink-2">
                  {/* +1 = 고정 수취. 부호를 숫자로 두면 매번 관례를 떠올려야 한다. */}
                  {r.direction > 0 ? "고정 수취" : "고정 지급"}
                </td>
                <td className="py-1.5 pl-3 text-right text-ink-2">
                  {(r.notional / 1e8).toLocaleString(undefined, { maximumFractionDigits: 0 })}억
                </td>
                <td className="py-1.5 pl-3 text-right text-ink-2">{r.fixedRate.toFixed(3)}%</td>
                <td className="py-1.5 pl-3 text-right"><Money v={r.mtm} /></td>
                <td className="py-1.5 pl-3 text-right"><Money v={r.carry} /></td>
                <td className="py-1.5 pl-3 text-right"><Money v={r.total} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── 2. 테너별 KRD ───────────────────────────────────────────────────────────

/* KRD 표의 칸 폭.
 *
 * 테너 칸은 전부 같은 폭이다 [OWNER, 2026-08-07]. 그 폭을 상수로 박지 않는
 * 이유: 가장 긴 값에 맞춘 고정 폭(`-5,718,914` → 84px)이면 테너 16개가
 * 1,500px 를 먹어서 창 밖으로 나간다 — 값이 작은 실행에서도 늘 스크롤이다.
 * 그래서 **이번 표에 실제로 있는 가장 긴 숫자**가 폭을 정한다. 여전히 전부
 * 같은 폭이고, 필요한 만큼만 넓다.
 *
 * 폭의 단위는 `ch` 다 [2026-08-07 — 사다리 손질]. 처음에는 "자릿수 × 7.3px"
 * 로 계산했는데 그 7.3 이 애초에 틀렸고(Pretendard 13px 의 실측은 7.99),
 * 본문이 14px 로 올라가면서 8.60 이 되어 더 틀어졌다. 자폭을 코드에 적어 두면
 * 글꼴이나 사다리가 움직일 때마다 조용히 어긋난다 — 칸이 좁아진 것은 화면에서
 * 숫자가 옆 칸으로 새는 것으로만 드러난다.
 *
 * `ch` 는 정의상 "0" 의 진행폭이고 tabular-nums 에서 모든 숫자가 그 폭이다.
 * 즉 글꼴이 무엇이든, 크기가 몇이든 자릿수가 곧 폭이 된다. 이 리포가 표의
 * 트랙에 이미 쓰고 있는 단위이기도 하다(ui/columns.ts).
 *
 * 함정 하나는 그대로 안고 간다: `ch` 는 **그 요소 자신의 font-size** 로
 * 풀린다. 여기서는 `<col>` 이 표에서 크기를 물려받으므로 셀과 같은 값이지만,
 * 이 표에 크기 유틸리티를 하나 얹는 순간 트랙과 내용이 갈린다. */
const SECTOR_W = "6ch";
const TOTAL_W = "8ch";

/** 가장 긴 문자열의 글자 수 + 좌우 여백(pl-2 = 8px). 최소 4자 — 라벨(`1.5Y`)이
 * 숫자보다 길 수 있고, 그보다 좁아지면 헤더가 접힌다. */
function tenorWidth(labels: string[], cells: string[]): string {
  const longest = Math.max(...labels.map((s) => s.length), ...cells.map((s) => s.length), 4);
  return `calc(${longest}ch + 8px)`;
}

export function KrdGrid({ run }: { run: SimulateResponse }) {
  const rows = run.pvbpSensitivity ?? [];
  if (rows.length === 0) return null;

  // 테너 열은 첫 행에서 가져온다 — 모든 행이 같은 테너 집합을 갖는다.
  const tenors = Object.keys(rows[0].tenors).filter((t) => t !== "합계");
  // 틴트 농도의 기준은 **표 전체의 최댓값**이다. 행마다 다시 잡으면 작은
  // 섹터의 작은 값이 큰 섹터의 큰 값과 같은 진하기로 칠해져, 표를 가로질러
  // 비교할 수 없게 된다.
  const scale = Math.max(
    ...rows.flatMap((r) => tenors.map((t) => Math.abs(r.tenors[t] ?? 0))),
    0,
  );

  // 셀 글자를 먼저 만든다 — 폭을 재는 것도, 그리는 것도 같은 문자열이어야
  // 폭과 내용이 어긋나지 않는다.
  const text = (v: number) => (v === 0 ? "—" : Math.round(v).toLocaleString());
  const tenorW = tenorWidth(
    tenors,
    rows.flatMap((r) => tenors.map((t) => text(r.tenors[t] ?? 0))),
  );

  return (
    <Section title="테너별 금리 민감도" bare>
      <p className="pb-2 text-body text-ink-2">
        금리가 1bp 움직일 때 각 테너에서 얼마가 움직이는지예요. 빨강은 오르면 버는
        쪽, 파랑은 오르면 잃는 쪽이에요.
      </p>
      <div className="overflow-x-auto">
        {/* 테너 칸은 **전부 같은 폭**이다 [OWNER, 2026-08-07].
            자동 폭이면 칸마다 자릿수만큼 넓어져서, 값이 큰 테너가 넓은 칸을
            갖는다 — 틴트가 배경을 칠하는 표에서는 그 폭 차이가 곧 두 번째
            인코딩처럼 읽힌다. 실제로는 폭이 아니라 색과 숫자가 크기를 말한다.
            같은 폭이면 눈이 격자를 따라 가로세로로 곧장 훑을 수 있다.
            그래서 `table-fixed` + colgroup 이다. 폭이 내용에서 오지 않으므로
            표 전체의 최소 폭도 여기서 정해진다 — 자리가 모자라면 줄바꿈이
            아니라 가로 스크롤이다(숫자는 접히면 안 된다). */}
        <table
          className="w-full table-fixed text-body"
          style={{
            minWidth: `calc(${SECTOR_W} + ${tenors.length} * (${tenorW}) + ${TOTAL_W})`,
          }}
        >
          <colgroup>
            <col style={{ width: SECTOR_W }} />
            {tenors.map((t) => (
              <col key={t} style={{ width: tenorW }} />
            ))}
            <col style={{ width: TOTAL_W }} />
          </colgroup>
          <thead>
            <tr>
              <Th>섹터</Th>
              {tenors.map((t) => (
                <Th key={t} right>{t}</Th>
              ))}
              <Th right>합계</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sector} className="border-t border-edge">
                <td className="py-1.5 pr-3 text-ink-2">{r.sector}</td>
                {tenors.map((t) => {
                  const v = r.tenors[t] ?? 0;
                  return (
                    <td
                      key={t}
                      className="py-1.5 pl-2 text-right"
                      // 틴트 셀의 글자는 잉크다 — 배경이 이미 부호를 말한다.
                      style={{ background: tintFor(v, scale) }}
                    >
                      {v === 0 ? <span className="text-ink-3">—</span> : text(v)}
                    </td>
                  );
                })}
                <td className="py-1.5 pl-3 text-right font-medium">
                  <Money v={r.total} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── 2b. 일별 KRD ────────────────────────────────────────────────────────────

/** 일별 KRD·Δbp·손익 [OWNER, 2026-08-10 — "매일매일의 KRD가 시뮬레이션에서는
 * 나와야 대사가 가능함" · "일별 테너별 bp 변화까지 넣어서 완벽하게"].
 *
 * 원천은 `irsDailyReconciliation` — 엔진이 영업일마다 그날의 쇼크 커브를
 * 부트스트랩하고 12개 테너를 범프해 다시 계산한 대사 루프다(recon.py,
 * `portfolio_krd_day`). 행 하나가 세 지표를 다 들고 있다: `pvbp`(전일
 * 종가 KRD — 추정이 곱한 바로 그 값), `dailyDbp`(그날 테너별 금리 변화),
 * `pnl`(둘의 곱 — 선형 추정 손익). 여기서 계산하는 것은 없다 — 행을 세
 * 줄로 펴서 그릴 뿐이다. (한 행 한 줄에 15개 테너 × 3값을 다 실으면
 * 아무것도 못 읽는다는 판단은 그대로다 — 답이 렌즈 토글에서 세로 스택으로
 * 바뀌었을 뿐이다.)
 *
 * ─ 대사가 닫히는 문장 (픽스처 전 구간 실증 + 외부 문헌 검증, 2026-08-10;
 *   3분해로 갱신 2026-08-11) ────────────────────────────────────────────────
 *   전일 KRD × 당일 Δbp = 합계(추정) — 커브무브만의 선형 근사 (`totalEstPnl`)
 *   합계(추정) ≈ 평가          — 그 차이가 선형화 잔차 (`residual`)
 *   평가 + 캐리 + 롤다운 = 그날 손익 — `valuationPnl + carryPnl +
 *   rolldownPnl = totalActual` (캐리+롤다운 == 종전 세타 `thetaPnl`)
 * 추정이 **전일**(start-of-day) KRD 를 쓰는 것은 P&L explain 민감도 방식의
 * 교과서 관행이다("어제의 민감도 × 오늘의 변동" — 2026-08-10 외부 검증 후
 * 백엔드를 정렬했다, recon.py `_pvbp_prev_r`). KRD 줄도 이제 **같은 전일
 * KRD** 를 보여준다 [OWNER, 2026-08-11 — "전일걸 가져와서 붙이는게 대사하기
 * 편하지 않을까"]: 한 블록 안에서 KRD × Δbp = 손익이 표시 라운딩 안에서
 * 닫히고, 눈이 전일 블록으로 오가지 않는다. 마지막 날의 종가 KRD 는 rows
 * 끝의 이월 앵커 행(`carryover` — 손익 필드 전부 null)이 싣는다.
 * 세타(캐리+롤다운)의 정확한 정의:
 * 터크만의 unchanged-term-structure 가정 — 기준일 커브를 **테너 축에서
 * 동결**하고 시간만 흘렸을 때의 손익, 리픽싱은 그 동결 커브의 잔존 테너
 * **스팟**으로 픽스된다(realized-forwards 아님). 그 안에서 캐리 = 쿠폰 차
 * 액크루얼+정산(Clarus 의 "아무것도 안 해서 확정되는" 몫, 백엔드
 * carry_split.py — 엔진 scf_b 와 날·액수 대조 검증), 롤다운 = 세타 − 캐리
 * (만기 압축의 클린 가격 변화)다. 추정이 그날 손익과 "많이 달라" 보이는
 * 것은 정의상 정상이다: 매끈한 램프에서는 하루 Δbp 가 0.1~0.2bp 라
 * 커브무브 몫이 작고, 실제 손익은 세타가 지배한다.
 *
 * ─ 폭 규율 개정 [OWNER, 2026-08-12 — "좌우로 드래그하는 부분을 만들어서
 * 잘리는 부분도 볼 수 있게 … 물리적으로 잘린 테너들도 복원"] ──────────────
 * 전 테너 열이 그대로 선다 — KRD 가 전 기간 0인 열을 숨기던 구 폭 규율
 * ("좌우 스크롤 하기 싫음", 2026-08-10)은 은퇴했다. 폭은 마우스 드래그
 * 팬(ui/useDragScroll)이 받고, 날짜·구분 열이 스티키로 남아 팬 중에도
 * 행의 정체성이 유지된다. 날짜는 MM-DD(연도·D+n 은 title) 그대로.
 * (이 규율들의 구현은 전부 ui/ReconStack.tsx 에 산다.)
 *
 * ─ 스택 전환 [OWNER, 2026-08-11 — "탭 1개에 KRD·Bp변화·PnL변화를 몰아야
 * … 1일차 KRD, BP변화, PnL를 각각 가로줄로 구성해서 쌓아서 80일치면 240개의
 * 가로줄"] ────────────────────────────────────────────────────────────────
 * 렌즈 토글(한 번에 한 지표)은 은퇴했다 — 트레이딩 시스템 화면과 줄 단위로
 * 맞춰 보는 대사에서 세 지표가 **동시에** 보여야 한다는 지시다. 하루 =
 * 가로줄 셋(KRD·Δbp·손익)의 스택은 공용 컴포넌트 ui/ReconStack.tsx 가
 * 그리고, **백테스트 창의 일별 대사도 같은 컴포넌트다**(WindowDrawer 전례 —
 * 두 벌이면 "같은 표"라는 주장이 곧 거짓이 된다). 세타 열은 3분해를 따라
 * 캐리/롤다운으로 갈렸다(carryPnl/rolldownPnl — 백엔드 carry_split.py).
 *
 * 마켓 컨벤션: "N일자 KRD"는 N의 결제일(다음 영업일) 기준 재평가 값이다 —
 * 엔진이 그 규칙으로 계산한다(chart.py 주석). 트레이딩 시스템과 대조할 때
 * 하루 어긋나 보이면 이 규칙부터 확인할 것. (백테스트 쪽은 행 날짜 그대로
 * 평가한다 — app/backtest.py recon 주석.) */

export function KrdDailyTable({ run }: { run: SimulateResponse }) {
  const rows = run.irsDailyReconciliation ?? [];
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-body text-ink-2">
        이 실행에는 일별 KRD가 없어요 — 스왑이 제외됐거나 par 커브가 없는 실행이에요.
      </p>
    );
  }

  // 테너 열은 첫 행에서 — 모든 행이 같은 테너 집합(엔진 KRD_NAMES 순서)을
  // 갖는다. JSON 이 dict 삽입 순서를 보존하므로 키 순서가 곧 엔진 순서다.
  const tenors = Object.keys(rows[0].pvbp);
  // 시간순 — D+0 이 위 [OWNER, 2026-08-10]: 시뮬레이션은 미래 경로라
  // "최신"이랄 게 없다. 백테스트 쪽 어댑터는 반대로 최신이 위다(실제 이력).
  const days: ReconStackDay[] = rows.map((r) => ({
    date: r.date,
    // 이월 앵커(마지막 행): 종가 KRD = 다음 영업일로 들고 가는 리스크.
    title: r.carryover
      ? `${r.date} · D+${r.day} · 다음 영업일로 들고 가는 이월 리스크`
      : `${r.date} · D+${r.day}`,
    krd: r.pvbp,
    dbp: r.dailyDbp,
    est: r.pnl,
    estTotal: r.totalEstPnl,
    valuation: r.valuationPnl,
    // 구 캐시 응답에는 분리가 없다 — 0 이 아니라 미정의(공란 정책).
    carry: r.carryPnl ?? null,
    rolldown: r.rolldownPnl ?? null,
    actual: r.totalActual,
  }));

  return (
    <div>
      {/* 대사 문장이 열 순서 그대로다: 손익 줄의 합계(추정) vs 평가 =
          선형화 잔차(엔진 residual), 평가 + 캐리 + 롤다운 = 그날 손익. */}
      <p className="pb-2 text-callout text-ink-2">
        하루가 세 줄이에요 — KRD(전일 종가 감도), Δbp(그날 변화), 손익(KRD ×
        Δbp 추정). 같은 블록의 KRD와 Δbp를 곱하면 손익 줄이 나와요. 추정
        합계와 평가의 차가 선형화 잔차이고, 평가·캐리·롤다운을 더하면 그날
        손익이에요. 마지막 블록은 다음 영업일로 들고 가는 이월 리스크예요.
      </p>
      {/* asc 기본 = 2026-08-10 룰링(D+0 이 위 — 미래 경로엔 "최신"이 없다);
          날짜 헤더 토글로 뒤집을 수 있다 [OWNER, 2026-08-11]. */}
      <ReconStack days={days} tenors={tenors} defaultOrder="asc" />
    </div>
  );
}

// ── 3. 일별 손익 ────────────────────────────────────────────────────────────

/** 누적에서 하루치를 뺀다 [OWNER, 2026-08-10 — "PnL와 KRD는 시스템과 대사가
 * 목적이므로 Cumulative가 아니라 매일매일을 적어주면 됨"]. 응답
 * `decompositionDaily`는 누적값만 준다(서버가 별도로 일별 델타 필드를 주는
 * 백테스트와 다르다) — 그래서 여기서 인접한 행끼리 차분한다. 이건 "서버와
 * 다시 계산해서 어긋날 수 있는 두 번째 정의"가 아니다: 누적의 정확한 역연산
 * 이고, 서버가 애초에 델타를 따로 준 적이 없어서 대조할 두 번째 원천이 없다.
 * 어느 한쪽이 null(제외)이면 그날 델타도 null — 0으로 채우면 "안 움직였다"는
 * 없는 사실을 말한다. 행은 **영업일**이라(day 0 + 영업일마다 하나) 인접 행
 * 차분은 영업일 증분이다 — 월요일 행은 금요일 대비 변화이고, 이건 엔진의
 * recon 창(`prev_cal`)과 같은 정의라 일별 KRD 탭의 값과 그대로 맞는다. */
function dailyDelta(
  rows: DecompositionDailyPoint[],
  i: number,
  key: "swapMtm" | "swapCarry" | "swapRolldown",
) {
  const cur = rows[i][key];
  if (cur === null || cur === undefined) return null;
  const prev = i === 0 ? 0 : rows[i - 1][key];
  return prev === null || prev === undefined ? null : cur - prev;
}

export function DailyPnlTable({ run }: { run: SimulateResponse }) {
  const rows = run.decompositionDaily ?? [];
  if (rows.length === 0) return null;

  return (
    <Section title="일별 손익" bare>
      {/* 스왑평가/스왑캐리/스왑롤다운의 뜻을 여기서도 말한다 [OWNER,
          2026-08-10 · 3분해 2026-08-11] — 일별 대사 표의 같은 이름 열과 같은
          값이라는 주장은 픽스처 전 구간 검증을 거친 사실이다(KrdDailyTable
          doc). */}
      <p className="pb-2 text-body text-ink-2">
        하루 대비 얼마나 움직였는지예요. 스왑평가는 그날 커브가 움직여 생긴 몫,
        스왑캐리는 실제 주고받는 이자의 몫, 스왑롤다운은 커브가 멈춰도 잔존만기가
        줄며 생기는 몫이에요 — 일별 대사 표의 같은 이름 열과 같은 값이에요.
      </p>
      <div className="max-h-[360px] overflow-y-auto">
        <table className="w-full text-body">
          <thead>
            <tr>
              <Th>일차</Th>
              <Th right>스왑평가</Th>
              <Th right>스왑캐리</Th>
              <Th right>스왑롤다운</Th>
              <Th right>합계</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const mtm = dailyDelta(rows, i, "swapMtm");
              const carry = dailyDelta(rows, i, "swapCarry");
              const roll = dailyDelta(rows, i, "swapRolldown");
              const total =
                mtm === null || carry === null || roll === null
                  ? null
                  : mtm + carry + roll;
              return (
                <tr key={r.day} className="border-t border-edge">
                  <td className="py-1.5 pr-3 text-ink-2">D+{r.day}</td>
                  <td className="py-1.5 pl-3 text-right"><MoneyWon v={mtm} /></td>
                  <td className="py-1.5 pl-3 text-right"><MoneyWon v={carry} /></td>
                  <td className="py-1.5 pl-3 text-right"><MoneyWon v={roll} /></td>
                  <td className="py-1.5 pl-3 text-right"><MoneyWon v={total} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── 4. 정산 현금흐름 ────────────────────────────────────────────────────────

export function SettlementTable({ run }: { run: SimulateResponse }) {
  const events = run.irsSettlementEvents ?? [];

  // 날짜별로 묶는다. 같은 날 여러 건이 정산되는 것이 보통이고, 건별로 나열하면
  // "이 달에 현금이 얼마나 오가나"를 읽을 수 없다.
  const byDate = useMemo(() => {
    const m = new Map<string, { date: string; day: number; count: number; net: number }>();
    for (const e of events) {
      const key = e.date ?? `D+${e.day}`;
      const cur = m.get(key) ?? { date: key, day: e.day, count: 0, net: 0 };
      cur.count += 1;
      cur.net += e.settledCf;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => a.day - b.day);
  }, [events]);

  if (byDate.length === 0) {
    return (
      <Section title="정산 현금흐름">
        <p className="pb-4 text-body text-ink-2">이 기간에는 정산일이 없어요.</p>
      </Section>
    );
  }

  const net = byDate.reduce((s, r) => s + r.net, 0);

  return (
    <Section title="정산 현금흐름">
      <p className="pb-2 text-body text-ink-2">
        리픽싱 때 실제로 오가는 현금이에요. 기간 전체로는 {formatKrwAxisSigned(net)}이고,
        평가손익과 달리 계좌에 들어오고 나가는 돈이에요.
      </p>
      <div className="max-h-[300px] overflow-y-auto">
        <table className="w-full text-body">
          <thead>
            <tr>
              <Th>정산일</Th>
              <Th right>건수</Th>
              <Th right>순현금</Th>
            </tr>
          </thead>
          <tbody>
            {byDate.map((r) => (
              <tr key={r.date} className="border-t border-edge">
                <td className="py-1.5 pr-3">
                  {r.date}
                  <span className="pl-2 text-ink-2">D+{r.day}</span>
                </td>
                <td className="py-1.5 pl-3 text-right text-ink-2">{r.count}</td>
                <td className="py-1.5 pl-3 text-right"><Money v={r.net} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** 조달 기준 한 줄 — 어떤 금리로 조달을 가정했는지. 스왑만 평가하는 지금은
 * 손익에 안 들어가지만, 캐리를 읽을 때 기준이 되는 숫자다. */
export function FundingNote({ run }: { run: SimulateResponse }) {
  const fb = run.fundingBasis;
  if (!fb?.applied) return null;
  return (
    <p className="pt-3 text-callout text-ink-2">
      조달 기준은 {fb.joinDate ?? "—"}까지 실적 기준금리 + {fb.spreadBp}bp, 이후는 정책상수{" "}
      {formatPercent(fb.policyRate + fb.spreadBp / 10000)}예요.
      {fb.stale && " 시리즈가 정책상수보다 뒤처져 있어요."}
    </p>
  );
}
