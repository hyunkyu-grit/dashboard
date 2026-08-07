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
import { Section, Segmented } from "@/sim/ui/primitives";
import type { SimulateResponse } from "@/sim/api/simulate-dto";

/** 표 머리. sticky라 스크롤해도 열 이름이 남는다 — 남지 않으면 스무 행쯤
 * 내려간 뒤로는 어느 열이 무엇인지 알 수 없다. 배경은 **불투명**이어야 한다:
 * 반투명이면 밑을 지나가는 행이 비쳐 글자가 겹친다. */
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`sticky top-0 z-10 bg-tile py-2 text-callout font-normal text-ink-2 ${
        right ? "text-right" : "text-left"
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

// ── 3. 일별 손익 ────────────────────────────────────────────────────────────

export function DailyPnlTable({ run }: { run: SimulateResponse }) {
  const rows = run.decompositionDaily ?? [];
  if (rows.length === 0) return null;

  return (
    <Section title="일별 손익" bare>
      <p className="pb-2 text-body text-ink-2">
        하루하루의 누적 손익이에요. 위 커브를 숫자로 옮긴 것이라 같은 값이에요.
      </p>
      <div className="max-h-[360px] overflow-y-auto">
        <table className="w-full text-body">
          <thead>
            <tr>
              <Th>일차</Th>
              <Th right>스왑평가</Th>
              <Th right>스왑캐리</Th>
              <Th right>합계</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const total = (r.swapMtm ?? 0) + (r.swapCarry ?? 0);
              return (
                <tr key={r.day} className="border-t border-edge">
                  <td className="py-1.5 pr-3 text-ink-2">D+{r.day}</td>
                  <td className="py-1.5 pl-3 text-right"><Money v={r.swapMtm} /></td>
                  <td className="py-1.5 pl-3 text-right"><Money v={r.swapCarry} /></td>
                  <td className="py-1.5 pl-3 text-right">
                    {r.swapMtm === null ? <span className="text-ink-3">—</span> : <Money v={total} />}
                  </td>
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
