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
 *     스크롤 하기 싫음")은 은퇴했다 — 0 인 열은 — 로 선다: 리스크가
 *     없다는 사실도 대사의 일부다.
 *   - 넘치는 폭은 **보이는 스크롤바**가 받는다 [OWNER, 같은 날 2차 —
 *     "마우스로 잡아 끄는게 아니라 좌우 스크롤이 가능하게"]: 이 컴포넌트가
 *     양축 스크롤 컨테이너(높이 캡)라서 가로 바는 표 바닥이 아니라 눈앞의
 *     컨테이너 바닥에, 세로 바는 우측에 상시 선다(globals.css 의 킷
 *     스크롤바 — 얇은 캡슐, 오버레이가 아니라 항상 그려진다). 같은 지시로
 *     먼저 만들었던 드래그 팬(useDragScroll)은 같은 날 걷어냈다.
 *   - **범례는 사방 고정이다** [OWNER, 같은 날 2차 — "좌우의 범례 …
 *     열과 행 고정"]: 테너 헤더 행은 위(sticky top), 날짜·구분 열은
 *     왼쪽, 합계·평가·캐리·롤다운·그날 손익 열은 오른쪽에 붙어 스크롤이
 *     움직여도 남는다 — 격자 가운데(테너 × 날짜)만 흐른다.
 *   - 열 폭은 세 지표의 최장 문자열로 잰다(`ch`) — 줄마다 폭이 다르면
 *     격자가 세로로 안 읽힌다.
 *   - KRD 줄은 히트맵(배경=부호, 농도=크기, 글자는 잉크), Δbp·손익 줄은
 *     방향색 텍스트 — tint.ts 의 "한 셀 한 채널" 규칙.
 *   - Δbp 는 소수 둘째 자리(하루 0.17bp 가 정수 반올림에 지워진다). */

import { useState } from "react";

import { directionVar, tintFor } from "@/theme/sign-tint";

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

function Th({ children, center, right, pin, style }: {
  children: React.ReactNode;
  center?: boolean;
  right?: boolean;
  /** 모서리 범례(날짜·구분·요약 다섯) — 세로 스크롤의 top 에 더해 가로
   * 좌표까지 고정된다. left/right 는 style 로 받는다: `ch` 가 요소 자신의
   * font-size 로 풀리므로, 13px 헤더가 14px 표의 컬럼 트랙과 같은 자리를
   * 가리키려면 호출자가 `calc(Nch * 14 / 13)` 로 환산해 넘긴다. z 가 한 칸
   * 높은 이유: 가로 스크롤 중 테너 헤더가 이 밑을 지난다. */
  pin?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <th
      style={style}
      className={`sticky top-0 bg-tile py-2 text-[13px] font-normal text-ink-2 ${
        pin ? "z-20" : "z-10"
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
  heightClass = "max-h-[60vh]",
}: {
  /** ASCENDING chronological order, always — the display order is this
   * component's own state (아래 정렬 토글), not the caller's arrangement. */
  days: ReconStackDay[];
  tenors: string[];
  /** 표 아래 한 줄 — 잘린 창(백테스트 truncated) 같은 데이터 사실. */
  note?: string;
  /** 스크롤 컨테이너의 세로 캡. 이 컴포넌트가 자기 안에서 세로로 스크롤해야
   * 헤더 행 고정이 성립하고, 가로 스크롤바가 (수천 px 표의 바닥이 아니라)
   * 눈앞의 컨테이너 바닥에 선다. 백테스트 서랍은 서랍 자체 캡(38vh) 안에
   * 들어가도록 더 작게 준다 — 바깥 서랍이 스크롤하기 시작하면 고정이 도로
   * 깨진다(스크롤러는 하나여야 한다). */
  heightClass?: string;
  /** 첫 표시 방향 [OWNER, 2026-08-11 — "날짜는 오름차순 내림차순 선택할 수
   * 있게"]. 기본값이 표면마다 다른 이유는 데이터의 성격이다: 백테스트는
   * 실제 이력이라 최신이 위(desc — 대사는 보통 어제·오늘부터), 시뮬레이션은
   * 미래 경로라 시간순(asc — D+0 이 위, 2026-08-10 룰링). 토글은 그 기본을
   * 읽는 사람이 뒤집을 수 있게 할 뿐이다. */
  defaultOrder?: "asc" | "desc";
}) {
  const [order, setOrder] = useState<"asc" | "desc">(defaultOrder);
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
    <div>
      {/* 양축 스크롤러 [OWNER, 2026-08-12 2차 — "좌우 스크롤이 가능하게"] —
          전 테너 열이 서면서 폭이 창을 넘는 것이 정상 상태가 됐다. 높이
          캡이 있어야 가로 바가 눈앞에 서고 헤더 행 고정이 성립한다(프롭
          주석). 캡션은 스크롤러 밖 — 스크롤과 무관하게 늘 보인다. */}
      <div className={`${heightClass} overflow-auto`}>
        {/* 폭은 `w-full`+minWidth 가 아니라 **정확한 명시 폭**이다: table-fixed
            는 표 폭과 <col> 합이 다르면 차이를 트랙에 재분배하는데(실측
            11ch → 91.7px 압축), 그러면 ch 로 적은 sticky right 오프셋과
            실제 트랙 경계가 어긋나 고정 열 사이로 밑 내용이 슬리버로 샌다.
            폭 == 트랙 합이면 재분배가 0 이라 오프셋이 자로 맞는다. */}
        <table
          className="table-fixed text-[14px] tabular-nums"
          style={{
            width: `calc(7ch + 5ch + ${tenors.length} * (${tenorW}) + 5 * 11ch)`,
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
              <Th pin style={{ left: 0 }}>
                <button
                  type="button"
                  onClick={() => setOrder(order === "asc" ? "desc" : "asc")}
                  className="hover:text-ink"
                  title={order === "asc" ? "오래된 날짜부터 — 누르면 최신부터" : "최신 날짜부터 — 누르면 오래된 것부터"}
                >
                  날짜{order === "asc" ? " ↑" : " ↓"}
                </button>
              </Th>
              {/* 13px 헤더의 ch ≠ 14px 트랙의 ch — 트랙 좌표는 전부 환산해
                  넘긴다(Th 의 style 주석). 왼쪽 범례는 날짜(7ch) 다음. */}
              <Th pin style={{ left: "calc(7ch * 14 / 13)" }}>구분</Th>
              {tenors.map((t) => (
                <Th key={t} center>
                  {t}
                </Th>
              ))}
              {/* 오른쪽 범례 다섯 — 뒤에서부터 11ch 트랙씩 쌓인다. */}
              <Th right pin style={{ right: "calc(44ch * 14 / 13)" }}>합계</Th>
              <Th right pin style={{ right: "calc(33ch * 14 / 13)" }}>평가</Th>
              <Th right pin style={{ right: "calc(22ch * 14 / 13)" }}>캐리</Th>
              <Th right pin style={{ right: "calc(11ch * 14 / 13)" }}>롤다운</Th>
              <Th right pin style={{ right: 0 }}>그날 손익</Th>
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
                    {/* 왼쪽 범례 — 스크롤로 먼 테너를 보는 중에도 어느 날의
                        어느 줄인지가 남는다. 불투명 bg 는 §G(sticky-opaque):
                        밑을 지나는 히트맵 틴트가 비치면 안 된다. 구분 셀의
                        13px 는 안쪽 span 에 있다 — td 가 13px 면 left 의 ch 가
                        트랙과 다른 자로 풀린다(헤더와 같은 함정). */}
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
                    {/* 오른쪽 범례 — 본문 셀은 표 폰트(14px 레귤러)라 `ch` 가
                        트랙과 같은 자로 풀린다(헤더만 환산). ⚠ 오프셋을 진
                        셀에 font-medium 을 얹으면 안 된다: ch 는 그 요소
                        폰트의 '0' 진행폭이고 미디엄의 0 이 살짝 넓어 44ch 가
                        13px 어긋난다(실측) — 굵기는 안쪽 span 이 진다.
                        불투명 bg 는 §G. */}
                    <td className="sticky bg-popover py-1 pl-2 text-right" style={{ right: "44ch" }}>
                      <span className="font-medium">
                        {total === null ? (
                          <span className="text-ink-3">—</span>
                        ) : m === "krd" ? (
                          Math.round(total).toLocaleString()
                        ) : (
                          <Won v={total} />
                        )}
                      </span>
                    </td>
                    {mi === 0 && (
                      <>
                        <td
                          className="sticky bg-popover py-1 pl-2 text-right align-top"
                          style={{ right: "33ch" }}
                          rowSpan={3}
                        >
                          <Won v={d.valuation} />
                        </td>
                        <td
                          className="sticky bg-popover py-1 pl-2 text-right align-top"
                          style={{ right: "22ch" }}
                          rowSpan={3}
                        >
                          <Won v={d.carry} />
                        </td>
                        <td
                          className="sticky bg-popover py-1 pl-2 text-right align-top"
                          style={{ right: "11ch" }}
                          rowSpan={3}
                        >
                          <Won v={d.rolldown} />
                        </td>
                        <td
                          className="sticky bg-popover py-1 pl-2 text-right align-top"
                          style={{ right: 0 }}
                          rowSpan={3}
                        >
                          <span className="font-medium">
                            <Won v={d.actual} />
                          </span>
                        </td>
                      </>
                    )}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      {note && <p className="pt-2 text-[13px] text-ink-2">{note}</p>}
    </div>
  );
}
