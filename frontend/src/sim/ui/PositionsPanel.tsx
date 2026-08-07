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
 * 고정금리 입력칸은 없다. 다리마다 그 날 par로 쳐지므로 진입 MtM이 0이고,
 * 결과에 남는 것은 **경로가 만든 손익뿐**이다. 이 화면이 묻는 것이 그것이다.
 */

import { useMemo } from "react";

import { useSimulationDataStore } from "@/sim/store/simulation-data-store";
import {
  directionOptions,
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

function LegList({ legs, error, pending }: { legs: ExpandedLeg[]; error: string | null; pending: boolean }) {
  if (pending) return <p className="text-callout text-ink-2">다리를 세우는 중…</p>;
  if (error) return <p className="text-callout text-up">{error}</p>;
  if (legs.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {legs.map((l) => (
        <div key={l.id} className="flex items-baseline gap-2 text-callout text-ink-2">
          {/* 다리의 부호는 상품의 방향과 다른 층위다 — 여기서는 스왑 그대로
              고정 지급/수취로 적는다. 상품 방향은 위 세그먼트가 말한다. */}
          <span className="w-14 shrink-0 tabular-nums text-ink-1">{l.tenor}</span>
          <span className="w-12 shrink-0">{l.direction === 1 ? "수취" : "지급"}</span>
          <span className="w-20 shrink-0 text-right tabular-nums">{eok(l.notional)}</span>
          <span className="w-20 shrink-0 text-right tabular-nums">{l.couponRate.toFixed(4)}%</span>
          <span className="tabular-nums">
            {l.startDate} → {l.maturityDate}
          </span>
        </div>
      ))}
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
              if (first) onPatch({ seriesId: first });
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
            onChange={(e) => onPatch({ seriesId: e.target.value })}
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
        <LegList legs={legs.legs} error={legs.error} pending={legs.pending} />
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
        positions.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            전체 삭제
          </Button>
        ) : undefined
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
