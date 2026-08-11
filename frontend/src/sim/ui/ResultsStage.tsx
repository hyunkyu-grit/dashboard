"use client";

/**
 * 결과 화면 — 시나리오 요약 칩, 성분 누적 경로, Total Return 워터폴.
 *
 * 경로와 목적지를 나란히 둔다: 위 차트는 성분이 **어떻게** 갔는지를, 아래
 * 워터폴은 **어디에** 도착했는지를 같은 페이로드로 말한다.
 *
 * 재실행은 대체다 [OWNER]. 겹쳐 보기도, 실행 이력도 없다 — 새 결과가 도착한
 * 순간에만 이전 것을 갈아친다.
 *
 * 공란 정책: 스왑이 제외된 응답에서 스왑 손익은 "—"다. 0이 아니다. 0은 "계산
 * 했고 값이 0이었다"는 주장인데, 제외는 계산하지 않았다는 뜻이다.
 */

import { motion, useReducedMotion } from "motion/react";

import { formatKrwAxisSigned } from "@/sim/lib/format";
import { ARRIVE, ARRIVE_STAGGER, instant } from "@/ui/motion";
import { Button, Chip, Section } from "@/sim/ui/primitives";
import { PAGE_X } from "@/sim/ui/layout";
import { directionVar } from "@/sim/theme/tint";
import { COMPONENTS, visibleTotal } from "@/sim/lib/components";
import { getSimChartTheme } from "@/sim/lib/chart-theme";
import { useSimulationPort } from "@/sim/hooks/use-simulation";
import { useSimulationDataStore } from "@/sim/store/simulation-data-store";
import { SCENARIO_CASES } from "@/sim/types/simulation-port";

import { ComponentCurves } from "./ComponentCurves";
import { FundingNote, KrdDailyTable } from "./ResultsTables";
import { Waterfall, type WaterfallItem } from "./Waterfall";

/** 구획 하나가 도착하는 모양 — 짧은 페이드 + 상승.
 *
 * 상수가 아니라 **함수**인 이유: 이 제품에서는 authored transition이 전부
 * `instant()`를 지나야 하고(ui/motion.ts, guards/reduced-motion.test.ts가
 * 호출 지점을 센다), `instant()`에 넘길 `reduced`는 훅에서 온다. 모듈 최상단
 * 상수로는 훅을 부를 수 없으므로 컴포넌트 안에서 만든다.
 *
 * MotionConfig reducedMotion="user"에 기대면 안 되는 이유가 여기서 그대로
 * 적용된다 — 그건 transform만 0으로 만들고 **opacity는 끝까지 재생한다.**
 * 이 변형은 opacity와 y를 같이 쓰므로, 그 상태로는 절반만 즉시가 된다. */
const arriveItem = (reduced: boolean) => ({
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: instant(ARRIVE, reduced) },
});

/** N1 — 앵커 테너별 국채 충격 커브 노드의 연수. */
const ANCHOR_YEARS = { "1Y": 1, "3Y": 3, "5Y": 5, "10Y": 10 } as const;

export function ResultsStage({ onEdit }: { onEdit: () => void }) {
  const { lastRun, lastRunRequest } = useSimulationPort();
  const lastRunAnchorTenor = useSimulationDataStore((s) => s.lastRunAnchorTenor);
  // 네 케이스 결과 [OWNER, 2026-08-10]. 탭 전환은 lastRun 자체를 갈아 끼우므로
  // (store setResultCase), 아래의 모든 구획은 케이스를 몰라도 된다.
  const caseRuns = useSimulationDataStore((s) => s.caseRuns);
  const resultCase = useSimulationDataStore((s) => s.resultCase);
  const setResultCase = useSimulationDataStore((s) => s.setResultCase);
  // above the `lastRun` guard — hooks may not sit behind an early return
  const reduced = useReducedMotion() === true;
  const ARRIVE_ITEM = arriveItem(reduced);
  if (!lastRun) return null;

  const ranCases = SCENARIO_CASES.filter((c) => caseRuns[c.id]);
  const t = getSimChartTheme();
  const totalOf = (id: (typeof SCENARIO_CASES)[number]["id"]): number | null => {
    const d = caseRuns[id]?.result.totalReturnDecomposition;
    return d ? visibleTotal(d) : null;
  };

  const decomp = lastRun.totalReturnDecomposition ?? null;
  const swapExclusion = (lastRun.exclusions ?? []).find((x) => x.assetClass === "swap") ?? null;

  // ── 요약 칩 ──
  const chips: { label: string; value: string; color?: string }[] = [];
  if (lastRunRequest) {
    chips.push({ label: "기간", value: `D+${lastRunRequest.simDays}` });
    // 칩은 **설계한 앵커 그대로** 보여준다("국고 5Y +30bp"). 3Y로 정규화된
    // 전송값이 아니다. X는 전송된 국채 충격 커브의 앵커 노드에서 되읽는다
    // (정확한 노드라 보간 없음). 앵커가 없는 옛 결과는 3Y로 라벨하며, 그
    // 경우 전송값이 곧 설계값이라 어느 쪽이든 같은 숫자다.
    const anchor = lastRunAnchorTenor ?? "3Y";
    const anchorX =
      lastRunRequest.shockCurves?.bondCurves?.국채?.find((p) => p.t === ANCHOR_YEARS[anchor])?.val ??
      lastRunRequest.baseShockBp;
    chips.push({
      label: `국고 ${anchor} 목표`,
      value: `${anchorX >= 0 ? "+" : ""}${parseFloat(anchorX.toFixed(2))}bp`,
    });
  }

  // ── Total Return ──
  // 서버의 `total`은 다섯 성분 전부의 합이다. 지금 범위는 스왑뿐이므로 보이는
  // 성분만 더한다 — 보이지 않는 성분이 섞인 숫자를 "토탈"이라 부르지 않는다.
  const shownTotal = decomp ? visibleTotal(decomp) : null;
  const items: WaterfallItem[] = COMPONENTS.map(({ key, label }) => ({
    label,
    value: decomp ? ((decomp[key] as number | null | undefined) ?? null) : null,
  }));

  if (shownTotal !== null) {
    chips.push({
      label: "Total Return",
      value: formatKrwAxisSigned(shownTotal),
      color: directionVar(shownTotal),
    });
  }

  return (
    /* 구획이 그룹박스가 되면서 사이를 **간격**이 가른다 [2026-08-07]. 예전에는
       각 Section 이 위쪽 헤어라인을 그렸고 부모는 간격이 없었다 — 박스끼리
       붙어 있으면 테두리 둘이 2px 선 하나로 보인다. */
    /* `overflow-anchor: none` [2026-08-07]. 결과가 스태거로 들어오는 동안
       내용의 높이가 계단식으로 자라는데, 크롬의 스크롤 앵커링이 "보이던 것을
       제자리에" 두려고 스크롤을 따라 내린다 — 창으로 띄우고 나서 첫 화면이
       127px 내려간 채로 열리는 것으로 드러났다. 인라인일 때는 스크롤 컨테이너가
       화면만큼 길어서 눈에 안 띄었다.
       앵커링을 끄는 것이 맞는 이유: 여기서는 지킬 "보던 위치" 가 없다. 결과는
       방금 도착한 것이고 맨 위부터 읽는다. */
    <div
      className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-8 pt-3 [overflow-anchor:none] ${PAGE_X}`}
    >
      <motion.div
        className="flex flex-col gap-3"
        initial="hidden"
        animate="shown"
        /* The stagger routes through instant() like everything else —
         * staggerChildren IS a Transition field, so reduced motion collapses
         * it to { duration: 0 } and the four blocks land together instead of
         * 60ms apart, four times over. */
        variants={{ shown: { transition: instant({ staggerChildren: ARRIVE_STAGGER }, reduced) } }}
      >
        {/* 케이스 탭 [OWNER, 2026-08-10 — "실행결과 나란히"]. 실행 하나가 네
            케이스를 전부 돌렸다. 탭 하나가 케이스 하나이고, 탭 안에 그 케이스의
            토탈이 같이 산다 — 여기서 이미 넷이 나란히 읽히고, 누르면 아래 전체
            (칩·커브·워터폴·서랍)가 그 케이스의 결과로 갈아 끼워진다. */}
        {ranCases.length > 1 && (
          <motion.div variants={ARRIVE_ITEM} className="flex flex-wrap items-center gap-1.5 pt-4">
            {ranCases.map((c) => {
              const on = c.id === resultCase;
              const total = totalOf(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setResultCase(c.id)}
                  className={
                    "flex h-7 items-center gap-1.5 rounded-control-sm px-2.5 text-callout transition-colors " +
                    (on
                      ? "bg-ink-4 font-medium text-ink"
                      : "bg-ink-5 text-ink-2 hover:bg-ink-4 hover:text-ink-1")
                  }
                >
                  <svg width="14" height="6" aria-hidden className="shrink-0">
                    <line x1="0" y1="3" x2="14" y2="3" stroke={t.case[c.id]} strokeWidth="1.5" />
                  </svg>
                  {c.label}
                  <span
                    className="tabular-nums"
                    style={total === null ? undefined : { color: directionVar(total) }}
                  >
                    {total === null ? "—" : formatKrwAxisSigned(total)}
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}

        <motion.div variants={ARRIVE_ITEM} className="flex flex-wrap items-center justify-between gap-2 py-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <Chip key={c.label} label={c.label} value={c.value} valueColor={c.color} animated />
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={onEdit}>
            조건 수정
          </Button>
        </motion.div>

        {/* 케이스 비교 — 성분까지 나란히. 위 탭이 토탈만 갈랐다면 이 표는
            "어느 성분이 갈랐나"에 답한다. 행이 성분, 열이 케이스 — 케이스끼리
            비교하는 화면이므로 눈이 가로로 훑는 방향에 케이스를 둔다. */}
        {ranCases.length > 1 && (
          <motion.div variants={ARRIVE_ITEM}>
            <Section title="케이스 비교">
              <p className="pb-1 text-body text-ink-2">
                같은 포지션이 네 경로에서 각각 어디에 도착하는지예요.
              </p>
              <table className="w-full max-w-[640px] text-body">
                <thead>
                  <tr>
                    <th className="py-2 text-left font-normal text-ink-2">성분</th>
                    {ranCases.map((c) => (
                      <th key={c.id} className="py-2 text-right font-normal text-ink-2">
                        <span className="inline-flex items-center gap-1.5">
                          <svg width="14" height="6" aria-hidden>
                            <line x1="0" y1="3" x2="14" y2="3" stroke={t.case[c.id]} strokeWidth="1.5" />
                          </svg>
                          {c.label}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPONENTS.map(({ key, label }) => (
                    <tr key={key} className="border-t border-edge">
                      <td className="py-2 text-ink-2">{label}</td>
                      {ranCases.map((c) => {
                        const d = caseRuns[c.id]?.result.totalReturnDecomposition;
                        const v = d ? ((d[key] as number | null | undefined) ?? null) : null;
                        return (
                          <td
                            key={c.id}
                            className="py-2 text-right tabular-nums"
                            style={v === null ? undefined : { color: directionVar(v) }}
                          >
                            {v === null ? "—" : formatKrwAxisSigned(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="border-t border-edge">
                    <td className="py-2 font-medium">토탈</td>
                    {ranCases.map((c) => {
                      const v = totalOf(c.id);
                      return (
                        <td
                          key={c.id}
                          className="py-2 text-right font-medium tabular-nums"
                          style={v === null ? undefined : { color: directionVar(v) }}
                        >
                          {v === null ? "—" : formatKrwAxisSigned(v)}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </Section>
          </motion.div>
        )}

        {swapExclusion && (
          <p className="border-t border-edge py-3 text-body text-ink-1">
            스왑을 제외했어요 — {swapExclusion.reason} ({swapExclusion.asOf})
          </p>
        )}

        <motion.div variants={ARRIVE_ITEM}>
        <Section title="성분 누적 경로">
          <p className="pb-1 text-body text-ink-2">
            설계한 금리 경로대로 갔을 때 손익이 어떻게 쌓이는지예요. 평가는 커브가
            움직여서 생기는 몫, 캐리는 실제 주고받는 이자의 몫, 롤다운은 커브가
            멈춰도 잔존만기가 줄며 생기는 몫이에요.
          </p>
          <ComponentCurves />
        </Section>
        </motion.div>

        <motion.div variants={ARRIVE_ITEM}>
        <Section title="Total Return">
          <p className="pb-1 text-body text-ink-2">
            기간이 끝났을 때의 도착점이에요. 위 커브의 마지막 값과 같은 숫자예요.
          </p>
          {decomp ? (
            // 전폭에서 워터폴과 표를 위아래로 쌓으면 표의 라벨과 값이 화면
            // 양 끝으로 벌어져, "스왑평가"와 "+22.6억" 사이를 눈이 1,400px
            // 가로지른다. 좌우로 놓으면 표는 읽기 좋은 폭을 유지하고 워터폴이
            // 남는 자리를 쓴다.
            //
            // 폭에 상한을 둔다. 위 시계열 차트는 전폭을 벌어서 쓰지만 — 시간축은
            // 길수록 잘 읽힌다 — 여기는 막대 셋이다. 상한이 없으면 워터폴은
            // 1,000px 상자 가운데 뜨고(막대 폭에 상한이 있어서 늘어나지 않는다)
            // 표는 화면 오른쪽 끝으로 밀려서, 둘 사이 600px이 빈다.
            <div className="flex max-w-[880px] items-start gap-10 pt-2">
              <div className="h-64 min-w-0 flex-1">
                <Waterfall items={items} total={shownTotal ?? 0} />
              </div>
              <table className="w-[340px] shrink-0 pb-3 text-body">
                <tbody>
                  {items.map((it) => (
                    <tr key={it.label} className="border-t border-edge">
                      <td className="py-2 text-ink-2">{it.label}</td>
                      <td
                        className="py-2 text-right"
                        style={it.value === null ? undefined : { color: directionVar(it.value) }}
                      >
                        {it.value === null ? "—" : formatKrwAxisSigned(it.value)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-edge">
                    <td className="py-2 font-medium">토탈</td>
                    <td
                      className="py-2 text-right font-medium"
                      style={shownTotal === null ? undefined : { color: directionVar(shownTotal) }}
                    >
                      {shownTotal === null ? "—" : formatKrwAxisSigned(shownTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-body text-ink-2">
              이 실행 결과에는 성분 분해가 없어요. 다시 실행하면 나와요.
            </p>
          )}
        </Section>
        </motion.div>

        {/* 일별 대사 — 서랍에서 본문으로 [OWNER, 2026-08-10 — "일별 PnL탭
            없애고, KRD의 컴포넌트를 위로 올리기"]. 세 렌즈(KRD·Δbp·손익)가
            대사에 필요한 전부를 실으면서 별도 일별 PnL 탭은 같은 숫자의
            부분집합이 됐다 — 표 하나가 서랍 두 탭을 대체한다. */}
        <motion.div variants={ARRIVE_ITEM}>
          <Section title="일별 대사">
            <KrdDailyTable run={lastRun} />
          </Section>
        </motion.div>

        {/* 감춘 표 넷 [OWNER, 2026-08-06 — "지금 당장은 필요없을 듯"]:
         *   ContributionTable · KrdGrid · SettlementTable · DailyPnlTable
         *   (DailyPnlTable 은 2026-08-10 에 서랍째 은퇴 — 일별 대사 표의
         *   손익 렌즈가 같은 값을 싣는다)
         *
         * 컴포넌트는 ResultsTables.tsx에 그대로 있다. 되살리려면 위 import에
         * 이름을 되돌리고 여기에 네 줄을 다시 놓으면 된다 — 백엔드 계약도,
         * 응답 필드도 건드린 적이 없다.
         *
         * 렌더 비용은 이걸로 사라진다(377행 표 + KRD 히트맵). 엔진 비용은
         * 애초에 없었다: 네 표가 읽던 값은 기본 실행이 어차피 만드는 것이고,
         * swapContributions도 버려지던 값을 줍는 것이라 런타임에 영향이 없다. */}
        <FundingNote run={lastRun} />
      </motion.div>
    </div>
  );
}
