"use client";

/* 현금채권 / 자산스왑 — Backtest 섹션의 여섯째·일곱째 [OWNER, 2026-08-14].
 *
 * 한 컴포넌트가 두 탭을 그린다. `kind` 만 다르고 나머지는 같은 화면이라
 * 파일을 둘로 쪼개면 같은 코드가 두 벌이 된다 — 다른 것은 유니버스와 단위
 * (%가 bp가 되는 것)뿐이고, 그 둘은 서버가 행에 실어 준다.
 *
 * **셸의 두 판 문법 그대로다** [OWNER, 2026-08-14 — "우측에 원래는 시계열
 * 그래프 보여줬는데 … 같은 양식 같은 크기로"]: 왼쪽이 표(TABLE_W), 오른쪽이
 * 그 행의 시계열, 백테스트는 창. 아웃라이트에서 하던 동선이 그대로여야 한다.
 *
 * §16 은 그대로 — 수준·변화·백분위·52주·세타를 전부 서버가 내고
 * (`backend/app/cashbond.py:instruments`), 여기서는 그리기만 한다.
 *
 * 이 화면은 **전부 라이브**다. 민평이 SQL 에만 있어 정적 쌍둥이를 구울 수
 * 없다 — 백엔드가 없으면 표부터 안 뜨고, 그렇게 말한다.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  BacktestUnavailable,
  fetchCashBondInstruments,
  fetchCashBondSeries,
  type CashBondKind,
  type CashBondRow,
  type CashBondSeries,
  type PolicyStep,
} from "@/lib/api";
import { levelHeadText } from "@/lib/format";
import { useFundingStore } from "@/state/funding";

import { CashBondTable } from "./CashBondTable";
import { CashBondWindow } from "./CashBondWindow";
import { ErrorState, LoadingState } from "./DataState";
import { GroupBox, GroupBoxGap, GroupBoxNote, GroupBoxTitle } from "./GroupBox";
import { PAGE_X } from "./pageGutter";
import { PreviewChart } from "./PreviewChart";
import { useMeasure } from "./useMeasure";

/** 표 폭. 셸의 `TABLE_W`(880)에 **종목 열을 넓힌 만큼**을 더한 값이다 —
 * `CASHBOND_LABEL_W`(200px)가 IRS 의 라틴 9글자 트랙(~100px)보다 100px 넓고,
 * 그만큼 안 주면 꼬리의 세타 열이 잘린다(실측). 이 화면은 `fullWidth` 라 셸의
 * 두 판 분배를 안 타고 자기 안에서 나누므로 여기서 정한다. */
const TABLE_W = 980;
/** 오른쪽 판의 좌우 여백 — 셸의 미리보기 판과 같은 수(PAGE_X + 디바이더 인셋). */
const PANE_PAD = 32 + 12;
/** 판 높이에서 차트가 못 쓰는 몫: 그룹박스 헤더(h-9 = 36) + 안쪽 여백(p-3 위아래
 * 24). 차트가 **판을 꽉 채워야** 한다 [OWNER, 2026-08-14 — "밑에 칸에 공백을
 * 남기고 칸을 작게 쓰고 있음 꽉 채워서 써. 스왑처럼"] — 고정 360 을 박아 두었더니
 * 창이 클수록 아래가 비었다. 셸의 미리보기 판이 `paneH − PANE_PAD` 로 하는 것과
 * 같은 처리다. */
const PANE_CHROME_H = 36 + 24;
/** 짧은 창에서의 바닥 — 이보다 낮으면 선이 뭉개진다(셸의 CHART_MIN_H 와 같은 값). */
const CHART_MIN_H = 320;

const TITLE: Record<CashBondKind, { label: string; note: string }> = {
  CB: { label: "현금채권", note: "민평 수익률 · 3개월 이표채로 가정" },
  ASW: { label: "자산스왑", note: "민평 − IRS · 같은 만기 · 같은 명목" },
};

export function CashBondView({
  kind,
  policy,
}: {
  kind: CashBondKind;
  policy?: PolicyStep;
}) {
  const hydrate = useFundingStore((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  const basis = useFundingStore((s) => s.basis);
  const spreadBp = useFundingStore((s) => s.spreadBp);

  const [bondType, setBondType] = useState<string | null>(null);
  const [hovered, setHovered] = useState<CashBondRow | null>(null);
  const [pinned, setPinned] = useState<CashBondRow | null>(null);
  /** 백테스트 창을 연 종목. 표의 핀과 **다른 상태**다 — 핀은 오른쪽 판이 무엇을
   * 그리는지이고, 이것은 창이 떠 있는지다(아웃라이트에서 `?bt=` 가 핀과 별개인
   * 것과 같다). */
  const [openId, setOpenId] = useState<string | null>(null);
  const [paneRef, paneW, paneH] = useMeasure<HTMLDivElement>();

  const { data, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["cashbond", "instruments", basis, spreadBp],
    queryFn: () => fetchCashBondInstruments({ basis, spreadBp }),
    retry: 1,
  });

  /** 이 탭의 유니버스 = 한 갈래 전부. 종목군 칩은 그 위의 필터다. */
  const universe = useMemo(
    () => (data ? data.rows.filter((r) => r.kind === kind) : []),
    [data, kind],
  );
  const rows = useMemo(
    () => universe.filter((r) => bondType === null || r.bondType === bondType),
    [universe, bondType],
  );

  const shownRow = hovered ?? pinned;
  const series = useQuery<CashBondSeries>({
    queryKey: ["cashbond", "series", shownRow?.id ?? ""],
    queryFn: () => fetchCashBondSeries(shownRow!.id),
    enabled: !!shownRow,
    retry: 1,
  });

  if (isError) {
    return (
      <ErrorState
        what={
          error instanceof BacktestUnavailable
            ? `${TITLE[kind].label} 표를 (백엔드가 필요해요)`
            : `${TITLE[kind].label} 표를`
        }
        onRetry={() => void refetch()}
        retrying={isFetching}
      />
    );
  }
  if (!data) return <LoadingState what={TITLE[kind].label} />;

  const chartW = Math.max(0, paneW - PANE_PAD);
  const chartH = Math.max(CHART_MIN_H, paneH - PANE_CHROME_H);

  return (
    <div className={`flex min-h-0 flex-1 gap-4 ${PAGE_X}`}>
      {/* 왼쪽 — 표 */}
      <div className="flex min-h-0 shrink-0 flex-col" style={{ width: TABLE_W }}>
        <div className="flex flex-wrap items-center gap-1.5 pt-4">
          <button
            type="button"
            aria-pressed={bondType === null}
            onClick={() => setBondType(null)}
            className={`flex h-6 items-center rounded-control px-3 text-[13px] font-medium transition-colors ${
              bondType === null
                ? "bg-ink text-page"
                : "border border-edge opacity-65 hover:opacity-100"
            }`}
          >
            전체
          </button>
          {data.types.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={bondType === t.id}
              onClick={() => setBondType(t.id)}
              /* 아웃라이트에서 은퇴한 스크리너 칩과 **같은 모양**을 쓴다
                 [OWNER, 2026-08-14]: 잉크 알약이 켜진 상태, 꺼진 것은 테두리.
                 탭(액센트)과 필터(잉크)를 구분하던 그 규칙이 여기서도 맞다 —
                 탭은 목록을 고르고 칩은 그것을 좁힌다. */
              className={`flex h-6 items-center rounded-control px-3 text-[13px] font-medium transition-colors ${
                bondType === t.id
                  ? "bg-ink text-page"
                  : "border border-edge opacity-65 hover:opacity-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {rows.length === 0 ? (
            // 없는 조합은 빈 표가 아니라 문장이다 — 통안채 자산스왑처럼 만기가
            // 겹치지 않아 애초에 설 수 없는 칸이 있다.
            <p className="pt-6 text-center text-[13px] opacity-50">
              고른 조합에는 행이 없어요. 통안채는 3년까지만 있고, 자산스왑은 채권과
              IRS 양쪽에 있는 만기에만 서요.
            </p>
          ) : (
            <CashBondTable
              rows={rows}
              asOf={data.asof}
              activeId={shownRow?.id ?? null}
              pinnedId={pinned?.id ?? null}
              onHover={setHovered}
              onPin={(r) => {
                setPinned(r);
                setOpenId(r.id);
              }}
            />
          )}
        </div>

        <p className="shrink-0 py-2 text-[13px] opacity-45">
          세타는 {data.thetaBasis.horizonMonths}개월 · 매수 기준 · 조달{" "}
          {data.thetaBasis.funding.label} 를 뺀 순캐리예요. 행을 누르면 백테스트
          창이 열려요.
        </p>
      </div>

      {/* 오른쪽 — 그 행의 시계열. 셸의 미리보기 판과 같은 그룹박스·같은 높이. */}
      <div ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col py-4">
        <GroupBox
          className="h-full"
          header={
            <>
              <GroupBoxTitle>{shownRow ? shownRow.label : TITLE[kind].label}</GroupBoxTitle>
              <GroupBoxGap />
              <GroupBoxNote>
                {shownRow ? levelHeadText(data.asof) : TITLE[kind].note}
              </GroupBoxNote>
            </>
          }
        >
          <div className="relative min-h-0 flex-1 overflow-hidden p-3">
            {!shownRow ? (
              <p className="pt-10 text-center text-[14px] opacity-45">
                행에 마우스를 올리면 그 종목의 시계열이 여기 떠요.
              </p>
            ) : series.isError ? (
              <p className="pt-10 text-center text-[14px] opacity-55">
                시계열을 읽지 못했어요. 백엔드가 필요한 화면이에요.
              </p>
            ) : series.data && series.data.points.length >= 2 && chartW > 0 ? (
              <PreviewChart
                points={series.data.points}
                stats={series.data.stats}
                unit={series.data.unit}
                width={chartW}
                height={chartH}
                policy={policy}
              />
            ) : (
              <p className="pt-10 text-center text-[14px] opacity-45">
                불러오는 중이에요…
              </p>
            )}
          </div>
        </GroupBox>
      </div>

      {openId && (
        <CashBondWindow
          key={openId}
          rows={universe}
          types={data.types}
          asOf={data.asof}
          minDate={data.from}
          initialId={openId}
          policy={policy}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
