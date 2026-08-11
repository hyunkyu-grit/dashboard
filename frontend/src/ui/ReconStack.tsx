"use client";

/* 일별 대사 스택 [OWNER, 2026-08-11 — "탭 1개에 KRD·Bp변화·PnL변화를 몰아야
 * … 1일차 KRD, BP변화, PnL를 각각 가로줄로 구성해서 쌓아서 80일치면 240개의
 * 가로줄"].
 *
 * 하루가 가로줄 **셋**이다: KRD(전일 종가 = 그날 아침의 테너별 감도 —
 * 추정이 곱한 바로 그 값 [OWNER, 2026-08-11 — "전일걸 가져와서 붙이는게
 * 대사하기 편하지 않을까"]) · Δbp(테너별 금리 변화) · 손익(KRD × Δbp 선형
 * 추정). 세 줄이 같은 블록 안에서 곱셈으로 닫히므로 눈이 전일 블록으로
 * 오갈 일이 없다. 마지막 블록은 이월 앵커다 — 마지막 날의 종가 KRD(다음
 * 영업일로 들고 가는 리스크)만 있고 Δbp·손익·하루 요약은 null(—) 이다.
 * 종전의 렌즈 토글(하나씩 갈아 끼우기)은 트레이딩 시스템 화면과 나란히
 * 놓고 줄 단위로 맞춰 보는 대사를 못 한다 — 시스템 쪽은 세 값이 같이
 * 보이는데 이쪽은 한 번에 하나만 보였다. 80영업일이면 240줄이 나오는 것이
 * 요구사항 그 자체다.
 *
 * 날짜와 하루 요약(평가·캐리·롤다운·그날 손익)은 **rowSpan=3** — 하루에 한
 * 번인 사실을 세 번 반복하지 않는다. 행 단위 합계 칸만 줄마다 다르다:
 * KRD 줄은 테너 합(= 평행 DV01), Δbp 줄은 비움(테너 합이 무의미), 손익
 * 줄은 엔진의 추정 합계. 대사 문장은 열 순서가 그대로 말한다 — 손익 줄의
 * 합계(추정) vs 평가 = 선형화 잔차, 평가 + 캐리 + 롤다운 = 그날 손익.
 *
 * 백테스트 창과 시뮬레이션 결과가 **같은 컴포넌트**를 쓴다 — WindowDrawer 의
 * 전례("껍데기가 두 벌이면 '둘 다에 존재한다'가 곧 거짓"). 틴트 헬퍼는 공용
 * theme/sign-tint 에서 온다 — `@/sim/**` 을 여기서 값-임포트하면 동적
 * 임포트 하나로만 들어가야 하는 시뮬 서브트리가 첫 로드 경로에 실린다
 * (guards/lazy-chart; 그 이사의 경위는 sim/theme/tint.ts 의 재수출 노트).
 *
 * 표 규율은 시뮬 일별 대사 표(ResultsTables.KrdDailyTable)에서 그대로 왔다:
 *   - 대사 표는 **원 단위 그대로** [OWNER, 2026-08-10] — 자릿수가 곧 판단.
 *   - 전 테너 열이 그대로 선다 [OWNER, 2026-08-12 — "물리적으로 잘린
 *     테너들도 복원"]. KRD 가 전 기간 0인 열을 숨기던 구 폭 규율("좌우
 *     스크롤 하기 싫음")은 은퇴했다 — 폭은 마우스 드래그 팬(useDragScroll)
 *     이 받고, 0 인 열은 — 로 선다: 리스크가 없다는 사실도 대사의 일부다.
 *   - 날짜·구분 열은 스티키다 — 팬으로 먼 테너를 보는 중에도 어느 날의
 *     어느 줄인지가 안 잘린다(ForwardMatrix 의 스크롤 어포던스 전례).
 *   - 열 폭은 세 지표의 최장 문자열로 잰다(`ch`) — 줄마다 폭이 다르면
 *     격자가 세로로 안 읽힌다.
 *   - KRD 줄은 히트맵(배경=부호, 농도=크기, 글자는 잉크), Δbp·손익 줄은
 *     방향색 텍스트 — tint.ts 의 "한 셀 한 채널" 규칙.
 *   - Δbp 는 소수 둘째 자리(하루 0.17bp 가 정수 반올림에 지워진다). */

import { useState } from "react";

import { directionVar, tintFor } from "@/theme/sign-tint";
import { useDragScroll } from "./useDragScroll";

export interface ReconStackDay {
  /** ISO date — the row key and the printed MM-DD */
  date: string;
  /** tooltip; carries the year and (시뮬) the D+n */
  title?: string;
  krd: Record<string, number>;
  dbp: Record<string, number | null>;
  est: Record<string, number>;
  /** null on the carry-over anchor block — a day that hasn't happened. */
  estTotal: number | null;
  valuation: number | null;
  carry: number | null;
  rolldown: number | null;
  actual: number | null;
}

/** 원 단위 그대로, 부호 포함 — ResultsTables.MoneyWon 과 같은 규칙(만/억
 * 접기 금지: 24,141이 "2만"이면 시스템의 24,141과 맞는지 말할 수 없다). */
function Won({ v }: { v: number | null | undefined }) {
  if (typeof v !== "number") return <span className="text-ink-3">—</span>;
  return (
    <span style={{ color: directionVar(v) }}>
      {`${v > 0 ? "+" : ""}${Math.round(v).toLocaleString("en-US")}`}
    </span>
  );
}

function Th({ children, center, right, corner, style }: {
  children: React.ReactNode;
  center?: boolean;
  right?: boolean;
  /** 날짜·구분 헤더 — 가로 팬에도 남는 왼쪽 스티키 모서리(본문 스티키 열과
   * 같은 좌표). z 가 한 칸 높은 이유: 팬 중에 보통 헤더가 이 밑을 지난다. */
  corner?: boolean;
  /** 스티키 left 좌표 — `ch` 는 요소 자신의 font-size 로 풀리므로, 13px
   * 헤더가 14px 표의 컬럼 트랙과 같은 자리를 가리키려면 호출자가 환산해
   * 넘긴다(아래 구분 헤더의 calc). */
  style?: React.CSSProperties;
}) {
  return (
    <th
      style={style}
      className={`sticky top-0 bg-tile py-2 text-[13px] font-normal text-ink-2 ${
        corner ? "left-0 z-20" : "z-10"
      } ${center ? "text-center" : right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

type Metric = "krd" | "dbp" | "est";
const METRIC_LABEL: Record<Metric, string> = { krd: "KRD", dbp: "Δbp", est: "손익" };

function cellText(metric: Metric, v: number | null): string {
  if (v === null || v === 0) return "—";
  return metric === "dbp" ? v.toFixed(2) : Math.round(v).toLocaleString();
}

/** 최장 문자열 글자 수 + 좌우 여백 — ResultsTables.tenorWidth 와 같은 방법. */
function tenorWidth(labels: string[], cells: string[]): string {
  const longest = Math.max(...labels.map((s) => s.length), ...cells.map((s) => s.length), 4);
  return `calc(${longest}ch + 8px)`;
}

export function ReconStack({
  days,
  tenors,
  note,
  defaultOrder = "asc",
}: {
  /** ASCENDING chronological order, always — the display order is this
   * component's own state (아래 정렬 토글), not the caller's arrangement. */
  days: ReconStackDay[];
  tenors: string[];
  /** 표 아래 한 줄 — 잘린 창(백테스트 truncated) 같은 데이터 사실. */
  note?: string;
  /** 첫 표시 방향 [OWNER, 2026-08-11 — "날짜는 오름차순 내림차순 선택할 수
   * 있게"]. 기본값이 표면마다 다른 이유는 데이터의 성격이다: 백테스트는
   * 실제 이력이라 최신이 위(desc — 대사는 보통 어제·오늘부터), 시뮬레이션은
   * 미래 경로라 시간순(asc — D+0 이 위, 2026-08-10 룰링). 토글은 그 기본을
   * 읽는 사람이 뒤집을 수 있게 할 뿐이다. */
  defaultOrder?: "asc" | "desc";
}) {
  const [order, setOrder] = useState<"asc" | "desc">(defaultOrder);
  const { ref: dragRef, handlers: dragHandlers } = useDragScroll<HTMLDivElement>();
  if (days.length === 0) {
    return (
      <p className="py-6 text-center text-[14px] text-ink-2">
        이 실행에는 일별 대사가 없어요.
      </p>
    );
  }
  const shown = order === "asc" ? days : [...days].reverse();

  const tenorW = tenorWidth(
    tenors,
    days.flatMap((d) =>
      (["krd", "dbp", "est"] as const).flatMap((m) =>
        tenors.map((t) => cellText(m, d[m][t] ?? null)),
      ),
    ),
  );

  // 히트맵 농도의 기준은 표 전체의 max|KRD| — 날마다 다시 잡으면 작은 날의
  // 작은 값이 큰 날의 큰 값과 같은 진하기가 된다.
  const krdScale = Math.max(
    ...days.flatMap((d) => tenors.map((t) => Math.abs(d.krd[t] ?? 0))),
    0,
  );

  const rowTotal = (d: ReconStackDay, m: Metric): number | null => {
    if (m === "krd") return tenors.reduce((s, t) => s + (d.krd[t] ?? 0), 0);
    if (m === "est") return d.estTotal;
    return null; // Δbp 의 테너 합은 아무 뜻이 없다
  };

  return (
    /* 잡아 끌 수 있는 표면 [OWNER, 2026-08-12 — "좌우로 드래그"] — 전 테너
       열이 서면서 폭이 창을 넘는 것이 정상 상태가 됐다. 휠·스크롤바·터치는
       원래대로 살아 있고, 마우스 드래그가 더해진 것이다. */
    <div ref={dragRef} {...dragHandlers} className="cursor-grab overflow-x-auto">
      <table
        className="w-full table-fixed text-[14px] tabular-nums"
        style={{
          minWidth: `calc(7ch + 5ch + ${tenors.length} * (${tenorW}) + 5 * 11ch)`,
        }}
      >
        <colgroup>
          <col style={{ width: "7ch" }} />
          <col style={{ width: "5ch" }} />
          {tenors.map((t) => (
            <col key={t} style={{ width: tenorW }} />
          ))}
          {/* 꼬리 열 11ch — 한글 헤더("합계(추정)")가 접히지 않는 폭. */}
          <col style={{ width: "11ch" }} />
          <col style={{ width: "11ch" }} />
          <col style={{ width: "11ch" }} />
          <col style={{ width: "11ch" }} />
          <col style={{ width: "11ch" }} />
        </colgroup>
        <thead>
          <tr>
            {/* 날짜 헤더가 곧 정렬 토글이다 — InstrumentTable 의 정렬 헤더와
                같은 문법(버튼 + " ↑"/" ↓" 접미). 정렬 대상이 날짜 하나뿐이라
                화살표는 항상 보인다: 지금 방향이 상태이고, 누르면 뒤집힌다. */}
            <Th corner>
              <button
                type="button"
                onClick={() => setOrder(order === "asc" ? "desc" : "asc")}
                className="hover:text-ink"
                title={order === "asc" ? "오래된 날짜부터 — 누르면 최신부터" : "최신 날짜부터 — 누르면 오래된 것부터"}
              >
                날짜{order === "asc" ? " ↑" : " ↓"}
              </button>
            </Th>
            {/* 13px 헤더의 ch ≠ 14px 트랙의 ch — 날짜 트랙(7ch@14px)만큼
                왼쪽으로 붙이려면 환산이 필요하다(Th 의 style 주석). */}
            <Th corner style={{ left: "calc(7ch * 14 / 13)" }}>구분</Th>
            {tenors.map((t) => (
              <Th key={t} center>
                {t}
              </Th>
            ))}
            <Th right>합계</Th>
            <Th right>평가</Th>
            <Th right>캐리</Th>
            <Th right>롤다운</Th>
            <Th right>그날 손익</Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((d) =>
            (["krd", "dbp", "est"] as const).map((m, mi) => {
              const total = rowTotal(d, m);
              return (
                <tr
                  key={`${d.date}-${m}`}
                  // 하루의 경계만 헤어라인 — 세 줄이 한 덩어리로 읽힌다.
                  className={mi === 0 ? "border-t border-edge" : undefined}
                >
                  {/* 날짜·구분은 스티키 — 팬으로 먼 테너를 보는 중에도 행의
                      정체성이 남는다. 불투명 bg 는 §G(sticky-opaque): 밑을
                      지나는 히트맵 틴트가 비치면 안 된다. 구분 셀의 13px 는
                      안쪽 span 에 있다 — td 가 13px 면 left 의 ch 가 트랙과
                      다른 자로 풀린다(위 헤더와 같은 함정). */}
                  {mi === 0 && (
                    <td
                      className="sticky left-0 bg-popover py-1 pr-2 align-top"
                      rowSpan={3}
                      title={d.title ?? d.date}
                    >
                      {d.date.slice(5)}
                    </td>
                  )}
                  <td className="sticky bg-popover py-1 pr-2" style={{ left: "7ch" }}>
                    <span className="text-[13px] text-ink-2">{METRIC_LABEL[m]}</span>
                  </td>
                  {tenors.map((t) => {
                    const v = d[m][t] ?? null;
                    return (
                      <td
                        key={t}
                        className="py-1 pl-2 text-center"
                        style={
                          m === "krd"
                            ? { background: tintFor(v ?? 0, krdScale) }
                            : v === null || v === 0
                              ? undefined
                              : { color: directionVar(v) }
                        }
                      >
                        {v === null || v === 0 ? (
                          <span className="text-ink-3">—</span>
                        ) : (
                          cellText(m, v)
                        )}
                      </td>
                    );
                  })}
                  <td className="py-1 pl-2 text-right font-medium">
                    {total === null ? (
                      <span className="text-ink-3">—</span>
                    ) : m === "krd" ? (
                      Math.round(total).toLocaleString()
                    ) : (
                      <Won v={total} />
                    )}
                  </td>
                  {mi === 0 && (
                    <>
                      <td className="py-1 pl-2 text-right align-top" rowSpan={3}>
                        <Won v={d.valuation} />
                      </td>
                      <td className="py-1 pl-2 text-right align-top" rowSpan={3}>
                        <Won v={d.carry} />
                      </td>
                      <td className="py-1 pl-2 text-right align-top" rowSpan={3}>
                        <Won v={d.rolldown} />
                      </td>
                      <td className="py-1 pl-2 text-right align-top font-medium" rowSpan={3}>
                        <Won v={d.actual} />
                      </td>
                    </>
                  )}
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
      {note && <p className="pt-2 text-[13px] text-ink-2">{note}</p>}
    </div>
  );
}
