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
import { anchorConversionError, toNum } from "@/sim/lib/scenario-curves";
import {
  WAYPOINT_STEP_BP,
  buildWaypointPatch,
  lerpDefaultBp,
  waypointClampMax,
} from "@/sim/lib/waypoints";
import { ANCHOR_TENOR_CHOICES, type AnchorTenor } from "@/sim/types/simulation-port";

import { CurvePreview } from "./CurvePreview";

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
  const { latestDataDate } = useBook();

  const anchor: AnchorTenor = params.anchorTenor ?? "3Y";
  const anchorError = anchorConversionError(params);
  const canRun = inputs.positions.length > 0 && status !== "running" && !anchorError;

  // 지평이나 목표가 바뀌면 30일 간격의 중간 웨이포인트를 다시 만든다.
  // **손대지 않은** 중간점은 {simDays, baseShockBp}를 향한 직선 위의 값으로
  // 되돌아가고, 손댄 점은 바이트 그대로 보존된다. 손댔는지는 명시적 플래그로
  // 안다 — 값이 같은지로 추론하면 우연히 직선 위에 놓인 편집이 지워진다.
  // 스토어에서 최신 상태를 직접 읽는 이유는 웨이포인트에 대한 낡은 클로저를
  // 피하기 위해서다.
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
  }, [params.simDays, params.baseShockBp]);

  const baseDate = inputs.baseDate;
  const endDate = addDaysIso(baseDate, params.simDays);

  return (
    /* 2단. 전폭 셸에서 폼을 가로로 늘이면 라벨과 입력란이 멀어져 읽기 힘들어
       지므로, 조건은 왼쪽 한 칼럼에 모으고 남는 폭은 미리보기가 쓴다.
       패널 사이는 세로 헤어라인 하나. */
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[520px] shrink-0 flex-col border-r border-edge">
        <div className={`min-h-0 flex-1 overflow-y-auto pb-6 pr-6 ${PAGE_L}`}>
          <Section title="기간" first>
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
              {inputs.positions.length > 0
                ? `스왑 ${inputs.positions.length.toLocaleString()}건을 평가해요`
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

            <Field label={`국고 ${anchor} 목표 변동`} hint={`D+${params.simDays} 시점`}>
              <NumberField
                value={params.baseShockBp}
                onChange={(v) => patchParams({ baseShockBp: v })}
                suffix="bp"
                aria-label={`국고 ${anchor} 목표 변동`}
              />
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
            <p className="mt-2 text-center text-body text-ink-2">
              data 폴더에 Portfolio Data.xlsx를 넣으면 포지션을 읽어와요.
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

  // CD는 다른 테너 스프레드와 같은 줄에 둔다 — 3M도 커브 위의 한 점이고,
  // 사용자가 커브를 기울일 때 짧은 쪽부터 만진다.
  // 10년에서 끊는다 [OWNER, 2026-08-06] — 북의 최장 만기가 9.67년이고 10년을
  // 넘는 스왑이 한 건도 없다. 30Y 손잡이는 어떤 포지션에도 닿지 않으면서
  // 화면만 차지했다. params.spread30y는 "0"으로 남아 커브 수학은 그대로다.
  const rows: { key: "spreadCd" | "spread1y" | "spread10y"; label: string }[] = [
    { key: "spreadCd", label: "CD 3M" },
    { key: "spread1y", label: "1Y" },
    { key: "spread10y", label: "10Y" },
  ];
  const nonZero = [...rows.map((r) => params[r.key] ?? "0"), params.irsSpread].filter(
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
        <div className="grid grid-cols-3 gap-2">
          {rows.map((r) => (
            <Field key={r.key} label={r.label}>
              <NumberField
                value={params[r.key] ?? "0"}
                onChange={(v) => patchParams({ [r.key]: v })}
                suffix="bp"
                aria-label={`${r.label} 스프레드`}
              />
            </Field>
          ))}
        </div>
        <p className="pt-1.5 text-callout text-ink-2">
          CD는 3M 마디만 움직여요. 오버나이트는 금통위 경로가 정해요.
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
      title="금통위 이벤트"
      summary={events.length > 0 ? `${events.length}건` : "없음"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="px-4 pb-4">
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
                  className="w-32"
                  aria-label="이벤트 변동폭"
                  value={ev.shiftBp}
                  suffix="bp"
                  onChange={(v) =>
                    patchParams({
                      shortEndEvents: events.map((x) => (x.id === ev.id ? { ...x, shiftBp: v } : x)),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="이벤트 삭제"
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
              shortEndEvents: [...events, { id: nextId(), date: "", shiftBp: "-25" }],
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
