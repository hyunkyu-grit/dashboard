'use client';

/* 「성분」 탭 — 그 차이가 무엇으로 이루어져 있나, 그리고 무엇에 얹혀 있나.
 *
 * 「모형」 탭에서 갈라져 나왔다 [OWNER, 2026-08-20 — "얘는 다른 탭으로 빼고"].
 * 그림 한 장과 숫자 격자를 한 탭에 쌓으니 둘 다 작아졌고, 그림은 «예쁘게» 될
 * 자리를 못 받았다. 이제 그림은 「모형」이 온전히 갖고, 여기는 숫자만 진다.
 *
 * ── 성분은 지어낸 것이 아니라 산술이다 ──────────────────────────────────────
 * 모형이 선형이라(기저가 `linearity_gate` 를 자기 안에 싣고 다닌다) 분해가
 * **정확**하다:
 *
 *     Δ(τ) = Σ_k  coef_k × basis_k.irs[τ][h=4]
 *
 * `combine` 이 계수를 `diffs.coefs` 로 이미 내놓는다. 여기서 하는 일은 그 곱을
 * 손잡이 이름별로 묶는 것뿐이고, 합이 표의 `deltaBp` 와 맞는지는
 * `guards/scenario-decompose.test.ts` 가 본다.
 *
 * ── 부호가 뒤집혀 보이는 자리 ───────────────────────────────────────────────
 * 금통위 +25bp 한 분기가 3년 IRS 를 **내린다**(−3.5bp). 오타가 아니다. 기저의
 * `irs` 는 레벨이 아니라 `engine_contribution` = «h분기 뒤부터의 CD 평균 − 오늘
 * 부터의 CD 평균» 이다. 지나가는 인상은 12개월 뒤엔 이미 빠져 있으므로 그때의
 * 3년 스왑은 오늘의 3년보다 낮다. 시장 캐리와 정확히 같은 종류의 양이라 나란히
 * 놓고 뺄 수 있는 것이고, 그게 이 화면이 성립하는 이유다.
 */

import { useEffect, useMemo, useState } from 'react';

import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';

import { fetchScenarioMacro, type MacroPayload } from './api';
import { BASIS, IRS_TENORS, type Diffs, type IrsTenor } from './combine';
import { H_12M, type ScenarioRow } from './assemble';

const TENOR_LABEL: Record<IrsTenor, string> = {
  '1y': '1Y',
  '2y': '2Y',
  '3y': '3Y',
  '5y': '5Y',
  '10y': '10Y',
};

/** 손잡이 하나가 어느 기저들로 이루어졌나. 금통위만 여덟 벌이다(분기별).
 *
 * ── 순서와 이름이 여기서 중요하다 [실측 2026-08-20] ─────────────────────────
 * 금통위가 **맨 아래**이고 이름이 «금통위» 가 아니라 «금통위 경로 고정» 이다.
 * 그 줄은 한국은행이 하는 일이 아니라 **내가 8분기를 못 박아 둔 결과**이기
 * 때문이다.
 *
 * `combine` 은 정책 계수를 풀어서 앞 8분기 `i_kr` 이 내가 놓은 경로와 정확히
 * 같아지게 만든다(`cPol = M⁻¹(target − other)`). 그래서 다른 손잡이를 건드리면
 * 준칙이 금리를 따라 움직이려 하고, 경로가 고정돼 있으면 그것을 **막는 몫**이
 * 전부 이 줄에 잡힌다. 실측:
 *
 *     유가 +12% (경로 동결)   유가 −9.1  ·  금통위 +6.0   → 3Y Δ −3.1bp
 *     물가 +0.6pp (경로 동결) 물가 −22.5 ·  금통위 +23.2  → 3Y Δ  +0.8bp
 *
 * 물가를 0.6pp 올려도 3년이 거의 안 움직이는 것은 «모형이 물가를 무시해서» 가
 * 아니라 **내가 금통위를 못 움직이게 묶어 뒀기 때문**이다. 그 사실이 이 격자에서
 * 유일하게 읽히는 자리이므로, 이름을 «금통위» 로 두면 그 정보가 죽는다. */
const DRIVERS: { key: string; label: string; bases: string[] }[] = [
  { key: 'cpi', label: '물가', bases: ['cpi'] },
  { key: 'gap', label: 'GDP 갭', bases: ['gap'] },
  { key: 'exports', label: '수출', bases: ['exports'] },
  { key: 'oil', label: '유가', bases: ['oil'] },
  {
    key: 'policy',
    label: '금통위 경로 고정',
    bases: Array.from({ length: 8 }, (_, i) => `policy_q${i + 1}`),
  },
];

/** 한 손잡이가 한 테너의 12개월 Δ 에 넣은 bp. 선형이라 이 곱이 곧 기여분이다. */
function contribBp(diffs: Diffs, bases: string[], tenor: IrsTenor): number {
  let pp = 0;
  for (const name of bases) {
    const c = diffs.coefs[name];
    if (!c) continue;
    const entry = BASIS.bases[name];
    if (!entry) continue;
    pp += c * entry.irs[tenor][H_12M];
  }
  return pp * 100;
}

const fmt = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;

/* ── 화면 ──────────────────────────────────────────────────────────────────── */

export function ModelExplainer({ rows, diffs }: { rows: ScenarioRow[]; diffs: Diffs }) {
  const [macro, setMacro] = useState<MacroPayload | null>(null);
  const [macroErr, setMacroErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchScenarioMacro()
      .then((m) => live && setMacro(m))
      .catch((e) => live && setMacroErr(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  /** 성분 격자 — 행이 손잡이, 열이 테너. 합계 세 줄이 그 아래 선다. */
  const grid = useMemo(
    () =>
      DRIVERS.map((d) => ({
        ...d,
        cells: IRS_TENORS.map((t) => contribBp(diffs, d.bases, t)),
      })),
    [diffs],
  );

  if (rows.length === 0) return null;

  return (
    <VStack gap={3} minWidth={0} width="100%" flexGrow={1} minHeight={0}>
      <Decomposition grid={grid} rows={rows} />
      <MacroStrip macro={macro} error={macroErr} />
    </VStack>
  );
}

/* ── 성분 ───────────────────────────────────────────────────────────────────── */

function Decomposition({
  grid,
  rows,
}: {
  grid: { key: string; label: string; cells: number[] }[];
  rows: ScenarioRow[];
}) {
  const modelSum = rows.map((r) => r.deltaBp);
  const carry = rows.map((r) => r.marketCarryBp);
  const vs = rows.map((r) => r.vsMarketBp);
  const cols = rows.map((r) => TENOR_LABEL[r.tenor] ?? r.tenor);

  return (
    <VStack gap={0.5} minWidth={0} width="100%">
      <Text as="h3" font="caption" color="fgMuted">
        무엇이 그 차이를 만드나 (12개월, bp)
      </Text>
      <Box className="sr-scn-decomp" style={{ ['--sr-decomp-cols' as string]: cols.length }}>
        <span className="sr-scn-dc-h" />
        {cols.map((c) => (
          <span key={c} className="sr-scn-dc-h sr-scn-dc-n">
            <Text as="span" font="legal" color="fgMuted" tabularNumbers noWrap>
              {c}
            </Text>
          </span>
        ))}

        {grid.map((d) => (
          <Row key={d.key} label={d.label} cells={d.cells} muted />
        ))}

        <Row label="모형이 말하는" cells={modelSum} rule />
        <Row label="시장이 프라이싱한" cells={carry} />
        <Row label="차이 = 트레이드" cells={vs} strong />
      </Box>
      <Text as="span" font="legal" color="fgMuted">
        맨 아랫줄이 트레이드예요 — 음수면 리시브, 양수면 페이. 「금통위 경로 고정」은
        한국은행이 하는 일이 아니라 <b>내가 8분기를 못 박아 둔 몫</b>이에요. 다른
        손잡이를 움직이면 준칙이 금리를 따라가려 하는데, 경로를 고정해 두면 그걸
        막는 값이 거기 잡혀요.
      </Text>
    </VStack>
  );
}

function Row({
  label,
  cells,
  muted,
  rule,
  strong,
}: {
  label: string;
  cells: (number | null)[];
  muted?: boolean;
  rule?: boolean;
  strong?: boolean;
}) {
  return (
    <>
      <span className="sr-scn-dc-l" data-rule={rule ? '1' : '0'}>
        <Text as="span" font="legal" color={muted ? 'fgMuted' : undefined} noWrap>
          {label}
        </Text>
      </span>
      {cells.map((v, i) => (
        <span key={i} className="sr-scn-dc-n" data-rule={rule ? '1' : '0'}>
          <Text
            as="span"
            font={strong ? 'label2' : 'legal'}
            color={muted && v === 0 ? 'fgMuted' : muted ? 'fgMuted' : undefined}
            tabularNumbers
            noWrap
          >
            {v === null ? '—' : v === 0 && muted ? '·' : fmt(v)}
          </Text>
        </span>
      ))}
    </>
  );
}

/* ── 모형이 딛고 선 자리 ────────────────────────────────────────────────────── */

/** ECOS 실측 세 줄. 손잡이가 «물가 +0.5pp» 라고 할 때, 그 0.5pp 가 무엇에
 * 얹히는 값인지가 같이 서야 그 말을 검사할 수 있다.
 *
 * GDP 갭은 한국은행이 발표하지 않는다 — 실질GDP 에 HP(1600) 을 건 우리 프록시라
 * 화면이 그렇게 적는다(`official: false`). 그 필터가 BIGFOOT 것과 같은 값을
 * 내는지는 `backend/tests/test_labmacro.py` 가 검사한다. */
function MacroStrip({ macro, error }: { macro: MacroPayload | null; error: string | null }) {
  if (error) {
    return (
      <Text as="p" font="legal" color="fgMuted">
        모형이 딛고 선 거시 실측은 못 불러왔어요 ({error}). 시나리오 계산은 구운 기저와
        오늘의 커브로 도니 그대로예요.
      </Text>
    );
  }
  if (!macro) {
    return (
      <Text as="p" font="legal" color="fgMuted">
        모형이 딛고 선 거시 실측을 불러오는 중이에요.
      </Text>
    );
  }

  return (
    <VStack gap={0.5} minWidth={0} width="100%">
      <HStack gap={1.5} alignItems="baseline" width="100%" flexWrap="wrap">
        <Text as="h3" font="caption" color="fgMuted" noWrap>
          손잡이가 얹히는 값 · 한국은행 ECOS
        </Text>
        <Text as="span" font="legal" color="fgMuted" tabularNumbers noWrap>
          {macro.asof ?? '—'}
        </Text>
      </HStack>
      <HStack gap={1} width="100%" flexWrap="wrap" alignItems="stretch">
        {macro.series.map((s) => {
          const last = s.points.at(-1);
          const prev = s.points.at(-5);
          return (
            <VStack key={s.key} className="sr-simcard" gap={0} minWidth={150} flexGrow={1} flexBasis={0}>
              <Text as="span" font="legal" color="fgMuted" noWrap>
                {s.label}
                {s.official ? '' : ' · 우리 추정'}
              </Text>
              <Text as="span" font="label1" tabularNumbers noWrap>
                {last ? `${last.v >= 0 ? '' : '−'}${Math.abs(last.v).toFixed(2)}` : '—'}
                <Text as="span" font="legal" color="fgMuted">
                  {' '}
                  {s.unit}
                </Text>
              </Text>
              <Text as="span" font="legal" color="fgMuted" tabularNumbers noWrap>
                {prev && last ? `1년 전 ${prev.v.toFixed(2)} · ` : ''}
                {s.source}
              </Text>
            </VStack>
          );
        })}
      </HStack>
      <Text as="span" font="legal" color="fgMuted">
        {macro.notes.join(' ')} 방정식은 한국은행 WP 2025-3(eq.7~44)·미국 블록은 IMF
        WP/08/278, 재현 검사 12/13(면제 하나 — 물가 저점 −0.079pp). 미국→한국 연결
        β=1.05 는 논문에 없는 값이라 우리가 고른 거예요.
      </Text>
    </VStack>
  );
}
