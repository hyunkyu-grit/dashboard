"use client";

/**
 * 조건 설정 — 국채 앵커 금리의 경로를 설계하고 실행한다.
 *
 * ─ 범위: 스왑만 [OWNER, 2026-08-06] ─────────────────────────────────────
 * 원본에 있던 **크레딧 스프레드**(특은채·은행채·카드채·회사채) 블록은 없앴다.
 * 그 값들은 크레딧 채권 커브만 만드는데 이 북에는 크레딧 채권이 없다.
 * **조달 금통위 스테핑** 토글도 없앴다 — 조달비용은 채권 평가금액을 조달하는
 * 비용이고, 채권이 없으면 0이라 토글이 아무것도 바꾸지 않는다.
 *
 * 남긴 것은 스왑에 실제로 닿는 것들이다: 전송 페이로드에서 스왑 커브는
 * `국채 커브 + irsSpread`이므로 **테너 스프레드는 스왑을 움직이고**, 금통위
 * 이벤트는 단기 구간을 통해 움직인다.
 *
 * 웨이포인트 쓰기 경로는 하나다 (lib/waypoints.buildWaypointPatch). 스테퍼든
 * 직접 입력이든 같은 함수를 지나므로, 입력 방법이 달라도 페이로드가 같다는 것이
 * 테스트로 확인하는 성질이 아니라 구조적 성질이다.
 */

import { useEffect, useState } from "react";


import {
  Button,
  Chevron,
  Field,
  Input,
  NumberField,
  Section,
  Segmented,
  Stepper,
  cn,
} from "@/sim/ui/primitives";
import { PAGE_L, PAGE_R } from "@/sim/ui/layout";
import { useSimulationPort } from "@/sim/hooks/use-simulation";
import { useSimulationDataStore } from "@/sim/store/simulation-data-store";
import { addDaysIso, diffDaysIso, isValidIso } from "@/sim/lib/dates";
import { useBook } from "@/sim/hooks/use-book";
import { useInstrumentCatalog } from "@/sim/hooks/use-instruments";
import { anchorConversionError, toNum } from "@/sim/lib/scenario-curves";
import {
  WAYPOINT_STEP_BP,
  buildWaypointPatch,
  lerpDefaultBp,
  waypointClampMax,
} from "@/sim/lib/waypoints";
import {
  ANCHOR_TENOR_CHOICES,
  SCENARIO_CASES,
  type AnchorTenor,
} from "@/sim/types/simulation-port";

import { CurvePreview } from "./CurvePreview";
import { PositionsPanel } from "./PositionsPanel";

const ANCHOR_OPTIONS = ANCHOR_TENOR_CHOICES.map((t) => ({ value: t, label: t }));

/* ── 목록 행 ──────────────────────────────────────────────────────────────
 * 32px. 킷의 목록 행 사다리는 글자 크기가 정한다 — 15pt가 40, **13pt가 32**다.
 * 이 화면의 본문이 13pt이므로 32가 맞는 칸이고, 한동안 40을 쓰면서 폼만
 * 헐거웠다.
 *
 * `isolate`는 아래 Band를 위한 것이다. */
const ROW = "group relative isolate flex h-8 items-center gap-3 border-t border-edge first:border-t-0";

/** 행에 커서가 얹힌 것을 말하는 띠.
 *
 * 킷 Sidebars의 선택 배경은 240 행에서 **248 폭**에 라운드 8이다 — 행 안쪽에
 * 갇힌 사각형이 아니라 목록 거터까지 좌우로 4씩 먹는다. 그래서 `-inset-x-1`.
 *
 * 농도는 잉크 5단계(5%). 킷 값은 #000/0.11에 스타일 불투명도 0.5라 실효
 * 5.5%인데, 처음에 6단계(3%)로 넣었더니 화면에서 아예 안 보였다 — 있는데
 * 안 보이는 상태 표시는 없는 것과 같다.
 *
 * **`-z-10`이 핵심이다.** 띠는 위치 지정 요소라, 그냥 두면 위치 지정이 없는
 * 형제(입력칸·스테퍼)보다 **위에** 칠해진다. 그 상태를 화면에서 보면 커서가
 * 얹힌 행의 흰 입력칸이 회색으로 죽어서 비활성처럼 보인다. 행에 `isolate`를
 * 걸어 쌓임 맥락을 만들고 띠를 그 안에서 뒤로 보낸다 — 형제마다 `relative`를
 * 붙이고 다니는 것보다 한 곳에서 끝난다. */
function Band() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -inset-x-1 inset-y-0 -z-10 rounded-row transition-colors group-hover:bg-ink-5"
    />
  );
}

export function ConfigureStage() {
  const { params, inputs, status, patchParams, runCurrent } = useSimulationPort();
  // 기준일은 `userBaseDate`(사용자 오버라이드)로 쓴다. `inputs.baseDate`에 직접
  // 쓰면 북 브릿지가 다음 렌더에서 도로 덮어쓴다 — 브릿지가 그 필드의 주인이다.
  const setUserBaseDate = useSimulationDataStore((s) => s.setUserBaseDate);
  const userBaseDate = useSimulationDataStore((s) => s.userBaseDate);
  const manualPositions = useSimulationDataStore((s) => s.manualPositions);
  const { latestDataDate, legsByRow, marketUnavailable } = useBook();
  const catalog = useInstrumentCatalog();
  const activeCase = useSimulationDataStore((s) => s.activeCase);

  const anchor: AnchorTenor = params.anchorTenor ?? "3Y";
  const anchorError = anchorConversionError(params);
  /* `inputs.positions`가 아니라 손입력 줄을 직접 본다. 둘은 대개 같지만,
   * 기준일에 이미 만기가 지난 줄은 브릿지가 걸러내므로 다를 수 있다 — 그
   * 경우 "포지션은 넣었는데 실행이 안 된다"가 되고, 사유는 아래 각 행의
   * 에러 문구가 말한다. 여기서는 실행 가능한 줄이 하나라도 있으면 된다. */
  const runnable = inputs.positions.length > 0;
  const canRun = runnable && status !== "running" && !anchorError;

  // 지평이나 목표가 바뀌면 30일 간격의 중간 웨이포인트를 다시 만든다.
  // **손대지 않은** 중간점은 {simDays, baseShockBp}를 향한 직선 위의 값으로
  // 되돌아가고, 손댄 점은 바이트 그대로 보존된다. 손댔는지는 명시적 플래그로
  // 안다 — 값이 같은지로 추론하면 우연히 직선 위에 놓인 편집이 지워진다.
  // 스토어에서 최신 상태를 직접 읽는 이유는 웨이포인트에 대한 낡은 클로저를
  // 피하기 위해서다.
  // 케이스 전환도 이 효과를 깨운다 [트레이더 피드백 2, 2026-08-07]. 전환은 대개
  // baseShockBp 를 바꾸므로 저절로 걸리지만, **두 케이스의 목표가 우연히 같으면**
  // 걸리지 않는다 — 그 경우 기간을 그 사이에 바꿨다면 마감일이 지난 웨이포인트를
  // 그대로 물고 들어온다. 활성 케이스 자체를 의존성에 넣으면 그 틈이 없다.
  useEffect(() => {
    const { params: p, patchParams: patch } = useSimulationDataStore.getState();
    const target = toNum(p.baseShockBp);
    const touched = new Set(p.touchedWaypointDays);
    const grid: number[] = [];
    for (let i = 1; i < Math.floor(p.simDays / 30); i++) grid.push(i * 30);

    const next: { day: number; bp: number }[] = [{ day: 0, bp: 0 }];
    for (const day of grid) {
      const prev = p.waypoints.find((w) => w.day === day);
      next.push({
        day,
        bp: touched.has(day) && prev !== undefined ? prev.bp : lerpDefaultBp(target, day, p.simDays),
      });
    }
    next.push({ day: p.simDays, bp: target });
    patch({
      waypoints: next,
      touchedWaypointDays: p.touchedWaypointDays.filter((d) => grid.includes(d)),
    });
  }, [params.simDays, params.baseShockBp, activeCase]);

  const baseDate = inputs.baseDate;
  const endDate = addDaysIso(baseDate, params.simDays);

  return (
    /* 2단. 전폭 셸에서 폼을 가로로 늘이면 라벨과 입력란이 멀어져 읽기 힘들어
       지므로, 조건은 왼쪽 한 칼럼에 모으고 남는 폭은 미리보기가 쓴다.
       패널 사이는 세로 헤어라인 하나. */
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[520px] shrink-0 flex-col border-r border-edge">
        {/* 구획이 그룹박스가 되면서 사이를 간격이 가른다 (ResultsStage 와 같은
            이유 — 박스끼리 붙으면 테두리 둘이 한 선으로 보인다). */}
        <div
          className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-6 pr-6 pt-3 ${PAGE_L}`}
        >
          <Section title="기간">
            <div className="grid grid-cols-2 gap-3 pb-4 pt-3">
            <Field label="시작일" hint="평가 기준일">
              <Input
                type="date"
                value={baseDate}
                max={latestDataDate ?? undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isValidIso(v)) setUserBaseDate(v);
                }}
              />
            </Field>
            <Field label="마감일" hint={`D+${params.simDays}`}>
              <Input
                type="date"
                value={endDate}
                min={addDaysIso(baseDate, 1)}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!isValidIso(v)) return;
                  const d = diffDaysIso(baseDate, v);
                  // 지평은 양수여야 한다. 0이나 음수면 경로가 없다.
                  if (d > 0) patchParams({ simDays: d });
                }}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3 pb-4">
            <span className="text-body text-ink-2">
              {/* 한 줄로 [OWNER, 2026-08-10 — "포지션 N개를 평가해요가 나을
                  거 같음"]. 상품 수와 다리 수가 다르다는 것(스프레드는 두 다리,
                  플라이는 세 다리)은 여전히 사실이지만, 이 줄이 답할 질문은
                  "지금 뭘 평가하고 있나"이지 다리 회계가 아니다. */}
              {inputs.positions.length > 0
                ? `포지션 ${manualPositions.length}개를 평가해요`
                : "평가할 포지션이 없어요"}
            </span>
            {/* "오늘로"가 아니라 "최신 데이터로"다. 오늘은 대개 워크북에 없는
                날이고, 그 날짜로 실행하면 호가가 없어 스왑이 통째로 제외된 채
                화면만 조용히 빈다. 되돌아갈 곳은 데이터가 있는 마지막 날이다. */}
            {userBaseDate !== null && latestDataDate && baseDate !== latestDataDate && (
              <Button variant="ghost" size="sm" onClick={() => setUserBaseDate(null)}>
                최신 데이터로
              </Button>
            )}
          </div>
          {latestDataDate && baseDate > latestDataDate && (
            <p className="pb-4 text-body text-ink-1">
              {latestDataDate} 이후의 시장 데이터가 없어요. 이 날짜로 실행하면 스왑이 제외돼요.
            </p>
          )}
        </Section>

        {/* 포지션이 금리 경로보다 위에 온다. 순서가 질문의 순서다 — 무엇을
            평가할지 먼저 정하고, 그 다음에 어떤 경로에 둘지 정한다. */}
        <PositionsPanel
          baseDate={baseDate}
          catalog={catalog.data}
          legsByRow={legsByRow}
          marketUnavailable={marketUnavailable}
        />

        <CaseSection />

        <Section title="목표 금리">
          <div className="flex flex-col gap-4 pb-4 pt-3">
            <Field label="앵커 테너" hint="국고">
              <div>
                <Segmented
                  options={ANCHOR_OPTIONS}
                  value={anchor}
                  onChange={(v) => patchParams({ anchorTenor: v })}
                  label="목표 앵커 테너"
                />
              </div>
            </Field>

            {/* 스테퍼가 붙는다 [OWNER, 2026-08-07 — "bp 목표는 스테퍼가 맞는
                자리일 수 있습니다"]. 바로 아래 경로 설계의 D+n 행들은 이미
                Input + Stepper 짝이고, 같은 단위를 같은 걸음으로 움직이는
                칸이 하나만 자유 입력이던 것이 어긋난 자리였다.
                걸음은 `WAYPOINT_STEP_BP` 로 같다 — 목표와 그 경유지가 다른
                눈금을 쓰면 손으로 맞춰 놓은 경로가 목표를 한 번 누를 때마다
                어긋난다. 자유 입력은 그대로 남는다: 스테퍼는 흔한 걸음을
                한 번의 클릭으로 만들 뿐 값을 가두지 않는다. */}
            <Field label={`국고 ${anchor} 목표 변동`} hint={`D+${params.simDays} 시점`}>
              <div className="flex items-center gap-1.5">
                <NumberField
                  value={params.baseShockBp}
                  onChange={(v) => patchParams({ baseShockBp: v })}
                  aria-label={`국고 ${anchor} 목표 변동`}
                />
                <Stepper
                  label={`국고 ${anchor} 목표 변동 ${WAYPOINT_STEP_BP}bp`}
                  onStep={(d) => {
                    const n = toNum(params.baseShockBp);
                    if (n === null) return;
                    patchParams({
                      baseShockBp: String(n + d * WAYPOINT_STEP_BP),
                    });
                  }}
                />
                <span className="shrink-0 text-body text-ink-2">bp</span>
              </div>
            </Field>

            {anchorError && (
              // 앵커 변환이 성립하지 않는 조합은 실행을 막고 **이유를 말한다.**
              // 버튼만 흐리게 하면 왜 안 되는지 물어볼 곳이 없다.
              <p className="text-body text-ink-1">{anchorError}</p>
            )}
          </div>
        </Section>

        <WaypointSection />
        <SpreadSection />
          <PolicyEventSection />
        </div>

        {/* 실행은 조건 패널의 바닥에 **고정**이다. 페이지가 스크롤하지 않으므로
            스티키가 아니라 그냥 형제 요소로 두면 된다 — 조건이 아무리 길어져도
            버튼은 언제나 같은 자리에 있다. */}
        <div className={`shrink-0 border-t border-edge py-3 pr-6 ${PAGE_L}`}>
          <Button
            variant="primary"
            size="md"
            className="w-full"
            disabled={!canRun}
            onClick={() => void runCurrent()}
          >
            시뮬레이션 실행
          </Button>
          {inputs.positions.length === 0 && (
            /* 예전에는 "data 폴더에 Portfolio Data.xlsx를 넣으면 포지션을
               읽어와요"였다. 그 워크북은 설계상 삭제됐고(직접 입력이 원천),
               없는 파일을 넣으라는 안내는 사용자를 존재하지 않는 해결책으로
               보낸다. 위 포지션 구획을 가리키는 것이 실제로 할 일이다. */
            <p className="mt-2 text-center text-body text-ink-2">
              위 포지션 구획에서 상품을 추가하면 실행할 수 있어요.
            </p>
          )}
        </div>
      </div>

      {/* 미리보기 패널. 남는 **폭과 높이를 전부** 쓴다 — 커브는 넓을수록
          잘 읽히고, 남는 공간을 흰 여백으로 두면 패널이 비어 보인다. */}
      <div className={`flex min-h-0 flex-1 flex-col py-5 pl-8 ${PAGE_R}`}>
        <CurvePreview />
      </div>
    </div>
  );
}

/** 시나리오 케이스 — 아래 네 구획(목표 금리·경로 설계·커브 스프레드·금통위
 * 이벤트)이 **어느 케이스의 것인지**를 정한다 [트레이더 피드백 2, 2026-08-07].
 *
 * 이 구획이 그 넷보다 위에 오는 이유는 순서가 곧 질문의 순서이기 때문이다:
 * 어느 케이스를 쓰는지 정하고, 그 다음에 그 케이스의 숫자를 넣는다. 아래에
 * 두면 숫자를 다 넣고 나서야 "이게 어느 케이스였지" 를 묻게 된다.
 *
 * 기간·앵커 테너·포지션은 넷이 공유한다. 그래서 이 구획이 기간(위)과 목표
 * 금리(아래) 사이에 앉는 것이 구조적으로도 맞다 — 위는 공유, 아래는 케이스별. */
function CaseSection() {
  const activeCase = useSimulationDataStore((s) => s.activeCase);
  const setActiveCase = useSimulationDataStore((s) => s.setActiveCase);

  return (
    <Section title="시나리오">
      <div className="flex flex-col gap-2 pb-4 pt-3">
        <Segmented
          options={SCENARIO_CASES.map((c) => ({ value: c.id, label: c.label }))}
          value={activeCase}
          onChange={setActiveCase}
          label="시나리오 케이스"
        />
        {/* [OWNER, 2026-08-10] 한 줄로 줄였다. 방향 관행 경고("주식의 불/베어와
            반대")는 이제 케이스 색이 대신 말한다 — 불/베어가 이 화면의 방향색
            그대로다(tokens.css --bw-case-bull/bear, CurvePreview 주석). 문장이
            했던 일을 색이 하게 되면서 문장은 무엇을 하는 화면인지만 말하면
            된다. */}
        <p className="text-callout text-ink-2">네가지 시나리오 반영을 통해서 시뮬레이션을 진행할 수 있어요.</p>
      </div>
    </Section>
  );
}

/** 경로 설계 — D+0과 마감일은 고정 핀이고, 30일 간격의 중간점만 손댈 수 있다. */
function WaypointSection() {
  const { params, patchParams } = useSimulationPort();
  const [open, setOpen] = useState(false);

  const clamp = waypointClampMax(params.baseShockBp);
  const middles = params.waypoints.filter((w) => w.day !== 0 && w.day !== params.simDays);
  const touchedCount = params.touchedWaypointDays.length;

  const set = (day: number, bp: number) =>
    patchParams(buildWaypointPatch(params, day, Math.max(-clamp, Math.min(clamp, bp))));

  return (
    <Collapsible
      title="경로 설계"
      summary={touchedCount > 0 ? `${touchedCount}개 조정함` : "직선"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {middles.length === 0 ? (
        <p className="px-4 pb-4 text-body text-ink-2">
          기간이 60일보다 짧아서 중간 지점이 없어요. 경로는 직선이에요.
        </p>
      ) : (
        <ul className="flex flex-col px-3.5 pb-4">
          {middles.map((w) => (
            <li key={w.day} className={ROW}>
              <Band />
              <span className="w-14 shrink-0 text-body text-ink-2">D+{w.day}</span>
              {/* 스테퍼는 입력 **오른쪽에 붙는다** — macOS의 자리다. 값 양옆에
                  −/+ 를 세우면 부호 있는 값에서 "−"가 한 줄에 두 번 나온다. */}
              <div className="flex flex-1 items-center gap-1.5">
                <Input
                  className="text-right"
                  inputMode="decimal"
                  aria-label={`D+${w.day} 변동폭`}
                  value={String(w.bp)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) set(w.day, n);
                  }}
                />
                <Stepper
                  label={`D+${w.day} 변동폭 ${WAYPOINT_STEP_BP}bp`}
                  onStep={(d) => set(w.day, w.bp + d * WAYPOINT_STEP_BP)}
                />
                <span className="shrink-0 text-body text-ink-2">bp</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Collapsible>
  );
}

/** 커브 스프레드 — 테너 스프레드가 국채 커브를 기울이고, 스왑 커브는 거기에
 * IRS 스프레드를 더한 것이다. 둘 다 스왑 손익에 직접 닿는다. */
function SpreadSection() {
  const { params, patchParams } = useSimulationPort();
  const [open, setOpen] = useState(false);

  // CD가 이 줄에 있었고 금통위 이벤트로 내렸다 [트레이더 피드백 4, 2026-08-07].
  // 여기서는 3M 마디에 닿지 못했다 — 이벤트가 하나라도 있으면 스왑 커브의 짧은
  // 끝은 이벤트 계단이 통째로 정하고 이 터미널 값은 무시된다. 손잡이가 있는데
  // 아무것도 안 움직이는 것보다, 실제로 움직이는 자리에 두는 것이 맞다.
  //
  // 10년에서 끊는다 [OWNER, 2026-08-06] — 북의 최장 만기가 9.67년이고 10년을
  // 넘는 스왑이 한 건도 없다. 30Y 손잡이는 어떤 포지션에도 닿지 않으면서
  // 화면만 차지했다. params.spread30y는 "0"으로 남아 커브 수학은 그대로다.
  const rows: { key: "spread1y" | "spread10y"; label: string }[] = [
    { key: "spread1y", label: "1Y" },
    { key: "spread10y", label: "10Y" },
  ];
  const nonZero = [...rows.map((r) => params[r.key]), params.irsSpread].filter(
    (v) => toNum(v) !== 0,
  ).length;

  return (
    <Collapsible
      title="커브 스프레드"
      summary={nonZero > 0 ? `${nonZero}개 설정함` : "평행"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="px-4 pb-4">
        <p className="pb-2 text-body text-ink-2">테너 스프레드 (국고 3Y 대비)</p>
        <div className="grid grid-cols-2 gap-2">
          {rows.map((r) => (
            <Field key={r.key} label={r.label}>
              <NumberField
                value={params[r.key]}
                onChange={(v) => patchParams({ [r.key]: v })}
                suffix="bp"
                aria-label={`${r.label} 스프레드`}
              />
            </Field>
          ))}
        </div>
        {/* [OWNER, 2026-08-10] "짧은 쪽(CD·오버나이트)" → "1년 이하"를 거쳐
            보간 구조를 명시하는 문장으로 — "1년과 CD 91D, 1D Call 사이가
            보간된다고 생각해야 함. 6M 9M은 보간되는거임". 엔진 그대로다
            (path-matrix.ts cumBpAt): 1D·3M(=CD 91D)은 이벤트가 그대로 정하고,
            0.25~1.0 구간은 이벤트 값과 1Y 목표 사이를 테너 비중으로 선형
            보간한다 — 6M은 그 중간, 9M은 1Y에 더 가깝게. 1Y부터는 목표만
            본다. */}
        <p className="pt-1.5 text-callout text-ink-2">
          1D·CD(91D)는 기준금리 이벤트가 그대로 정하고, 6M·9M은 그 값과 1Y
          목표 사이를 보간해요.
        </p>
        <p className="pb-2 pt-4 text-body text-ink-2">IRS 스프레드 (국채 대비)</p>
        <NumberField
          value={params.irsSpread}
          onChange={(v) => patchParams({ irsSpread: v })}
          suffix="bp"
          aria-label="IRS 스프레드"
        />
      </div>
    </Collapsible>
  );
}

/** 금통위 이벤트 — 단기 구간을 계단으로 민다. 스왑 커브의 짧은 쪽이 여기 걸린다. */
function PolicyEventSection() {
  const { params, patchParams } = useSimulationPort();
  const [open, setOpen] = useState(false);

  const events = params.shortEndEvents;
  const nextId = () => events.reduce((m, e) => Math.max(m, e.id), -1) + 1;

  return (
    <Collapsible
      title="기준금리 이벤트"
      summary={events.length > 0 ? `${events.length}건` : "없음"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="px-4 pb-4">
        {/* 두 칸이 무엇인지 먼저 말한다 — 행에는 자리가 없고, 라벨 없이 bp 칸
            둘이 나란히 서면 어느 쪽이 CD 인지 물어볼 곳이 없다.
            제목·문구 모두 [OWNER, 2026-08-10] — "금통위"는 기관명이고 트레이더가
            실제로 조작하는 것은 기준금리 그 자체다. */}
        <p className="pb-2 text-callout text-ink-2">
          기준금리 이벤트. 기준금리가 얼마나 움직이는지, CD는 기준금리 대비
          얼마나 움직이는지 알려주세요.
        </p>
        {events.length === 0 ? (
          <p className="pb-3 text-body text-ink-2">등록된 이벤트가 없어요.</p>
        ) : (
          /* 목록만 거터가 14다 (킷의 사이드바 행 인셋). 이 구획의 나머지 —
             안내 문장과 "이벤트 추가" — 는 행이 아니므로 16에 그대로 선다.
             경로 설계의 목록도 같은 14다. */
          <ul className="-mx-0.5 flex flex-col pb-2">
            {events.map((ev) => (
              <li key={ev.id} className={cn(ROW, "gap-2")}>
                <Band />
                <Input
                  type="date"
                  className="flex-1"
                  aria-label="이벤트 날짜"
                  value={ev.date}
                  onChange={(e) =>
                    patchParams({
                      shortEndEvents: events.map((x) =>
                        x.id === ev.id ? { ...x, date: e.target.value } : x,
                      ),
                    })
                  }
                />
                <NumberField
                  className="w-[76px]"
                  aria-label="기준금리 변동"
                  value={ev.shiftBp}
                  suffix="bp"
                  onChange={(v) =>
                    patchParams({
                      shortEndEvents: events.map((x) => (x.id === ev.id ? { ...x, shiftBp: v } : x)),
                    })
                  }
                />
                {/* CD 추가 [트레이더 피드백 4, 2026-08-07]. 커브 스프레드에 있던
                    손잡이를 여기로 내렸다 — 짧은 끝은 이 계단만 움직인다. */}
                <NumberField
                  className="w-[76px]"
                  aria-label="CD 추가"
                  value={ev.cdSpreadBp ?? "0"}
                  suffix="CD"
                  onChange={(v) =>
                    patchParams({
                      shortEndEvents: events.map((x) =>
                        x.id === ev.id ? { ...x, cdSpreadBp: v } : x,
                      ),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="이벤트 삭제"
                  // 칸이 셋이 되면서 자리가 빠듯해졌다. 줄이지 않으면 "삭제"가
                  // 두 줄로 접히고 행 높이가 무너진다.
                  className="shrink-0 whitespace-nowrap"
                  onClick={() =>
                    patchParams({ shortEndEvents: events.filter((x) => x.id !== ev.id) })
                  }
                >
                  삭제
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            patchParams({
              // CD 추가는 0으로 시작한다 — 기본 주장은 "CD가 기준금리만큼
              // 움직인다"이고, 그것이 아무 근거도 더하지 않는 값이다.
              shortEndEvents: [...events, { id: nextId(), date: "", shiftBp: "-25", cdSpreadBp: "0" }],
            })
          }
        >
          이벤트 추가
        </Button>
      </div>
    </Collapsible>
  );
}

/** 접히는 카드. 요약은 접힌 채로도 무엇이 설정돼 있는지 말한다 — 펼쳐야만
 * 알 수 있으면 설정된 값이 조용히 잊힌다. */
function Collapsible({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-3 px-4 py-3.5 text-left"
      >
        <span className="text-headline font-bold tracking-tight">{title}</span>
        <span className="flex items-baseline gap-2 text-body text-ink-2">
          {summary}
          {/* 킷의 disclosure 글리프 모양. 문자 "⌄"를 쓰면 글꼴마다 크기와
              굵기가 달라진다 — 스테퍼와 같은 SVG를 쓴다. */}
          <span aria-hidden className={cn("transition-transform", open && "rotate-180")}>
            <Chevron />
          </span>
        </span>
      </button>
      {open && children}
    </Section>
  );
}
