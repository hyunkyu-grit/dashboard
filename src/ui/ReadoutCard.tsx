'use client';

/* 커서 아래 값을 읽는 **카드** — 한 컴포넌트, 두 표면 [v1 `ui/ReadoutCard.tsx` 포팅].
 *
 * 히스토리 선의 툴팁과 아이들 커브의 툴팁은 x 축만 다를 뿐 같은 질문에 답한다:
 * "커서 밑의 숫자는 얼마이고, 자기 52주 안에서 어디쯤인가". 그래서 카드도 줄도
 * 순서도 서식도 하나다 — 두 벌이 되면 같은 양을 두 문법으로 말하게 되고, 이
 * 리포는 그 실패를 이미 출하한 적이 있다(캐리·롤이 성분과 헤드라인을 따로
 * 반올림해서 합이 1만원 어긋났다).
 *
 * 두 호출자가 각자 가진 것은 **x 가 무엇인가** 뿐이다 — 선에는 날짜, 커브에는
 * 만기. 그게 카드의 `title` 이고 나머지는 같다.
 *
 * ── 왜 CDS `Scrubber` 의 라벨이 아닌가 ──────────────────────────────────────
 * CDS 는 스크러버 선 위에 **한 줄짜리** 라벨을 그려준다(`Scrubber.label`). 여섯
 * 줄짜리 표를 그 한 줄에 욱여넣으면 읽을 수 없고, SVG 안이라 줄 정렬도 직접
 * 좌표로 해야 한다. 카드는 HTML 이 훨씬 잘하는 일이라 밖에 둔다 — 위치를 잡는
 * 인덱스만 CDS 에서 받는다(`onScrubberPositionChange`).
 *
 * ── 여기서는 아무것도 반올림하지 않는다 ────────────────────────────────────
 * 레벨은 `fmtLevel`, 변화는 `fmtDelta` 를 지난다. 이 파일에 `toFixed` 는 없고
 * `guards/readout-card.test.tsx` 가 그걸 지킨다. 색도 규칙대로다 — 레벨은 방향이
 * 없으므로 잉크이고, **부호 있는 변화 한 줄만** 색을 가진다.
 */

import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Text, TextLabel2 } from '@coinbase/cds-web/typography';

import type { Unit } from '@/lib/api';
import { fmtDelta, fmtLevel } from '@/lib/format';
import { fmtKrw } from '@/lib/krw';

/** 카드의 고정 폭. 호출자가 `left` 를 이 값으로 클램프해서 카드가 그림 밖으로
 * 나가지 않게 한다 — 복사본이 아니라 진짜 숫자로 재도록 내보낸다. */
export const READOUT_CARD_W = 148;

/** 카드가 찍는 라벨, 그리는 순서대로. 두 표면이 공유한다.
 *
 * `CD 91일` 은 v2 에서 추가된 줄이다 [OWNER 2026-08-14: "날짜, 레벨, 52주
 * 최고·최저·평균, CD91 금리가 나와야 함"]. v1 은 종목 차트의 카드에 기준선 값을
 * 싣지 않았고(`ui/readouts.ts` 의 키 목록에 아예 없다), 대신 백테스트의 구성
 * 금리 패널에서만 같은 이름으로 찍었다. 그 이름을 그대로 가져온다 — 같은 값에
 * 표면마다 다른 이름을 붙이지 않기 위해서다. */
export const READOUT_LABEL = {
  level: '레벨',
  rangeHigh: '52주 최고',
  rangeLow: '52주 최저',
  rangeAvg: '52주 평균',
  cd91: 'CD 91일',
  dailyChange: '당일 변화',
} as const;

/**
 * 떠 있는 카드. **커서의 x 만 따라가고 y 는 그림 위쪽에 고정**된다 — 두 축을 다
 * 따라가는 카드는 움직이는 선 위에서 읽기 어렵고, y 는 이미 스크러버 선과 점이
 * 표시하고 있다.
 *
 * `pointer-events: none` 이 중요하다. 카드는 차트 위에 떠 있으므로, 이게 없으면
 * 카드가 커서를 가로채 스크러버가 멈추고 카드 자신이 얼어붙는다.
 */
/** 카드가 그림 밖으로 나가지 않게 하는 클램프.
 *
 * v1 은 노드의 x 로 스냅했지만(`x(hIdx) + 10`), 그건 v1 이 자기 SVG 를 직접
 * 그려서 그 좌표를 알고 있었기 때문이다. CDS 는 그리는 쪽이라 축 라벨 폭까지
 * 포함한 내부 기하를 우리에게 주지 않는다 — 그 계산을 여기서 다시 하면 두 벌이
 * 되고, 두 벌은 CDS 가 눈금 폭을 바꾸는 날 어긋난다. 그래서 **커서의 x 를
 * 그대로** 쓴다. 카드가 읽는 값은 CDS 가 준 인덱스라 여전히 노드에 스냅돼 있다.
 *
 * 2026-08-20: 미리보기 pane 안에만 있던 것을 여기로 옮겼다 — 시뮬 차트도 같은
 * 카드를 띄우게 되면서 두 화면이 각자 클램프하면 언젠가 갈린다. */
export function readoutLeft(x: number, boxW: number, width = READOUT_CARD_W): number {
  return Math.min(Math.max(boxW - width - 8, 0), Math.max(0, x + 12));
}

export function ReadoutCard({
  title,
  left,
  width = READOUT_CARD_W,
  children,
}: {
  title: string;
  left: number;
  /** 기본은 차트 카드의 148. 줄이 더 긴 표면(RV 사분면 — 버퍼 "+10.8bp
   * (1.2σ)" 병기)은 자기 폭을 넘기고 **left 클램프도 같은 값으로** 한다 —
   * 폭만 넓히면 카드 오른쪽이 그림 밖으로 나간다(2026-08-19, 사분면 실측:
   * 148 안에서 값이 카드 밖으로 삐져나왔다 [OWNER]). */
  width?: number;
  children: React.ReactNode;
}) {
  return (
    <VStack className="sr-readout" style={{ left, width }} aria-hidden="true">
      <TextLabel2 as="span" noWrap>
        {title}
      </TextLabel2>
      <Box className="sr-readout-rows">{children}</Box>
    </VStack>
  );
}

/** 레벨 한 줄: 왼쪽에 이름, 오른쪽에 값. 잉크, 등폭 숫자. */
export function ReadoutLevel({
  k,
  v,
  unit,
}: {
  k: string;
  v: number | null | undefined;
  unit: Unit;
}) {
  return (
    <HStack justifyContent="space-between" gap={1}>
      <TextLabel2 as="span" color="fgMuted" noWrap>
        {k}
      </TextLabel2>
      <TextLabel2 as="span" tabularNumbers noWrap>
        {fmtLevel(v, unit)}
      </TextLabel2>
    </HStack>
  );
}

/** 돈 한 줄. 레벨 줄과 같은 문법이고 형식만 억/만이다 — 시뮬의 성분 경로가
 * 쓴다. 색은 안 가진다(변화 줄만 색을 갖는다, 아래 참조). */
export function ReadoutMoney({ k, v }: { k: string; v: number | null | undefined }) {
  /* 위의 레벨 줄들은 `TextLabel2` shorthand 를 쓰지만 그건 기존 코드다. 새로
     쓰는 것은 `Text font="label2"` — 시각은 같고, CLAUDE.md 가 새 코드의
     shorthand 사용을 금지한다(타이포 래칫이 그걸 센다). */
  return (
    <HStack justifyContent="space-between" gap={1}>
      <Text as="span" font="label2" color="fgMuted" noWrap>
        {k}
      </Text>
      <Text as="span" font="label2" tabularNumbers noWrap>
        {v == null ? '—' : fmtKrw(v)}
      </Text>
    </HStack>
  );
}

/**
 * 부호 있는 **변화** 줄 — 카드에서 색을 가지는 유일한 줄이고, 그것이 위의 레벨
 * 줄들이 색을 안 가지는 이유다. 위쪽에 여백을 두는 이유는 이게 위 네 줄의 또
 * 다른 통계가 아니라 **다른 양**이기 때문이다.
 */
export function ReadoutChange({
  k,
  v,
  unit,
}: {
  k: string;
  v: number | null | undefined;
  unit: Unit;
}) {
  /* v1 의 `dirClass` 는 `text-up` 같은 v1 클래스를 돌려준다 — v2 에는 없는
     이름이라 부르지 않는다. 이 리포의 방향 클래스는 `theme/direction.css` 의
     `sr-up` / `sr-down` / `sr-flat` 셋이다. */
  const tone = v == null || v === 0 ? 'sr-flat' : v > 0 ? 'sr-up' : 'sr-down';
  return (
    <HStack justifyContent="space-between" gap={1} className="sr-readout-change">
      <TextLabel2 as="span" color="fgMuted" noWrap>
        {k}
      </TextLabel2>
      <TextLabel2 as="span" tabularNumbers noWrap className={tone}>
        {fmtDelta(v, unit)}
      </TextLabel2>
    </HStack>
  );
}
