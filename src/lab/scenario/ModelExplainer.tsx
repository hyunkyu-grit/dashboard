'use client';

/* 「모형」 탭 — 이 숫자가 어디서 왔는지.
 *
 * 결과만 내놓는 화면은 트레이더에게 «믿거나 말거나» 를 요구한다. 이 모형은 우리가
 * 만든 것이 아니라 **경제학자들이 만들어 둔 것을 빌려 쓴 것**이고, 그렇다면 무엇을
 * 빌렸는지 말할 수 있어야 한다 — 어느 논문, 어느 라이브러리, 어느 계수, 그리고
 * 어디까지 검증됐는지.
 *
 * 그래서 이 탭이 답하는 것은 셋이다.
 *
 *   무엇이 무엇을 움직이나   손잡이 → 방정식 → 커브
 *   어디서 빌렸나            논문·라이브러리·데이터의 이름
 *   얼마나 믿나              무엇으로 검증했고 어디가 못 미쳤나
 *
 * ── 여기 적힌 값은 전부 실측이다 ────────────────────────────────────────────
 * 숫자를 손으로 적은 곳이 있고(계수·표본), 그것들은 `project_bigfoot` 의 산출물
 * (`output/engine_status.json` · `cd_passthrough.json` · `scenario_basis.json`)에서
 * 읽은 값이다. 기저를 다시 구우면 여기도 같이 손봐야 한다 — 그 사실을 마지막 줄이
 * 말한다.
 */

import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';

import { BASIS } from './combine';

/* ── 도해 ────────────────────────────────────────────────────────────────────
 *
 * 네 단계다. 트레이더가 만지는 것에서 시작해 호가로 끝난다 — 가운데가 모형이고,
 * 양 끝이 사람이 아는 것이다. */
const FLOW: { head: string; lines: string[] }[] = [
  {
    head: '① 내가 놓는 것',
    lines: ['금통위 8분기 경로', 'CPI · GDP갭 · 수출', 'Fed · 유가'],
  },
  {
    head: '② 한국 블록',
    lines: ['BOK WP 2025-3 eq.7~44', '준칙 · 필립스 · UIP · 기간구조', '기대 = 이동종점 위성 VAR'],
  },
  {
    head: '③ 미국 블록',
    lines: ['IMF QPM 2008 (IS·PC·MP)', '기간프리미엄 = FRB/US 에 맞춘 커널', 'β_sync 1.05 로 한국에 전달'],
  },
  {
    head: '④ 시장으로',
    lines: ['정책 → CD 전이', '기대 CD 평균 → IRS', 'OU 스프레드 위성'],
  },
];

/** 손잡이가 실제로 건드리는 자리. 「무엇을 켜면 무엇이 움직이나」 */
const KNOB_MAP: { knob: string; enters: string; moves: string }[] = [
  {
    knob: '금통위 경로',
    enters: '준칙(eq.35)을 8분기 동안 덮어쓴다',
    moves: 'CD → IRS 전 구간. q9부터 준칙이 복귀하며 되받아친다',
  },
  {
    knob: 'CPI',
    enters: '필립스(eq.23-24)의 물가 충격',
    moves: '준칙을 통해 금리로. 8분기 경로는 내가 놓은 자리에 그대로 있다',
  },
  {
    knob: 'GDP 갭',
    enters: '소비·투자 PAC 방정식의 수요 충격',
    moves: '갭 → 물가 → 준칙. 주택·가계부채도 같이 움직인다',
  },
  {
    knob: '수출',
    enters: '수출 방정식(eq.17)의 잔차',
    moves: '갭을 통해 간접적으로. 환율(UIP)도 반응한다',
  },
  {
    knob: 'Fed',
    enters: '미국 블록에 정책 경로를 imposed 로 고정',
    moves: '미국 기간프리미엄 → β_sync → 한국 10년. 환율도 UIP 로',
  },
  {
    knob: '유가',
    enters: '수입물가(eq.31)의 원유 항',
    moves: '물가 → 준칙 → 커브',
  },
];

/** 어디서 빌렸나. 이름을 적는 것이 이 표의 전부다. */
const SOURCES: { part: string; from: string; note: string }[] = [
  {
    part: '한국 방정식 38개',
    from: '한국은행 WP 2025-3 (BOK-LOOK)',
    note: '계수는 논문 표 그대로. 배치가 유일하지 않은 슬롯은 미결로 두고 쓰지 않는다',
  },
  {
    part: '기대 형성',
    from: '같은 논문 Appendix A',
    note: '핵심 3변수[물가·갭·금리]의 이동종점 위성 VAR',
  },
  {
    part: '조정 동학',
    from: 'FRB/US 의 PAC (다항조정비용)',
    note: '연준 모형의 기계를 한국 방정식에 씌운 것',
  },
  {
    part: '미국 블록',
    from: 'IMF WP/08/278 (Carabenciov 외)',
    note: '소형 NK 3방정식. 계수는 논문의 사후 최빈값',
  },
  {
    part: '미국 기간프리미엄',
    from: 'pyfrbus 1.1.1 (연준 FRB/US)',
    note: 'FRB/US 의 10년물에 맞춘 12탭 FIR 커널. 100bp × 4분기까지 검증',
  },
  {
    part: '정책 → CD 전이',
    from: '한국은행 기준금리 변경일 이벤트스터디',
    note: '2010-07 ~ 2025-05, 33건. ±25/±50bp 변경만',
  },
  {
    part: '데이터',
    from: '한국은행 ECOS · FRED',
    note: '기준금리 722Y001 · 근원CPI 901Y010 · 실질GDP 200Y108 · 콜 721Y001',
  },
];

function Stage({ head, lines }: { head: string; lines: string[] }) {
  return (
    <VStack className="sr-simcard" gap={0.5} minWidth={0} flexGrow={1} flexBasis={0}>
      <Text as="span" font="label2" noWrap>
        {head}
      </Text>
      {lines.map((l) => (
        <Text key={l} as="span" font="legal" color="fgMuted">
          {l}
        </Text>
      ))}
    </VStack>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <VStack gap={1} minWidth={0} width="100%">
      <Text as="h3" font="caption" color="fgMuted">
        {title}
      </Text>
      {children}
    </VStack>
  );
}

export function ModelExplainer() {
  return (
    <VStack gap={3} minWidth={0} width="100%">
      <Section title="숫자가 지나오는 길">
        <HStack gap={1} width="100%" alignItems="stretch" flexWrap="wrap">
          {FLOW.map((s, i) => (
            <HStack key={s.head} gap={1} alignItems="stretch" flexGrow={1} flexBasis={0} minWidth={0}>
              <Stage head={s.head} lines={s.lines} />
              {i < FLOW.length - 1 ? (
                <Box alignSelf="center" flexShrink={0}>
                  <Text as="span" font="legal" color="fgMuted" aria-hidden>
                    →
                  </Text>
                </Box>
              ) : null}
            </HStack>
          ))}
        </HStack>
        <Text as="p" font="legal" color="fgMuted">
          ②와 ③은 우리가 만든 것이 아니라 경제학자들이 이미 세워 둔 모형이에요. 우리가
          한 일은 그 둘을 원화 커브에 닿게 잇고, ①에서 ④까지가 한 번에 풀리게 한 거예요.
        </Text>
      </Section>

      <Section title="손잡이가 건드리는 자리">
        <VStack gap={0} width="100%" className="sr-scn-deftable">
          {KNOB_MAP.map((k) => (
            <HStack key={k.knob} gap={1.5} width="100%" alignItems="flex-start" paddingY={1}>
              <Box width={88} flexShrink={0}>
                <Text as="span" font="label2" noWrap>
                  {k.knob}
                </Text>
              </Box>
              <VStack gap={0} minWidth={0} flexGrow={1}>
                <Text as="span" font="legal">
                  {k.enters}
                </Text>
                <Text as="span" font="legal" color="fgMuted">
                  {k.moves}
                </Text>
              </VStack>
            </HStack>
          ))}
        </VStack>
      </Section>

      <Section title="어디서 빌렸나">
        <VStack gap={0} width="100%" className="sr-scn-deftable">
          {SOURCES.map((s) => (
            <HStack key={s.part} gap={1.5} width="100%" alignItems="flex-start" paddingY={1}>
              <Box width={120} flexShrink={0}>
                <Text as="span" font="label2">
                  {s.part}
                </Text>
              </Box>
              <VStack gap={0} minWidth={0} flexGrow={1}>
                <Text as="span" font="legal">
                  {s.from}
                </Text>
                <Text as="span" font="legal" color="fgMuted">
                  {s.note}
                </Text>
              </VStack>
            </HStack>
          ))}
        </VStack>
      </Section>

      <Section title="CD 는 기준금리를 이렇게 따라온다">
        <HStack gap={2} flexWrap="wrap">
          {[
            ['발표 10영업일 전까지', '11.3%', '미리 반영된다'],
            ['발표일 당일', '55.8%', '한 번에 반영된다'],
            ['남은 몫', 'τ 78.8영업일', '지수적으로 따라간다'],
            ['CD − 기준금리', '+0.21%p', '표본 평균 스프레드'],
          ].map(([k, v, note]) => (
            <VStack key={k} gap={0} minWidth={0}>
              <Text as="span" font="legal" color="fgMuted" noWrap>
                {k}
              </Text>
              <Text as="span" font="label1" tabularNumbers noWrap>
                {v}
              </Text>
              <Text as="span" font="legal" color="fgMuted" noWrap>
                {note}
              </Text>
            </VStack>
          ))}
        </HStack>
        <Text as="p" font="legal" color="fgMuted">
          33번의 기준금리 변경(2010-07 ~ 2025-05)을 D−10 ~ D+15 창으로 본 결과예요.
          절반 넘는 사건이 창 안에서 남은 몫을 절반으로 못 줄여서, 반감기는 «15영업일
          초과» 로만 말할 수 있어요 — 그래서 τ 는 두 점 사이 기울기로 잡았어요.
        </Text>
      </Section>

      <Section title="얼마나 믿나">
        <Text as="p" font="legal">
          논문이 보고한 충격반응을 우리 구현이 다시 그리는지로 검사해요. 충격 셋
          — 한국 준칙 +25bp · 미국 준칙 +25bp · 유가 +10% — 을 넣고 GDP갭·물가·주택·
          가계부채·소비의 저점과 고점이 논문의 밴드 안에 드는지 봐요.
        </Text>
        <HStack gap={2} flexWrap="wrap">
          {[
            ['재현 검사', '12 / 13', '하나는 면제로 기록'],
            ['면제된 하나', 'CPI 저점 −0.079pp', '밴드 하한 −0.07 을 살짝 벗어남'],
            ['미국 커널 검증 영역', '100bp × 4분기', '그 밖은 선형 외삽'],
            ['기저 as-of', BASIS.as_of, `${BASIS.horizon_q}분기 · 정책 기저 8개`],
          ].map(([k, v, note]) => (
            <VStack key={k} gap={0} minWidth={0}>
              <Text as="span" font="legal" color="fgMuted" noWrap>
                {k}
              </Text>
              <Text as="span" font="label1" tabularNumbers noWrap>
                {v}
              </Text>
              <Text as="span" font="legal" color="fgMuted" noWrap>
                {note}
              </Text>
            </VStack>
          ))}
        </HStack>
        <Text as="p" font="legal" color="fgMuted">
          논문 표에서 자리가 유일하게 정해지지 않는 계수는 추측하지 않고 비워 둬요 — 그런 슬롯으로 세운 방정식은 아예 만들어지지 않아요. 대신 우리가 정한
          연결(단위·부호 규약)에는 전부 이름을 붙여 기록해 뒀어요 — 엔진이 세는
          활성 플래그가 스물여덟 개예요.
        </Text>
      </Section>

      <Section title="이 화면이 말하지 않는 것">
        <VStack gap={0.5} width="100%">
          {[
            '확률이 아니에요. «이 경로가 프라이싱되면 커브는 어디가 정합인가» 라는 가격결정 질문이에요.',
            '스왑스프레드에 수급·헤지 플로우가 없어요. 평균회귀만 봐요.',
            '기간프리미엄이 IRS 다리에 안 실려 있어서 장기 테너 예측이 보수적이에요.',
            '기저는 구운 것이라 as-of 가 고정이에요. 오늘의 커브만 라이브고, 계수는 그날의 추정이에요.',
          ].map((t) => (
            <Text key={t} as="span" font="legal" color="fgMuted">
              · {t}
            </Text>
          ))}
        </VStack>
      </Section>
    </VStack>
  );
}
