import { Text } from '@coinbase/cds-web/typography';

/**
 * 패널 한 장의 머리. 세 칸이 **같은 머리**를 쓴다 — 캐논 규칙 1(«새로 만들기
 * 전에 찾는다»)의 이 화면 판이고, 「얼라인」 5(같은 위계의 카드 머리는 같은
 * 리듬)가 요구하는 것이기도 하다.
 *
 * 오른쪽은 «지금 이 패널의 사실» 한 줄이다(개수·기준시각). 컨트롤은 안 온다 —
 * 32px 머리에 컨트롤을 넣으면 그 행만 등고가 깨진다.
 *
 * ── `brace` [팔란티어 실측 2026-08-26] ─────────────────────────────────────
 * Gotham 페이지의 스트립이 가운데 라벨만 `{ GOTHAM }` 으로 감싼다 — 괄호가
 * «이것이 지금 보고 있는 것의 이름» 이라고 말하고, 좌우의 다른 라벨과 위계를
 * 가른다. 그래서 이 앱에서도 **지금 보고 있는 면**(뷰포트)에만 붙인다. 전부에
 * 붙이면 구분이 사라져 장식이 된다.
 */
export function PanelHead({
  label,
  note,
  brace = false,
}: {
  label: string;
  note?: string;
  brace?: boolean;
}) {
  return (
    <div className="sr-term-head">
      <span className="sr-term-eyebrow" data-brace={brace || undefined}>
        {label}
      </span>
      {note ? (
        <Text font="legal" color="fgMuted" tabularNumbers noWrap>
          {note}
        </Text>
      ) : null}
    </div>
  );
}
