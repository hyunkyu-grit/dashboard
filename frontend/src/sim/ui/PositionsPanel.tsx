"use client";

/**
 * 직접 넣은 포지션 — 이 화면이 무엇을 평가할지 [OWNER, 2026-08-07].
 *
 * 한 줄은 **상품 하나**다: 아웃라이트·스프레드·버터플라이·포워드. 모니터 옆
 * 탭들이 세상을 나누는 방식 그대로이고, 같은 id 문법(`3Y-10Y`, `1Yx1Y`)을
 * 쓴다. 처음에는 스왑 다리 하나를 넣게 했는데, 그건 "3s10s 100억"을 넣고
 * 싶은 사람에게 다리 둘을 손으로 만들고 명목을 눈대중으로 맞추라는 소리였다.
 *
 * 다리는 백엔드가 편다(POST /api/instruments/expand) — DV01 중립 가중은
 * 기준일 커브가 있어야 하고 브라우저는 계산하지 않는다(§16). 화면은 돌아온
 * 다리를 **읽기 전용으로** 펼쳐 보여준다: 무엇이 실제로 평가되는지 보이지
 * 않으면 스프레드의 두 명목이 왜 다른지 알 길이 없다.
 *
 * 고정금리는 다리마다 **그 날 par가 기본**이다 — 그러면 진입 MtM이 0이고 결과에
 * 남는 것이 경로가 만든 손익뿐이다. 이 화면이 묻는 것이 그것이다. 다만 par가
 * 들어가 있는 그 칸을 고칠 수 있다 [트레이더 피드백 3, 2026-08-07]: 이미 들고
 * 있는 포지션을 이 경로에 놓아 보려면 진입 레벨이 par가 아니다. 옮긴 줄은 진입
 * MtM이 0이 아니게 되고, 화면이 그 사실을 말한다.
 */

import { useMemo, useState } from "react";

import { useCdRate } from "@/sim/hooks/use-cd-rate";
import { useSimulationDataStore } from "@/sim/store/simulation-data-store";
import {
  directionOptions,
  effectiveRate,
  hasRateOverride,
  KIND_LABEL,
  KIND_ORDER,
  kindOf,
  positionError,
  type ExpandedLeg,
  type InstrumentCatalog,
  type ManualPosition,
} from "@/sim/lib/manual-position";
import { Button, Field, NumberField, Section, Segmented, cn } from "@/sim/ui/primitives";

/** 돈은 억 단위로 읽는다. 다리 명목은 백엔드가 원으로 주므로 여기서 되돌린다. */
function eok(krw: number): string {
  return `${(krw / 1e8).toLocaleString(undefined, { maximumFractionDigits: 1 })}억`;
}

/** 고정금리 한 칸.
 *
 * 초안(draft) 버퍼를 따로 드는 이유: 보여줄 때는 par 와 같은 자릿수(소수 넷)로
 * 정렬돼야 하는데, 그 형식을 그대로 제어값으로 쓰면 `3.` 을 치는 순간 `3.0000`
 * 으로 되돌아가서 소수점 뒤를 칠 수가 없다. 타이핑 중에는 친 글자를 그대로 두고,
 * 칸을 떠날 때 형식으로 돌아온다. 값 자체는 칠 때마다 바로 반영된다 — 커밋을
 * blur 로 미루면 숫자를 고쳐 놓고 다른 데를 누르기 전까지 차트가 거짓말을 한다. */
function RateInput({
  label,
  value,
  off,
  onCommit,
}: {
  label: string;
  value: number;
  off: boolean;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={draft ?? value.toFixed(4)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const n = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => setDraft(null)}
      className={cn(
        "h-6 w-24 shrink-0 rounded-control-sm border border-field bg-tile px-2 text-right tabular-nums",
        off ? "text-ink" : "text-ink-2",
      )}
    />
  );
}

function LegList({
  legs,
  error,
  pending,
  position,
  onPatch,
}: {
  legs: ExpandedLeg[];
  error: string | null;
  pending: boolean;
  position: ManualPosition;
  onPatch: (patch: Partial<ManualPosition>) => void;
}) {
  if (pending) return <p className="text-callout text-ink-2">다리를 세우는 중…</p>;
  if (error) return <p className="text-callout text-up">{error}</p>;
  if (legs.length === 0) return null;

  /** 한 다리의 금리를 옮기거나(숫자) 되돌린다(null → par). */
  const setRate = (legId: string, v: number | null) => {
    const next = { ...(position.rateOverrides ?? {}) };
    if (v === null) delete next[legId];
    else next[legId] = v;
    // 남은 항목이 없으면 필드 자체를 지운다 — 빈 객체가 남으면 저장분이
    // "덮어썼다가 되돌린 줄"과 "한 번도 안 건드린 줄"을 구분 못 한 채 커진다.
    onPatch({ rateOverrides: Object.keys(next).length > 0 ? next : undefined });
  };

  const moved = hasRateOverride(legs, position);

  return (
    <div className="flex flex-col gap-0.5">
      {legs.map((l) => {
        const rate = effectiveRate(l, position);
        const off = rate !== l.couponRate;
        return (
          <div key={l.id} className="flex items-center gap-2 text-callout text-ink-2">
            {/* 다리의 부호는 상품의 방향과 다른 층위다 — 여기서는 스왑 그대로
                고정 지급/수취로 적는다. 상품 방향은 위 세그먼트가 말한다. */}
            <span className="w-14 shrink-0 tabular-nums text-ink-1">{l.tenor}</span>
            <span className="w-12 shrink-0">{l.direction === 1 ? "수취" : "지급"}</span>
            <span className="w-20 shrink-0 text-right tabular-nums">{eok(l.notional)}</span>
            {/* par 가 있던 자리가 그대로 입력칸이 된다 [트레이더 피드백 3].
                새 칸을 만들지 않는 이유: 이 줄은 이미 "이 다리는 이 금리로
                쳐진다"를 말하고 있었다. 고칠 수 있게 된 것뿐이다. */}
            <RateInput
              label={`${l.tenor} 고정금리`}
              value={rate}
              off={off}
              onCommit={(n) => setRate(l.id, n)}
            />
            <span className="shrink-0">%</span>
            {off ? (
              // 되돌릴 곳. par 가 얼마였는지도 같이 말한다 — "얼마에서 옮겼나"를
              // 물으려고 다시 계산하게 두지 않는다.
              <button
                type="button"
                onClick={() => setRate(l.id, null)}
                className="shrink-0 rounded-control-sm px-1.5 text-ink-2 underline-offset-2 hover:text-ink hover:underline"
              >
                par {l.couponRate.toFixed(4)}%로
              </button>
            ) : (
              <span className="tabular-nums">
                {l.startDate} → {l.maturityDate}
              </span>
            )}
          </div>
        );
      })}
      {moved && (
        /* 사실 하나를 말한다. par 진입은 MtM 0에서 출발하지만 옮긴 진입은
           아니다 — 결과의 평가손익에 경로가 만들지 않은 몫이 처음부터 섞여
           있다는 뜻이고, 그걸 모르면 숫자를 잘못 읽는다. */
        <p className="pt-1 text-callout text-ink-2">
          금리를 par에서 옮겼어요. 진입 시점 평가손익이 0이 아니에요.
        </p>
      )}
    </div>
  );
}

function PositionRow({
  position,
  catalog,
  legs,
  onPatch,
  onRemove,
}: {
  position: ManualPosition;
  catalog: InstrumentCatalog | undefined;
  legs: { legs: ExpandedLeg[]; error: string | null; pending: boolean };
  onPatch: (patch: Partial<ManualPosition>) => void;
  onRemove: () => void;
}) {
  const kind = kindOf(position.seriesId);
  const error = positionError(position);
  const dirs = directionOptions(position.seriesId);

  return (
    <div className="flex flex-col gap-2 border-t border-edge py-3 first:border-t-0">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="종류">
          <select
            aria-label="상품 종류"
            value={kind}
            onChange={(e) => {
              /* 종류를 바꾸면 그 종류의 첫 상품으로 간다. 예전 id를 들고
                 있으면 종류와 id가 어긋난 줄이 생긴다.
                 "첫" 은 **주요의 첫 번째**다 [2026-08-07]. 목록 순서상의 첫
                 번째는 조합이 만들어 낸 것이고(버터플라이면 6M-9M-1Y 가 아니라
                 6M-9M-1.5Y 같은 것이 앞설 수 있다), 기본값이 곧 아무도 고르지
                 않았을 때 평가되는 상품이다. 주요가 없으면 목록의 첫 번째로
                 떨어진다 — 옛 백엔드가 플래그를 안 보내는 경우가 그렇다. */
              const k = e.target.value as keyof InstrumentCatalog;
              const list = catalog?.[k] ?? [];
              const first = (list.find((o) => o.key) ?? list[0])?.id;
              // 상품이 바뀌면 다리가 달라지므로 금리 덮어쓰기를 비운다 —
              // 남겨 두면 3s10s 의 3Y 금리가 2s5s 의 2Y 다리에 조용히 붙는다.
              if (first) onPatch({ seriesId: first, rateOverrides: undefined });
            }}
            className="h-6 rounded-control-sm border border-field bg-tile px-2 text-body text-ink-1"
          >
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>

        {/* 주요가 먼저, 그 다음이 전체 [OWNER, 2026-08-07 — "56개를 스크롤해서
            고르는 건 고르는 게 아니다"].
            고를 수 있는 것은 하나도 줄지 않았다. 이 제품은 이미 표에서 주요/전체를
            가르고 있고(모니터의 각 탭), 판정도 백엔드의 같은 곳에서 나온다 —
            없던 큐레이션을 만든 게 아니라 있는 것을 여기에도 적용한 것이다.
            `<optgroup>` 인 이유: 네이티브 팝업 버튼의 문법이라 키보드 이동과
            타이핑 검색이 그대로 살아 있고, 새 메커니즘을 만들지 않는다.
            버터플라이 56개에서 주요 4개가 맨 위로 온다. */}
        <Field label="상품">
          <select
            aria-label="상품"
            value={position.seriesId}
            onChange={(e) => onPatch({ seriesId: e.target.value, rateOverrides: undefined })}
            className="h-6 rounded-control-sm border border-field bg-tile px-2 text-body text-ink-1"
          >
            {[true, false].map((wantKey) => {
              const group = (catalog?.[kind] ?? []).filter(
                (o) => Boolean(o.key) === wantKey,
              );
              if (group.length === 0) return null;
              return (
                <optgroup
                  key={String(wantKey)}
                  label={wantKey ? "주요" : "전체"}
                >
                  {group.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </Field>

        <Field label="방향">
          {/* 라벨이 종류마다 다르다 — 아웃라이트는 페이/리시브, 스프레드는
              스티프너/플래트너, 플라이는 벨리 매수/매도. 원화 데스크가 실제로
              쓰는 말이고, 규칙은 lib/manual-position.directionLabel에 있다. */}
          <Segmented
            options={dirs}
            value={position.direction === 1 ? "long" : "short"}
            onChange={(v) => onPatch({ direction: v === "long" ? 1 : -1 })}
            label="방향"
          />
        </Field>

        <Field label="명목" hint={kind === "outright" ? undefined : "기준 다리"}>
          <NumberField
            value={String(position.notionalEok)}
            onChange={(v) => onPatch({ notionalEok: Number(v) || 0 })}
            suffix="억"
            aria-label="명목"
            className="w-28"
          />
        </Field>

        <Button variant="ghost" size="sm" onClick={onRemove} aria-label="이 포지션 삭제">
          삭제
        </Button>
      </div>

      {error ? (
        <p className="text-body text-up">{error}</p>
      ) : (
        <LegList
          legs={legs.legs}
          error={legs.error}
          pending={legs.pending}
          position={position}
          onPatch={onPatch}
        />
      )}
    </div>
  );
}

export function PositionsPanel({
  baseDate,
  catalog,
  legsByRow,
  marketUnavailable,
  className,
}: {
  baseDate: string;
  catalog: InstrumentCatalog | undefined;
  legsByRow: Record<string, { legs: ExpandedLeg[]; error: string | null; pending: boolean }>;
  /** 시장 데이터를 아예 못 읽었다 — 이때는 포지션을 만들 수도 없다. */
  marketUnavailable: boolean;
  className?: string;
}) {
  const positions = useSimulationDataStore((s) => s.manualPositions);
  const add = useSimulationDataStore((s) => s.addManualPosition);
  const patch = useSimulationDataStore((s) => s.updateManualPosition);
  const remove = useSimulationDataStore((s) => s.removeManualPosition);
  const clear = useSimulationDataStore((s) => s.clearManualPositions);
  const cd = useCdRate(baseDate);

  /** 실제로 평가되는 다리 수 — 줄 수가 아니다. 스프레드 하나가 두 다리다. */
  const legCount = useMemo(
    () => Object.values(legsByRow).reduce((n, r) => n + r.legs.length, 0),
    [legsByRow],
  );

  const canAdd = Boolean(baseDate) && !marketUnavailable;

  return (
    <Section
      title="포지션"
      className={className}
      aside={
        <>
          {/* CD 3M — 이 화면이 세우는 스왑의 변동 쪽 지수다 [트레이더 피드백 4,
              2026-08-07]. 고정금리는 다리마다 적혀 있는데 그것이 무엇 대비인지는
              화면 어디에도 없었다. 헤더에 한 번만 적는다: 다리마다 반복하면
              같은 사실을 N번 말하게 된다(모든 다리가 같은 날의 같은 CD다). */}
          {cd !== null && (
            <span className="whitespace-nowrap text-[14px] tabular-nums text-ink-2">
              CD 3M {cd.toFixed(4)}%
            </span>
          )}
          {positions.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clear}>
              전체 삭제
            </Button>
          )}
        </>
      }
    >
      {marketUnavailable && (
        /* 원인을 정확히 말한다. 예전에는 이 상황이 각 행의 "그날 호가가
           없어요"로 나타났는데, 없는 것은 호가가 아니라 시장 데이터 전체이고
           고칠 곳도 행이 아니라 백엔드였다. */
        <p className="pt-3 text-body text-up">
          시장 데이터를 읽지 못했어요. 백엔드가 떠 있는지 확인해 주세요 — 포지션은 그 뒤에 넣을 수 있어요.
        </p>
      )}

      {positions.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-4">
          <p className="text-body text-ink-2">
            평가할 포지션이 없어요. 아웃라이트·스프레드·버터플라이·포워드를 넣으면 아래 금리 경로에서 어떻게
            되는지 보여드릴게요.
          </p>
          <Button variant="primary" onClick={add} disabled={!canAdd}>
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
                catalog={catalog}
                legs={legsByRow[p.id] ?? { legs: [], error: null, pending: true }}
                onPatch={(patchIn) => patch(p.id, patchIn)}
                onRemove={() => remove(p.id)}
              />
            ))}
          </div>
          <div className={cn("flex items-center justify-between gap-3 border-t border-edge py-3")}>
            <span className="text-body text-ink-2">
              {`${positions.length}개 상품 · 스왑 ${legCount}다리`}
            </span>
            <Button variant="secondary" size="sm" onClick={add} disabled={!canAdd}>
              포지션 추가
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}
