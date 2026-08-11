"use client";

/** 데이터 신선도 (§ Pass C). 파일이 정적이라 이게 없으면 어제 커브를 오늘 것처럼
 * 조용히 보여준다. 크기가 나이에 따라 커진다(영업일 기준): 당일은 조용히 날짜만,
 * 하루 뒤처지면 보이는 칩, 그 이상이면 빨간 테두리 칩이 말로 적는다.
 * 흑백 우선: 테두리·굵기·문장이 뜻을 나르고 빨강은 얹히는 층이다 (§5).
 * 폴링하므로 탭을 오래 열어 둬도 나이가 흐른다.
 *
 * 2026-08-07 에 App.tsx 의 툴바에서 나와 **지표 바(최하단)** 로 갔다 [OWNER].
 * 파일이 따로 생긴 이유는 그것뿐이다 — 툴바와 지표 바가 서로를 import 할 수는
 * 없다. 동작은 한 줄도 안 바뀌었다. */

import { useQuery } from "@tanstack/react-query";

import { type DataSource, fetchHealth } from "@/lib/api";

/* 출처 칩 [OWNER, 2026-08-11 "엑셀데이터에 연결되어있다고 말은 해줘야 해"].
 * "sql" 이 정상 경로라 그때는 아무것도 안 그린다 — 조용함이 기본값이고,
 * 엑셀이 섞인 날만 말이 생긴다. title 이 어느 조각이 엑셀인지 적는다. */
const SOURCE_NOTE: Partial<Record<DataSource, { chip: string; title: string }>> = {
  "sql+xlsx-1d": {
    chip: "엑셀 연결 — 1D",
    title: "SQL에 1D(콜금리)가 없어 1D만 엑셀 값으로 채웠어요",
  },
  "sql+xlsx-day": {
    chip: "엑셀 연결 — 전일",
    title: "SQL에 전일 종가가 없어 전일 하루를 엑셀에서 가져왔어요",
  },
  xlsx: {
    chip: "엑셀 연결 — 전체",
    title: "SQL을 읽지 못해 엑셀 데이터로 보여드리고 있어요",
  },
};

function SourceChip({ source }: { source?: DataSource }) {
  const note = source ? SOURCE_NOTE[source] : undefined;
  if (!note) return null;
  return (
    <span
      title={note.title}
      className="rounded-control border border-edge px-2 py-0.5 text-[13px] text-ink"
    >
      {note.chip}
    </span>
  );
}

export function DataFreshness() {
  const { data } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  const f = data?.freshness;
  if (!f) return null;

  const asOf = `${f.asOf} 기준`;
  const title = `데이터 최신일 ${f.asOf} · 오늘 ${f.today} · ${f.ageBusinessDays}영업일 경과`;
  const chip = <SourceChip source={data?.source} />;

  if (f.level === "stale") {
    return (
      <span className="inline-flex items-center gap-1.5">
        {chip}
        <span
          title={title}
          className="rounded-control border border-up px-2 py-0.5 text-[13px] font-semibold text-up"
        >
          데이터 {f.ageBusinessDays}영업일 지연 — 최신 커브가 아닐 수 있어요 · {f.asOf}
        </span>
      </span>
    );
  }
  if (f.level === "behind") {
    return (
      <span className="inline-flex items-center gap-1.5">
        {chip}
        <span
          title={title}
          className="rounded-control border border-edge px-2 py-0.5 text-[13px] text-ink"
        >
          {asOf} · {f.ageBusinessDays}영업일 지연
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {chip}
      <span title={title} className="text-[13px] text-ink-2">
        {asOf}
      </span>
    </span>
  );
}
