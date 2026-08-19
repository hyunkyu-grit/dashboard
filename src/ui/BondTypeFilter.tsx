'use client';

import { Select } from '@coinbase/cds-web/alpha/select';
import { Box } from '@coinbase/cds-web/layout';

/**
 * 현금채권·자산스왑 탭의 종목군 필터 — `StartFilter` 와 같은 성질·같은 자리.
 *
 * v1 은 이 축을 칩 줄(국고채·통안채·…)로 뒀지만, v2 의 칩 줄은 오너가 걷어냈고
 * 남은 하나의 좁히기 컨트롤은 제목 줄의 Select 다(포워드 시작점의 선례). 이
 * 축이 스크리너 칩과 다른 이유도 그쪽과 같다: 같은 목록의 프리셋이 아니라
 * **다른 유니버스의 단면**이다 — 8종 × 만기 격자에서 "산금채만" 은 다른 커브를
 * 읽는 일이다.
 *
 * 목록은 데이터에서 나온다(`/api/cashbond/instruments` 의 `types`). 상수로
 * 적어두지 않는 이유는 StartFilter 와 같다 — 두 벌은 반드시 어긋난다.
 */

/** "전체" 값. null 을 피하는 이유는 `ALL_STARTS` 와 같다. */
export const ALL_TYPES = 'all';

export function BondTypeFilter({
  types,
  value,
  onChange,
}: {
  /** 실제로 행이 있는 종목군, 신용 사다리 순 (서버 순서 그대로) */
  types: { id: string; label: string }[];
  value?: string;
  onChange: (v: string | undefined) => void;
}) {
  if (types.length === 0) return null;
  /* 폭 200: 가장 긴 라벨 "캐피탈채 AA-" 가 한 줄로 서는 폭 (StartFilter 의
   * 같은 실측 계열). */
  return (
    <Box width={200}>
      {/* font legal(13) — 컨트롤 값 13px 규칙(popup.ts 의 근거). */}
      <Select
        label="종목군"
        font="legal"
        compact
        accessibilityLabel="종목군"
        value={value ?? ALL_TYPES}
        onChange={(v) => onChange(v === ALL_TYPES || v == null ? undefined : v)}
        options={[
          { value: ALL_TYPES, label: '전체' },
          ...types.map((t) => ({ value: t.id, label: t.label })),
        ]}
      />
    </Box>
  );
}
