'use client';

/* 크레딧 RV 랭킹 표 (레인 C 1구역) — 합성층 [트레이더 피드백 2026-08-18].
 *
 * **"투자판단이 아니라 RV 랭킹이에요"** — 이 명구는 의무다. Score 는 오늘 후보들
 * 사이의 랭크 백분위 50:50(spreadVolPct·Relative RV)이고, 별점·메달·추천 문구는
 * 없다: 화면이 주장하는 것은 숫자와 순서까지다.
 *
 * 절대축(버퍼)·상대축(RV)은 **독립 숫자로 먼저** 선다(원칙 ①) — Score 한 칸만
 * 보이면 합성이 원료를 가린다. 버퍼는 bp 단독이다 — 원칙 ④ 의 σ 병기는
 * 2026-08-20 에 은퇴했고 사분면 두 축이 그 자리를 대신한다(`rv.py` 머리).
 *
 * ── 조판 (2026-08-19 크리틱 P1) ─────────────────────────────────────────────
 * 74행이 카드 안에서 스크롤하고 **열 머리는 sticky 다** — 행 30 에서 "버퍼가
 * 몇 번째 열이었지"를 기억으로 들게 하지 않는다. 캡은 `.sr-rv-rank-scroll`.
 *
 * ── 접근성: 행은 표, 여는 것은 버튼 ─────────────────────────────────────────
 * `<tr role="button">` 은 스크린리더에서 표 탐색(행↔열머리 연결)을 부순다 —
 * 74행 표가 "버튼 74개"가 된다(크리틱 P2). 그래서 행 의미론은 그대로 두고
 * **종목 칸 안의 실제 <button>** 이 이력 창을 연다. 이 버튼 74개가 이 화면의
 * 유일한 키보드 경로다 — Score 히트맵·사분면은 같은 목적지의 포인터 지름길이라
 * 탭 정지에서 뺐다(탭 226회의 정리, 같은 크리틱).
 *
 * 성분 분해(캐리/롤·z 셋)는 native `title`(포인터)과 이력 창(키보드·상시) 두
 * 채널이다. CDS `Tooltip` 도 검토했으나 148개 셀에 팝오버 기계를 하나씩 다는
 * 비용이라 접었다 — 키보드 사용자의 채널은 이력 창이 진다.
 *
 * CDS `Table` 금지(셀당 32px) — 손 표(.sr-rv-table). Score 셀 틴트는 레인 B 와
 * 같은 다이버징 소스(`tintFor(score − 50, 50)`) — 중앙 50 이탈이 크기다.
 */

import { useEffect, useRef } from 'react';

import { VStack } from '@coinbase/cds-web/layout';
import { Tooltip } from '@coinbase/cds-web/overlays';
import { TextLegal } from '@coinbase/cds-web/typography';

import { tintFor } from '@/theme/tint';

import type { RvCreditItem } from './api';
import { bp1, sig } from './fmt';

/** 전 영업일 대비 랭크 변화 표기 — 0 은 "·"(변동 없음), 어제 없던 항목은 공란.
 * ▲▼ 는 잉크다 — 방향색(빨강=수치 상승)과 "순위 개선"은 딴 문법이라 색을
 * 얹으면 두 사전이 충돌한다. `role="img"`+라벨: 스크린리더가 "black
 * up-pointing triangle" 이 아니라 뜻("1계단 올라옴")을 읽게(2차 크리틱 Sam). */
/** 열 머리의 뜻 풀이 — CDS `Tooltip`(hover 와 **키보드 포커스** 둘 다 연다).
 * 열 머리 셋뿐이라 팝오버 비용 문제가 없다 — 셀 148개에 달지 않던 그 판단의
 * 반대편. 점선 밑줄(cursor: help)이 "설명 있음"의 관례 표식이다. */
function ThHelp({ label, help }: { label: string; help: string }) {
  return (
    <Tooltip
      content={
        /* .sr-rv-tiptext — 이 표의 th 는 nowrap 이고 툴팁이 그 안에 렌더되어
           문장을 **한 줄로 상속**받는다. 그래서 패널은 한 줄 높이로 서고 긴
           문장이 패널 밖으로 흘러나갔다(실측 2026-08-19 [OWNER — "패널 밖으로
           글씨가 빠져나가"]). 줄바꿈을 되살리고 keep-all 로 **단어 사이에서만**
           줄을 넘긴다 — 패널은 세로로 자란다. */
        <TextLegal as="span" className="sr-rv-tiptext">
          {help}
        </TextLegal>
      }
      maxWidth={280}
      placement="bottom"
    >
      <span className="sr-rv-thhelp" tabIndex={0}>
        {label}
      </span>
    </Tooltip>
  );
}

function Delta({ d }: { d: number | null }) {
  if (d == null) return null;
  if (d === 0) {
    return (
      <span role="img" aria-label="변동 없음">
        ·
      </span>
    );
  }
  /* 방향색 [OWNER 2026-08-19 — "상승 빨강·하락 파랑으로 눈에 잘 들어오게"].
   * 카드 위 방향색은 4.5:1 을 넘는다(DESIGN §3.2 — 이 표는 --sr-card 위). */
  return (
    <span
      className={d > 0 ? 'sr-up' : 'sr-down'}
      role="img"
      aria-label={d > 0 ? `${d}계단 올라옴` : `${-d}계단 내려감`}
    >
      {d > 0 ? `▲${d}` : `▼${-d}`}
    </span>
  );
}

export function RankingTable({
  items,
  onSelect,
  onHover,
  highlightId,
  exclusions,
  hMonths,
}: {
  items: RvCreditItem[];
  onSelect: (p: RvCreditItem) => void;
  /** 행 hover/포커스 → 옆 사분면의 점·리드아웃 카드가 따라온다. */
  onHover?: (p: RvCreditItem | null) => void;
  /** 사분면 점 hover → 이 행이 강조되고 보이게 스크롤된다(역방향 연동 [OWNER]). */
  highlightId?: string | null;
  /** 랭킹에서 뺀 항목들 — 조용히 빼지 않는다(사유는 서버 것 그대로). */
  exclusions?: { id: string; label: string; reason: string }[];
  /** 보유 기간(개월) — 버퍼 풀이가 이 숫자를 말한다. H 는 화면 컨트롤(3/6/12)
   * 이라 여기에 상수를 적으면 화면이 거짓말을 한다(기본 6개월인데 "3개월"이라고
   * 적혀 있었다 — Setting 탭의 같은 종류였던 거짓 문구와 한 짝). */
  hMonths: number;
}) {
  /* 역방향 연동의 스크롤 — 강조된 행이 화면 밖이면 nearest 로만 데려온다
     (표가 제멋대로 크게 움직이면 손이 놀란다). */
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  useEffect(() => {
    if (!highlightId) return;
    rowRefs.current.get(highlightId)?.scrollIntoView({ block: 'nearest' });
  }, [highlightId]);
  /* 순서는 서버 랭크 그대로 — 재계산 없음(§16, 동점 규칙까지 서버 것).
   * 랭크 없는 항목(σ 미확정)은 아래에 그대로 선다 — 조용히 빼면 "왜 5년이
   * 없지"가 된다. */
  const ranked = [...items].sort(
    (a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER),
  );

  return (
    /* flexGrow — 카드가 행(2열)에서 받은 높이를 표가 채운다. 채움의 기하는
     * `.sr-rv-rank-fill`(absolute 패턴, type.css 주석)이 진다.
     *
     * 행 문법은 Main·Backtest 표의 것이다 [OWNER 2026-08-19 — "디자인 컨셉을
     * 메인이랑 백테스트에 맞춰서"]: 종목 칸 = **2줄 스택**(이름 600 + 서브라인
     * 뮤트 — 실측 14/600 + 13/500), 행 사이 헤어라인. '지금'과 '숏 수단'은
     * 딴 열이 아니라 서브라인이 진다 — 그 표들의 "1년 평균 · 호가" 자리다. */
    <VStack gap={0.75} width="100%" minHeight={0} flexGrow={1}>
      <div className="sr-rv-rank-fill">
        <div className="sr-rv-rank-scroll">
          <table className="sr-rv-table sr-rv-divided">
          <thead>
            <tr>
              <th className="sr-rv-th">순위</th>
              {/* "Δ" 는 기호 해독을 요구한다 — 이름으로 [OWNER 2026-08-19]. */}
              <th className="sr-rv-th">순위변동</th>
              <th className="sr-rv-th sr-rv-left">종목</th>
              {/* 세 열은 머리가 뜻을 설명한다 [OWNER — "커서 가져다 대면
                  친절하고 간결하게"]. 문장은 토스체. */}
              {/* 열 순서 = 사분면 두 축 먼저 [OWNER 2026-08-20]. 표와 그림이
                  같은 두 숫자로 시작해야 hover 연동이 한 사실을 가리킨다. */}
              <th className="sr-rv-th">
                {/* 문장은 짧게 — 두 문장까지 [OWNER 2026-08-19 "간결하게"]. */}
                <ThHelp
                  label="한 달 수익"
                  help="캐리와 롤로 한 달에 버는 돈이에요. 금리가 안 움직인다고 볼 때예요."
                />
              </th>
              <th className="sr-rv-th">
                <ThHelp
                  label="지난주 백분위"
                  help="지난주 스프레드가 과거 52주 중 몇 %쯤 넓었는지예요. 종목마다 무엇 대비인지는 이름 아래에 적혀 있어요."
                />
              </th>
              <th className="sr-rv-th">
                <ThHelp
                  label="버퍼"
                  help={`금리가 몇 bp 올라도 본전인지예요. ${hMonths}개월 캐리와 롤을 파는 시점의 듀레이션으로 나눈 값이에요.`}
                />
              </th>
              <th className="sr-rv-th">
                <ThHelp
                  label="상대 RV"
                  help="평소 대비 이탈을 σ로 잰 값이에요. +면 평소보다 넓은 쪽이에요."
                />
              </th>
              <th className="sr-rv-th">Score</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr
                key={p.seriesId}
                ref={(el) => {
                  if (el) rowRefs.current.set(p.seriesId, el);
                  else rowRefs.current.delete(p.seriesId);
                }}
                className="sr-rv-row"
                data-on={p.seriesId === highlightId || undefined}
                onClick={() => onSelect(p)}
                onMouseEnter={() => onHover?.(p)}
                onMouseLeave={() => onHover?.(null)}
              >
                <td className="sr-rv-td">{p.rank ?? '—'}</td>
                <td className="sr-rv-td">
                  <Delta d={p.rankDelta} />
                </td>
                <td className="sr-rv-td sr-rv-left">
                  {/* 포커스에도 onHover — 성분 분해가 사분면 리드아웃 카드로
                      가면서(title 은퇴 [OWNER]) 키보드 사용자의 채널이 이것이다. */}
                  <button
                    type="button"
                    className="sr-rv-linkbtn sr-rv-stack"
                    aria-label={`${p.sectorLabel} ${p.tenor} 이력 단면 열기`}
                    onFocus={() => onHover?.(p)}
                    onBlur={() => onHover?.(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(p);
                    }}
                  >
                    <span className="sr-rv-name">
                      {p.sectorLabel} {p.tenor}
                    </span>
                    {/* 헤지수단 표기는 은퇴했다 [OWNER 2026-08-19 — "명시 빼기"].
                        shortable 게이트는 서버 계약에 잔존한다. */}
                    {/* 앵커를 여기 적는다 [트레이더 피드백 2026-08-20] — 한
                        표에 국고 대비와 특은 대비가 섞이므로, 숫자 옆에 무엇
                        대비인지 없으면 두 열을 같은 자로 읽게 된다. */}
                    <span className="sr-rv-sub">
                      {p.baseLabel} 대비 {bp1(p.nowBp)}bp
                    </span>
                  </button>
                </td>
                {/* 사분면 두 축 — 성분 분해(캐리/롤·z 셋)는 native title 이
                    아니라 사분면 리드아웃 카드가 진다. */}
                <td className="sr-rv-td">{sig(p.trMonthBp)}bp</td>
                <td className="sr-rv-td">
                  {p.pctLastWeek != null ? `${p.pctLastWeek.toFixed(0)}%` : '—'}
                </td>
                <td className="sr-rv-td">{sig(p.bufferBp)}bp</td>
                <td className="sr-rv-td">
                  {p.relRv != null ? `${sig(p.relRv, 2)}σ` : '—'}
                </td>
                <td
                  className="sr-rv-td"
                  style={p.score != null ? { background: tintFor(p.score - 50, 50) } : undefined}
                >
                  {p.score != null ? p.score.toFixed(0) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>
      <VStack paddingX={2} paddingBottom={1.5} gap={0.25}>
        {/* 문장은 토스체 — 짧고 쉬운 말 [OWNER 2026-08-19]. 명구("투자판단이
            아니라 RV 랭킹이에요")는 트레이더 의무 문구라 그대로 남는다. */}
        <TextLegal as="span" color="fgMuted">
          투자판단이 아니라 RV 랭킹이에요 — 평소보다 얼마나 벌어졌는지로 줄을
          세워요. ▲▼는 어제와 비교한 순위예요. 줄을 누르면 이력이 열려요.
        </TextLegal>
        {/* 제외는 이유를 진다 — 계약(exclusions)에만 있고 화면에 없던 것의
            수리(3차 크리틱 P2). 상세는 title 이 진다. */}
        {exclusions && exclusions.length > 0 ? (
          <TextLegal
            as="span"
            color="fgMuted"
            title={exclusions.map((e) => `${e.label}: ${e.reason}`).join('\n')}
          >
            랭킹에서 뺀 항목 {exclusions.length}개 —{' '}
            {[...new Set(exclusions.map((e) => e.reason.split(' — ')[0]))].join(' · ')}
          </TextLegal>
        ) : null}
      </VStack>
    </VStack>
  );
}
