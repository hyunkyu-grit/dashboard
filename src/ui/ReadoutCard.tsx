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

/** 카드가 커질 수 있는 **상한**. 폭 자체는 CSS 가 `max-content` 로 잡는다
 * (`.sr-readout`) — 카드는 자기 가장 긴 줄만큼만 넓다.
 *
 * ## 왜 고정 폭을 버렸나
 *
 * 2026-08-19 까지 이 값은 **고정 폭 148** 이었고, 호출부가 자기 최장 줄을
 * 계산해서 넘겨야 했다. 두 명이 연속으로 그 함정에 빠졌다:
 *
 *   RvScatter   "버퍼 +10.8bp (1.2σ)" 가 삐져나감 → 오너 지적 후 200 으로 [08-19]
 *   ResultsWindow  "스왑롤다운 −12억 3,456만원" ≈ 213px → 148 에서 65px 초과 [08-20]
 *
 * 두 번째는 **첫 번째의 교훈이 코드에 있었는데도** 났다. 호출부가 알아야만
 * 맞는 기본값은 기본값이 아니라 함정이다. 이제 아무도 몰라도 된다.
 *
 * 상한은 클램프의 기준이기도 하다 — `readoutLeft` 가 실제 폭 대신 이 값을 쓰면
 * 카드가 그림 밖으로 나가는 일은 **폭과 무관하게** 없다. 대가는 오른쪽
 * 가장자리에서 좁은 카드가 필요보다 조금 일찍 멈추는 것이고, 값이 카드 밖으로
 * 나가는 것보다 그쪽이 낫다. */
export const READOUT_CARD_MAX = 260;

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
export function readoutLeft(x: number, boxW: number, width = READOUT_CARD_MAX): number {
  return Math.min(Math.max(boxW - width - 8, 0), Math.max(0, x + 12));
}

/** 커서 자리를 **상자에 적는다**. 카드는 CSS 로 그 값을 읽는다
 * (`.sr-readout { left: var(--sr-readout-x) }`).
 *
 * ## 왜 상태가 아니라 CSS 변수인가
 *
 * 자리는 픽셀마다 바뀌는데 그 값이 먹이는 것은 **CSS 속성 하나**뿐이다. 상태로
 * 두면 마우스가 움직일 때마다 컴포넌트 전체가 다시 그려진다 — 표 넷과 차트
 * 둘을 든 시뮬 결과 창에서는 그게 공짜가 아니다
 * (`rerender-use-ref-transient-values`, 2026-08-20 검증 라운드).
 *
 * 카드가 아니라 **상자**에 적는 이유: 카드는 커서가 값 위에 있을 때만 마운트돼
 * 있어서, 카드 노드에 직접 쓰면 없는 노드에 쓰는 순간이 생긴다. 상자는 늘
 * 있고, CSS 변수는 아래로 상속된다 — 카드가 언제 서든 마지막 자리를 안다.
 *
 * 클램프는 여기서 한 번만 일어난다. 2026-08-20 이전에는 네 표면이 같은 식을
 * 각자 복제하고 있었다. */
export const READOUT_X_VAR = '--sr-readout-x';

export function placeReadout(el: HTMLElement | null, clientX: number): void {
  if (!el) return;
  const box = el.getBoundingClientRect();
  el.style.setProperty(READOUT_X_VAR, `${readoutLeft(clientX - box.left, box.width)}px`);
}

export function ReadoutCard({
  title,
  left,
  children,
}: {
  title: string;
  /** 픽셀 자리. **생략하면** 카드는 담긴 상자의 `--sr-readout-x` 를 읽는다 —
   * 그쪽이 기본이고, 그래야 커서를 따라다니는 데 리렌더가 필요 없다
   * (`readoutLeft` 로 이미 클램프된 값을 상자에 적어 둔다).
   *
   * 명시적으로 넘기는 자리는 커서가 아니라 **데이터 좌표**에 붙는 카드다
   * (RV 사분면의 강조 점). 그건 hover 가 없어도 서야 하므로 x 가 상태다. */
  left?: number;
  children: React.ReactNode;
}) {
  return (
    <VStack
      className="sr-readout"
      style={left == null ? undefined : { left }}
      aria-hidden="true"
    >
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

/** 숫자가 아닌 **사실** 한 줄 — 「밴드 밖 3일째」·「보유 6봉째」 같은 것.
 *
 * 레벨·돈 줄과 같은 격자(왼쪽 뮤트 라벨 · 오른쪽 값)를 쓴다. 이 줄을 따로 두는
 * 이유는 서식이 아니라 **뜻**이다: 위의 줄들은 축에서 읽은 값이고 이것은 상태다.
 * 색은 안 가진다 — 카드에서 색을 갖는 줄은 변화 줄 하나뿐이라는 규칙 그대로다. */
export function ReadoutFact({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <HStack justifyContent="space-between" gap={1}>
      <Text as="span" font="label2" color="fgMuted" noWrap>
        {k}
      </Text>
      <Text as="span" font="label2" noWrap>
        {v ?? '—'}
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
