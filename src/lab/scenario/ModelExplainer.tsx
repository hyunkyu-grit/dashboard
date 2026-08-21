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
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@coinbase/cds-web/tables';
import { Text } from '@coinbase/cds-web/typography';

import { tintStyle } from '@/table/tint';

import { fetchScenarioMacro, type MacroPayload, type MacroSeries } from './api';
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
/* 물가 손잡이의 필립스는 **논문의 식 그대로**다 [2026-08-21 수리].
 *
 * 하루 전까지는 아니었다. BIGFOOT 이 `PROVISIONAL_PHILLIPS` 로 «표만 보고는
 * eq (23) 의 항 배치를 못 정한다» 고 적어 두고, Table 8 값들의 **순열 탐색**
 * (`phillips_perm`)으로 IRF 스코어카드에 맞춘 배선을 쓰고 있었다.
 *
 * **배치는 정할 필요가 없었다. 논문 25쪽에 인쇄돼 있다.** PDF 텍스트 추출이
 * 수식 기호를 날려서 안 보였을 뿐이고, 페이지를 이미지로 렌더하면 읽힌다.
 *
 *   eq (23)  π_Core,t = (1−φ1−φ2)·π̄_t + φ1·π_Core,t−1
 *                       + φ2·E_t π_Core,t+1 + φ3·ŷ_t
 *   eq (24)  π̄_t = (1−δ1)·π* ÷ 4 + δ1·π̄_t−1 + δ2·(π_Core,t−1 − π̄_t−1)
 *
 *   항                 논문 = 지금    이전(순열 + 기대 덧붙임)
 *   어트랙터 π̄        0.60           0.15
 *   직전 코어          0.25           0.10
 *   기대               0.15 (t+1)     0.50 (위성 VAR, 4분기)
 *   GDP 갭             0.10           0.25
 *
 * 고친 뒤 **정상상태 잔차가 전부 0 이 됐다.** 이전에는 eq (24) 가 영구 잔차
 * (2 − 2.0792)를 남겨 «논문 자신의 산수» 라는 이름으로 화이트리스트에 올라
 * 있었는데, 그건 논문의 산수가 아니라 옮겨 적기의 오류였다 — 인쇄된 식은
 * (π_Core,t−1 − π̄_t−1) 을 **차분**으로 들고 있어 δ1+δ2 가 1 을 넘을 일이
 * 없다.
 *
 * 대가도 적어 둔다: 논문 IRF 밴드 대조가 12/13 에서 8/13 으로 내려갔다.
 * 다만 그 12/13 은 **그 밴드에 맞춰 순열을 고른 결과**였고, 프로젝트가
 * 면책조항(`WAIVER_CAVEAT`)까지 써야 했던 유일한 실패 — A 충격의 CPI 저점 —
 * 은 논문 형태에서 밴드 안으로 들어왔다. 남은 실패 넷은 전부 주택·부채·소비
 * 쪽이고, 그 블록들은 각자 다른 미해결 항목을 안고 있다. */
const DRIVERS: { key: string; label: string; note: string; bases: string[] }[] = [
  {
    key: 'cpi',
    label: '물가',
    note: '필립스 eq.23·24 로 들어가요 — 논문에 인쇄된 배치 그대로예요',
    bases: ['cpi'],
  },
  { key: 'gap', label: 'GDP 갭', note: '소비·투자 PAC 의 수요 충격이에요', bases: ['gap'] },
  { key: 'exports', label: '수출', note: '수출 방정식 eq.17 의 잔차예요', bases: ['exports'] },
  { key: 'oil', label: '유가', note: '수입물가 eq.31 의 원유 항이에요', bases: ['oil'] },
  {
    key: 'policy',
    label: '금통위 경로 고정',
    note: '준칙이 따라가려는 걸 내가 막은 몫이에요',
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
    <VStack gap={0} minWidth={0} width="100%" flexGrow={1} minHeight={0}>
      <Decomposition grid={grid} rows={rows} />
      <MacroStrip macro={macro} error={macroErr} />
    </VStack>
  );
}

/* ── 성분 ─────────────────────────────────────────────────────────────────────
 *
 * Main 의 아웃라이트 표와 **같은 문법**이다 [OWNER, 2026-08-20 — "밑에 꽉 채우고
 * 시인성 좋게, 메인/백테스트 탭 생각해서"]:
 *
 *     이름 열 왼쪽 · 숫자 열 오른쪽 (`.sr-label` / `.sr-num`)
 *     행이 두 줄 — 주값 아래 muted 보조
 *     **변화 칸에 크기 틴트** (`tintStyle` — Main 의 1D·MTD·YTD 열이 쓰는 그것)
 *     열 머리는 muted, 표가 카드 폭을 꽉 채움
 *
 * 앞 판은 20px 짜리 자작 격자였다. 촘촘해서 한 화면에는 들어갔지만 읽히지 않았고,
 * 앱의 어떤 표와도 안 닮았다.
 */

function Decomposition({
  grid,
  rows,
}: {
  grid: { key: string; label: string; note: string; cells: number[] }[];
  rows: ScenarioRow[];
}) {
  const cols = rows.map((r) => TENOR_LABEL[r.tenor] ?? r.tenor);
  const sums: { label: string; note: string; cells: (number | null)[]; tint?: boolean; strong?: boolean }[] = [
    { label: '모형이 말하는', note: '위 다섯의 합', cells: rows.map((r) => r.deltaBp) },
    { label: '시장이 프라이싱한', note: '1Y 시작 포워드 − 스팟', cells: rows.map((r) => r.marketCarryBp) },
    {
      label: '차이 = 트레이드',
      note: '음수면 리시브 · 양수면 페이',
      cells: rows.map((r) => r.vsMarketBp),
      tint: true,
      strong: true,
    },
  ];

  return (
    <VStack gap={0} minWidth={0} width="100%" flexGrow={1} minHeight={0}>
      {/* 이름과 메타가 **한 줄**이다. 쌓으면 20px 을 먹는데, 그러면 여덟 행짜리 표의
          마지막 줄 — 이 화면의 답인 「차이 = 트레이드」 — 이 카드 밖으로 밀린다
          (실측 2026-08-20: 37px 넘쳤고 잘린 것이 정확히 그 줄이었다). */}
      <HStack gap={1.5} alignItems="baseline" paddingX={2} paddingTop={2} paddingBottom={1} flexWrap="wrap">
        <Text as="h3" font="label1" color="fgMuted" noWrap>
          무엇이 그 차이를 만드나
        </Text>
        <Box style={{ marginInlineStart: 'auto' }}>
          <Text as="span" font="caption" color="fgMuted" noWrap>
            12개월 · bp · 모형이 선형이라 다섯의 합이 정확히 «모형이 말하는» 이에요
          </Text>
        </Box>
      </HStack>

      <Box paddingX={2} flexGrow={1} minHeight={0} style={{ overflowY: 'auto' }}>
        <Table tableLayout="auto">
          <TableHeader>
            <TableRow>
              <TableCell as="th" scope="col" className="sr-label">
                <Text as="span" font="legal" color="fgMuted">
                  손잡이
                </Text>
              </TableCell>
              {cols.map((c) => (
                <TableCell as="th" scope="col" key={c} className="sr-num" justifyContent="flex-end">
                  <Text as="span" font="legal" color="fgMuted" noWrap>
                    {c}
                  </Text>
                </TableCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {grid.map((d) => (
              <Row key={d.key} label={d.label} note={d.note} cells={d.cells} muted />
            ))}
            {sums.map((r) => (
              <Row key={r.label} {...r} />
            ))}
          </TableBody>
        </Table>
      </Box>
    </VStack>
  );
}

/** 표의 한 행. 두 줄짜리 이름 칸은 Main·Strategy 의 행 문법 그대로다. */
function Row({
  label,
  note,
  cells,
  muted,
  tint,
  strong,
}: {
  label: string;
  note: string;
  cells: (number | null)[];
  muted?: boolean;
  tint?: boolean;
  strong?: boolean;
}) {
  return (
    <TableRow>
      {/* 손잡이 다섯은 **한 줄**, 합계 셋만 두 줄이다.
          전부 두 줄로 두었더니 여덟 행이 480px 이라 답인 마지막 줄이 카드 밖으로
          밀렸다(실측: 창 855 에서 53px 넘침). 위계로도 이쪽이 맞다 — 재료는
          한 줄이고, 결론은 두 줄을 받을 자격이 있다. */}
      <TableCell className="sr-label">
        {muted ? (
          <HStack gap={1} alignItems="baseline" minWidth={0}>
            <Text as="span" font="label2" color="fgMuted" noWrap>
              {label}
            </Text>
            <Text as="span" font="legal" color="fgMuted" noWrap>
              {note}
            </Text>
          </HStack>
        ) : (
          <VStack gap={0} minWidth={0}>
            <Text as="span" font="label2" noWrap>
              {label}
            </Text>
            <Text as="span" font="legal" color="fgMuted" noWrap>
              {note}
            </Text>
          </VStack>
        )}
      </TableCell>
      {cells.map((v, i) => (
        <TableCell
          key={i}
          className="sr-num"
          justifyContent="flex-end"
          /* 크기 틴트는 **트레이드 행에만**. Main 도 변화 열에만 칠한다 —
             모든 칸을 칠하면 어디가 답인지가 사라진다. */
          style={tint ? tintStyle(v) : undefined}
        >
          <Text
            as="span"
            font={strong ? 'label2' : 'legal'}
            color={muted ? 'fgMuted' : undefined}
            tabularNumbers
            noWrap
            className={tint ? dirCls(v) : undefined}
          >
            {/* 0 도 **숫자로 적는다**. «·» 로 비워 뒀더니 거의 안 보였고, Main 은
                변화가 없는 칸에 «0.0» 을 적는다(3M 행의 1D 열). 빈 점은 «해당
                없음» 처럼 읽히는데 여기 0 은 «기여가 정확히 0» 이다. */}
            {v === null ? '—' : fmt(v)}
          </Text>
        </TableCell>
      ))}
    </TableRow>
  );
}

function dirCls(v: number | null): string | undefined {
  if (v === null || v === 0) return undefined;
  return v > 0 ? 'sr-up' : 'sr-down';
}

/* ── 모형이 딛고 선 자리 ──────────────────────────────────────────────────────
 *
 * 백테스트가 차트 아래 「이 구간 / 변화 / 52주」를 두는 그 블록이다 —
 * `.sr-stats` 세 칸, 사이는 여백이 아니라 헤어라인이라 셋이 **한 덩어리**로
 * 읽힌다.
 *
 * 손잡이가 «물가 +0.5pp» 라고 할 때 그 0.5pp 가 무엇에 얹히는 값인지가 같이
 * 서야 그 말을 검사할 수 있다. GDP 갭은 한국은행이 발표하지 않는다 — 실질GDP 에
 * HP(1600) 을 건 우리 프록시라 이름에 그렇게 적는다.
 */
function MacroStrip({ macro, error }: { macro: MacroPayload | null; error: string | null }) {
  if (error || !macro || macro.series.length === 0) {
    return (
      <Box className="sr-stats" paddingX={2} paddingY={2}>
        <Text as="span" font="legal" color="fgMuted">
          {error
            ? `모형이 딛고 선 거시 실측은 못 불러왔어요 (${error}). 시나리오 계산은 구운 기저와 오늘의 커브로 도니 그대로예요.`
            : '모형이 딛고 선 거시 실측을 불러오는 중이에요.'}
        </Text>
      </Box>
    );
  }

  return (
    <HStack className="sr-stats" flexWrap="wrap">
      {macro.series.map((s) => (
        <MacroColumn key={s.key} s={s} asof={macro.asof} />
      ))}
    </HStack>
  );
}

function MacroColumn({ s, asof }: { s: MacroSeries; asof: string | null }) {
  const last = s.points.at(-1);
  const prev = s.points.at(-5);
  return (
    <VStack gap={1} paddingX={2} paddingY={1.5} flexGrow={1} minWidth={0} className="sr-statcol">
      <HStack gap={1} alignItems="baseline" flexWrap="wrap">
        <Text as="h4" font="title3" noWrap>
          {s.label}
        </Text>
        <Text as="span" font="legal" color="fgMuted" noWrap>
          {s.official ? asof : `${asof} · 우리 추정`}
        </Text>
      </HStack>
      <HStack gap={3} flexWrap="wrap">
        <Stat label="지금" value={last ? `${last.v.toFixed(2)}${s.unit.replace('% YoY', '%')}` : '—'} />
        <Stat label="1년 전" value={prev ? `${prev.v.toFixed(2)}` : '—'} />
        <Stat label="출처" value={s.source} wide />
      </HStack>
    </VStack>
  );
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <VStack gap={0.25} minWidth={0}>
      <Text as="span" font="caption" color="fgMuted" noWrap>
        {label}
      </Text>
      <Text as="span" font="body" tabularNumbers noWrap={!wide}>
        {value}
      </Text>
    </VStack>
  );
}
