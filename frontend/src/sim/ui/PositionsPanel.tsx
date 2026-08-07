"use client";

/**
 * 직접 입력한 포지션들 — 이 화면이 무엇을 평가할지 [OWNER, 2026-08-07].
 *
 * 북(`Portfolio Data.xlsx`)이 한동안 쓰이지 않는다. 질문이 "내 북이 어떻게
 * 되나"에서 "**이 포지션을 이 금리 경로에 두면 어떻게 되나**"로 바뀌었고,
 * 그 질문의 입력은 손으로 넣는 몇 줄이다.
 *
 * ─ 테너가 만기의 주인이다 ────────────────────────────────────────────────
 * 한 줄은 방향·테너·명목·고정금리로 읽힌다. 테너를 고르면 만기일이 따라오고
 * (시작일 + n년), 고정금리는 그날의 시장 par로 채워진다. 그 상태의 포지션은
 * 진입 MtM이 0이라, 결과에 남는 것이 **경로가 만든 손익뿐**이다 — 묻고 있는
 * 것이 정확히 그것이다.
 *
 * 날짜와 금리는 그대로 고칠 수 있다. 이미 보유 중인 포지션은 par에 있지 않고
 * 시작일도 과거이기 때문이다. 두 경우가 같은 표에서 표현된다.
 *
 * ─ 왜 셀 편집이지 폼이 아닌가 ────────────────────────────────────────────
 * 포지션은 서로 비교하면서 넣는다("3년 받고 10년 주면?"). 한 줄씩 모달을
 * 여는 형태는 그 비교를 화면 밖으로 밀어낸다. 행이 곧 입력이면 네 줄을
 * 나란히 두고 숫자만 바꿔볼 수 있다.
 */

import { useMemo } from "react";

import { useSimulationDataStore } from "@/sim/store/simulation-data-store";
import {
  parRatePct,
  positionError,
  TENORS,
  withStartDate,
  withTenor,
  type ManualPosition,
  type ParQuote,
  type TenorLabel,
} from "@/sim/lib/manual-position";
import { Button, Field, Input, NumberField, Section, Segmented, cn } from "@/sim/ui/primitives";

const DIRECTION_OPTIONS = [
  { value: "recv", label: "고정 수취" },
  { value: "pay", label: "고정 지급" },
] as const;

/** 행 하나. ConfigureStage의 목록 행과 같은 32px 사다리 위에 있지만, 이 행은
 * 입력칸을 여럿 물고 있어 한 칸으로는 좁다 — 두 줄로 접는다. */
function PositionRow({
  position,
  parPct,
  onPatch,
  onRemove,
}: {
  position: ManualPosition;
  parPct: number | null;
  onPatch: (patch: Partial<ManualPosition>) => void;
  onRemove: () => void;
}) {
  const error = positionError(position, parPct);
  return (
    <div className="relative isolate flex flex-col gap-2 border-t border-edge py-3 first:border-t-0">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="방향">
          <Segmented
            options={DIRECTION_OPTIONS}
            value={position.direction === 1 ? "recv" : "pay"}
            onChange={(v) => onPatch({ direction: v === "recv" ? 1 : -1 })}
            label="고정 수취 / 고정 지급"
          />
        </Field>

        <Field label="테너">
          {/* 네이티브 select다. 아홉 개를 세그먼트로 늘어놓으면 폼 폭을 넘고,
              이 셸에는 드롭다운 프리미티브가 없다. */}
          <select
            aria-label="테너"
            value={position.tenor}
            onChange={(e) => onPatch(withTenor(position, e.target.value as TenorLabel))}
            className="h-6 rounded-control-sm border border-field bg-tile px-2 text-body text-ink-1"
          >
            {TENORS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="명목">
          <NumberField
            value={String(position.notionalEok)}
            onChange={(v) => onPatch({ notionalEok: Number(v) || 0 })}
            suffix="억"
            aria-label="명목"
            className="w-28"
          />
        </Field>

        <Field
          label="고정금리"
          /* 비워 두면 par로 간다는 사실을 라벨 옆에서 말한다. 빈 칸이 0으로
             읽히면 사용자는 0% 스왑을 평가한 줄 모르고 결과를 믿는다. */
          hint={
            position.fixedRatePct === ""
              ? parPct !== null
                ? `시장 par ${parPct.toFixed(4)}%`
                : "그날 호가 없음"
              : "직접 입력"
          }
        >
          <NumberField
            value={position.fixedRatePct === "" ? "" : String(position.fixedRatePct)}
            onChange={(v) => onPatch({ fixedRatePct: v === "" ? "" : Number(v) })}
            suffix="%"
            placeholder={parPct !== null ? parPct.toFixed(4) : "—"}
            aria-label="고정금리"
            className="w-32"
          />
        </Field>

        <Button variant="ghost" size="sm" onClick={onRemove} aria-label="이 포지션 삭제">
          삭제
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="시작일">
          <Input
            type="date"
            value={position.startDate}
            onChange={(e) => onPatch(withStartDate(position, e.target.value))}
          />
        </Field>
        <Field label="만기일" hint={`${position.tenor} 기준`}>
          <Input
            type="date"
            value={position.maturityDate}
            onChange={(e) => onPatch({ maturityDate: e.target.value })}
          />
        </Field>
      </div>

      {error && <p className="text-body text-up">{error}</p>}
    </div>
  );
}

export function PositionsPanel({
  baseDate,
  parQuotes,
  bookError,
  className,
}: {
  baseDate: string;
  parQuotes: readonly ParQuote[];
  /** 북 읽기가 실패했는지. 알림일 뿐 이 화면을 막지 않는다. */
  bookError: boolean;
  className?: string;
}) {
  const positions = useSimulationDataStore((s) => s.manualPositions);
  const add = useSimulationDataStore((s) => s.addManualPosition);
  const patch = useSimulationDataStore((s) => s.updateManualPosition);
  const remove = useSimulationDataStore((s) => s.removeManualPosition);
  const clear = useSimulationDataStore((s) => s.clearManualPositions);

  /* 순명목이 아니라 방향별 합계다. 수취 100억과 지급 100억을 합쳐 0이라고
     적으면 두 다리짜리 포지션이 "없음"으로 보인다. */
  const totals = useMemo(() => {
    let recv = 0;
    let pay = 0;
    for (const p of positions) {
      if (p.direction === 1) recv += p.notionalEok;
      else pay += p.notionalEok;
    }
    return { recv, pay };
  }, [positions]);

  return (
    <Section
      title="포지션"
      /* `first`가 아니다 — 기간 구획 다음에 오므로 위 헤어라인이 있어야
         한다. 첫 구획만 그것을 생략하는 이유는 헤더의 경계선과 겹쳐 두 줄이
         되기 때문이고, 여기는 그 자리가 아니다. */
      className={className}
      aside={
        positions.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            전체 삭제
          </Button>
        ) : undefined
      }
    >
      {bookError && (
        /* 북이 안 읽혔다는 사실은 알리되 길을 막지 않는다 — 이 화면은 손입력
           만으로 완결된다. 예전에는 이 자리가 정지 화면이었다. */
        <p className="pt-3 text-body text-ink-2">
          저장된 북은 읽지 못했어요. 아래에 직접 넣은 포지션으로 돌아갑니다.
        </p>
      )}

      {positions.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-4">
          <p className="text-body text-ink-2">
            평가할 포지션이 없어요. 스왑을 넣으면 아래 금리 경로에서 어떻게 되는지 보여드릴게요.
          </p>
          <Button variant="primary" onClick={() => add(baseDate)} disabled={!baseDate}>
            포지션 추가
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col">
            {positions.map((p) => (
              <PositionRow
                key={p.id}
                position={p}
                parPct={parRatePct(parQuotes, p.tenor)}
                onPatch={(patchIn) => patch(p.id, patchIn)}
                onRemove={() => remove(p.id)}
              />
            ))}
          </div>
          <div className={cn("flex items-center justify-between gap-3 border-t border-edge py-3")}>
            <span className="text-body text-ink-2">
              {`수취 ${totals.recv.toLocaleString()}억 · 지급 ${totals.pay.toLocaleString()}억`}
            </span>
            <Button variant="secondary" size="sm" onClick={() => add(baseDate)} disabled={!baseDate}>
              포지션 추가
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}
