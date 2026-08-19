'use client';

/* Main — 목록이 아니라 **세 열** [v1 OWNER, 2026-07-31].
 *
 * 전에는 모든 종목이 한 표에 있었고, 그건 그것들을 배열하는 가장 쓸모없는 방법이다:
 * 아웃라이트 15 · 스프레드 28 · 포워드 140 이 정렬키로 뒤섞여서, 금리 화면을 여는
 * 이유("지금 세 블록이 어디 있나")에 답하는 데 스크롤이 필요했다. 지금은 고정된
 * 오버뷰다 — **주요 아웃라이트 · 주요 스프레드 · 주요 포워드**가 나란히, 각자 자기
 * 차트를 밑에 달고 선다.
 *
 * **버터플라이와 변동성은 일부러 없다.** 세 열이라는 것이 요점이고, 넷째·다섯째를
 * 붙이면 이건 다시 목록이 된다.
 *
 * ── 표의 격자를 그대로 쓴다 [v1 OWNER — "이거랑 동일하게"] ──────────────────
 * `InstrumentTable` 그대로다. v1 이 여기서 전용 격자를 따로 짰다가 한 세션에 두 번
 * 어긋난 뒤 되돌린 자리이고, 그 모듈 주석이 **다시 갈라내지 말라**고 적어 두었다.
 * 폭이 좁아 열이 빠지는 것은 표의 우선순위 사다리가 알아서 한다 — v2 는 그 사다리가
 * 있고 v1 은 없었으므로, 열을 못박는 대신 사다리에 맡기는 것이 이 리포의 답이다.
 *
 * ── 한 열이 한 차트를 갖는다 ────────────────────────────────────────────────
 * 어느 행을 누르면 **그 열에서만** 그려진다. 세 사람의 질문에 한 번에 답할 수 있고,
 * 열을 옮겨 다녀도 이미 화면에 있는 비교가 사라지지 않는다. 각 열은 자기 첫 행으로
 * 열린다 — 자리가 비어 있지 않고, 누르지 않아도 뭘 할 수 있는지 보인다.
 *
 * ── 차트 높이는 **고정 200** [v1 OWNER, 2026-07-31] ────────────────────────
 * "폰트사이즈를 키우고 커브사이즈를 줄이면 되지 않을까". 이 화면의 주인공은 숫자고
 * 커브는 각주인데, 차트가 그 반대였다(표 250px 밑에 차트 369px). 고정이면 "세 차트
 * 한 높이"가 **구성상** 참이 된다 — 재서 맞추던 장치가 통째로 필요 없어진다.
 */

import { useMemo, useState } from 'react';

import { HStack, VStack } from '@coinbase/cds-web/layout';
import { TextLabel1 } from '@coinbase/cds-web/typography';

import type { PolicyStep } from '@/lib/api';
import { InstrumentTable } from '@/table/InstrumentTable';
import { cmpKey, GROUP_LABEL, type Group, type Row } from '@/table/rows';
import { PreviewPane } from '@/ui/PreviewPane';

/** 세 열, 이 순서. 넷째는 없다 — 모듈 주석 참조. */
export const OVERVIEW_GROUPS: Group[] = ['outright', 'spread', 'forward'];

/** 고정 차트 높이 [v1 OWNER]. 숫자가 주인공이고 커브는 각주다. */
const CHART_H = 200;

/** 열 제목 줄이 먹는 높이. */
const TITLE_H = 36;

/** 미리보기 pane 전체 — 차트 위의 히어로(값+변화)와 기간 알약, 기준선 범례,
 * 여백까지. 실측 2026-08-14: 차트 200 일 때 pane 은 350 이었다. **2026-08-18 에
 * 기준선 범례 한 줄(16px + 아래 여백 8)이 pane 에 추가돼 374 가 됐다** — 350 인
 * 채로 두자 flex 가 플롯 상자를 27px 눌렀고, 고정 200px 차트의 날짜 줄이 범례
 * 밑으로 새어 글자가 겹쳤다(오너 신고). 표에 남길 높이를 계산할 때 빼야 하는
 * 것은 차트가 아니라 이 값이고, **pane 에 줄이 늘면 이 숫자도 는다.** */
const PANE_H = 374;

function Column({
  group,
  rows,
  policy,
  levelHeader,
  levelHeaderTitle,
  height,
}: {
  group: Group;
  rows: Row[];
  policy: PolicyStep;
  levelHeader: string;
  levelHeaderTitle: string;
  height: number;
}) {
  /* **주요만**, 그리고 백엔드가 준 정렬키 순서. 무엇이 주요인지는 서버가 정한다
     (`derive.is_key`) — 프론트가 자기 목록을 들면 이 화면과 표가 갈린다. */
  const shown = useMemo(
    () => rows.filter((r) => r.group === group && r.key).sort((a, b) => cmpKey(a.sortKey, b.sortKey)),
    [rows, group],
  );

  /* 열이 자기 첫 행으로 열린다 — 빈 자리를 남기지 않고, 누르지 않아도 이 차트가
     행을 따라간다는 것이 보인다. */
  const [selectedId, setSelectedId] = useState<string>();
  const [hoveredId, setHoveredId] = useState<string>();
  const shownRow =
    shown.find((r) => r.id === hoveredId) ?? shown.find((r) => r.id === selectedId) ?? shown[0];

  return (
    <VStack className="sr-card" flexGrow={1} flexBasis={0} minWidth={0} minHeight={0}>
      <VStack paddingX={2} paddingTop={1.5} paddingBottom={0.5}>
        <TextLabel1 as="h2" noWrap>
          주요 {GROUP_LABEL[group]}
        </TextLabel1>
      </VStack>
      <InstrumentTable
        rows={shown}
        onSelect={(r) => setSelectedId(r.id)}
        onHover={(r) => setHoveredId(r?.id)}
        selectedId={selectedId ?? shown[0]?.id}
        levelHeader={levelHeader}
        levelHeaderTitle={levelHeaderTitle}
        height={Math.max(160, height - TITLE_H - PANE_H)}
        /* 좁은 세 열이 열을 떨구는 건 이 화면의 설계다 — 같은 안내가 세 번
           반복되면 소음이라 여기서는 끈다(끄는 근거는 표 쪽 prop 주석). */
        quietLadderNote
      />
      <PreviewPane row={shownRow} policy={policy} height={CHART_H} chartOnly />
    </VStack>
  );
}

export function OverviewColumns({
  rows,
  policy,
  levelHeader,
  levelHeaderTitle,
  height,
}: {
  rows: Row[];
  policy: PolicyStep;
  levelHeader: string;
  levelHeaderTitle: string;
  /** 세 열이 나눠 갖는 세로. 카드가 받은 높이 그대로다. */
  height: number;
}) {
  return (
    <HStack gap={2} width="100%" alignItems="stretch" flexGrow={1} minHeight={0}>
      {OVERVIEW_GROUPS.map((g) => (
        <Column
          key={g}
          group={g}
          rows={rows}
          policy={policy}
          levelHeader={levelHeader}
          levelHeaderTitle={levelHeaderTitle}
          height={height}
        />
      ))}
    </HStack>
  );
}
