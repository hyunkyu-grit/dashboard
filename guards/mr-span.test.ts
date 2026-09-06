/* 전략 실험 창의 **구간과 대사 재료** [OWNER 2026-09-02 — "백테스트 기간을
 * 항상 전체로 설정하다보니 시인성과 목적의식이 불분명" · "진입 레벨과 기준
 * 노셔널과 같은 것들이 전부 나올 수 있게 해야 이게 직접 대사가 가능하므로" ·
 * OWNER 2026-09-04 — "지난 1년, 지난 1분기, 지난 1개월을 전역 설정값으로 두고
 * 이를 조정하면 성과도 바뀌게 해주기"].
 *
 * ## 이 파일이 지는 명제 셋
 *
 * **구간은 채점을 자르지 엔진을 다시 돌리지 않는다.** 2026-09-04 에 구간이
 * «표시»에서 «전역 설정값»이 됐다 — 성과 카드와 최적화 격자가 이 구간에서
 * 채점된다. 그런데 **엔진에 들어가지는 않는다**: 들어가면 z 밴드가 구간
 * 앞머리 룩백만큼 잘려 1개월 창에서 120일 룩백이 아예 못 선다. 그래서 노브
 * 계약(`MrStrategyParams`)에 없어야 하고, stale 을 세우면 안 된다 — 서버가 네
 * 구간을 한 번에 보내 오므로(`spans`) 고르개는 고르기만 한다.
 *
 * **달력 산술은 서버에 하나만 둔다.** 화면이 `monthsBefore` 로 따로 자르던
 * 시절에는 카드(서버 채점)와 곡선(화면 산술)이 하루씩 갈릴 수 있었다 —
 * 말일 넘침·휴장에서. 이제 화면은 `spans[].from` 을 읽는다.
 *
 * **재기준은 산술이지 다른 수가 아니다.** 누적 곡선은 구간 시작을 0 으로 다시
 * 긋는다(`p.cum - baseCum`) — 전체 표시에서 `baseCum = 0` 이라 같은 식이 전체
 * 곡선을 그대로 낸다. 구간 판이 딴 산술을 갖는 순간 두 그림이 대사 불가가 된다.
 *
 * **거래 한 줄은 스스로 검산이 된다.** 일련번호(전체 실행 기준 — 구간을 잘라도
 * 안 바뀐다)·진입/청산 레벨·Δ(bp)가 줄에, 명목·액면(pv01 근사)이 머리에 서서
 * «방향 × Δ × 명목 ≈ 평가» 를 화면만 보고 셈할 수 있다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from './_source';

const root = path.resolve(import.meta.dirname, '..');
const src = (rel: string) => stripComments(fs.readFileSync(path.join(root, rel), 'utf8'));

describe('표시 구간 — 표시만 자른다', () => {
  const code = src('src/mr/StrategyWindow.tsx');

  it('구간은 노브 계약에 없다 — 엔진에 못 들어간다', () => {
    const api = src('src/mr/api.ts');
    /* MrStrategyParams 블록 안에 span 이 서면 페처가 서버로 나른다. */
    const params = api.slice(api.indexOf('export interface MrStrategyParams'), api.indexOf('export const MR_STRATEGY_DEFAULTS'));
    expect(params).not.toMatch(/span/);
    /* 쿼리 조립기에도 안 든다 — 두 페처가 같이 쓰는 그 한 함수가 서버로 나르는
       전부다. (`as="span"` 같은 JSX 표기가 있어 파일 전체를 재면 오탐이다.) */
    const q = api.slice(api.indexOf('function strategyQuery'), api.indexOf('export function fetchMrStrategy'));
    expect(q).not.toMatch(/span/);
    /* stale 판정에도 안 든다 — 결과를 못 바꾸는 손잡이가 재실행을 요구하면
       warnZ 가 밟았던 그 함정이다. */
    const knob = src('src/mr/KnobBar.tsx');
    const staleFn = knob.slice(
      knob.indexOf('export function mrKnobsStale'),
      knob.indexOf('export function MrKnobBar'),
    );
    expect(staleFn).not.toMatch(/span/);
  });

  it('구간은 날짜로 자른다 — 달력 개월이지 봉 수가 아니고, 자는 하나다', () => {
    /* 목록은 `api.ts` 가 지고(서버 `mrmetrics.SPANS` 의 거울), 달력 산술은
       **서버에만** 있다. 화면이 자기 `monthsBefore` 로 또 자르면 카드와 곡선이
       하루씩 갈릴 수 있고, 그때 「구간 순손익」과 「총손익」이 다른 수가 된다. */
    const api = src('src/mr/api.ts');
    expect(api).toMatch(/months: 12/);
    expect(api).toMatch(/months: 3/);
    expect(api).toMatch(/months: 1/);
    expect(code).not.toMatch(/function monthsBefore/);
    /* 화면이 자르는 자리는 서버가 채점한 첫 봉이다. */
    expect(code).toMatch(/perf\?\.from/);
    expect(code).toMatch(/run\.points\.findIndex\(\(p\) => p\.t >= from\)/);
  });

  it('성과가 구간을 따라간다 — 카드가 `spans` 를 읽는다', () => {
    /* 2026-09-04 이전에는 카드가 `run.summary`(전체 기간)를 읽어서, 구간을
       바꿔도 성과가 안 움직였다. 그 회귀를 여기서 잠근다. */
    expect(code).toMatch(/run\?\.spans\?\.find\(\(b\) => b\.span === span\)/);
    /* 구 백엔드에서 옛 summary 로 조용히 떨어지지 않는다 — 그러면 화면이 전체
       기간의 수를 이 구간의 수인 것처럼 말한다. */
    expect(code).toMatch(/구간별 성과는 새 백엔드가 필요해요/);
    /* 샤프는 화면에서 내려갔다(계약·엔진에는 남는다 — 적합성 벡터가 잠근다). */
    const body = code.slice(code.indexOf('<StatColumn title="성과">'));
    expect(body).not.toMatch(/label="Sharpe"/);
  });

  it('누적 곡선은 구간 시작 0 재기준 — 전체 표시와 한 산술이다', () => {
    expect(code).toMatch(/p\.cum - baseCum/);
    /* 재기준점은 구간 **직전** 봉의 누적이다 — 첫 봉을 빼면 첫날 손익이 사라진다. */
    expect(code).toMatch(/run\.points\[w0 - 1\]!\.cum/);
  });

  it('고르개는 캐논 부품이고 **노브 줄**에 산다 — PeriodSelector + 무부호 판', () => {
    /* 손수 만든 알약 줄이 아니라 Main 미리보기의 그 컨트롤. 이 고르개의 선택은
       데이터 부호가 없으므로 `.sr-tabs-neutral`(theme/type.css 의 그 주석).
       2026-09-04 에 창 본문에서 **노브 바**로 올라갔다 — 결과를 바꾸는 것은
       설정 줄에 있어야 한다(`Panel.aside` 주석의 그 규율). */
    const knob = src('src/mr/KnobBar.tsx');
    expect(knob).toMatch(/PeriodSelector/);
    expect(knob).toMatch(/sr-tabs-neutral/);
    /* 두 벌이 되지 않게 — 창 본문에는 없다. */
    expect(code).not.toMatch(/PeriodSelector/);
  });

  it('사건 마커는 구간만큼 옮겨 세운다 — 전체 인덱스를 그대로 찍으면 딴 날에 선다', () => {
    expect(code).toMatch(/\.filter\(\(\[i\]\) => i >= w0\)/);
    expect(code).toMatch(/index: i - w0/);
  });
});

describe('거래 한 줄이 스스로 검산이 된다', () => {
  const code = src('src/mr/StrategyWindow.tsx');

  it('일련번호는 전체 실행 기준 — 번호를 먼저 매기고 그다음 자른다', () => {
    /* filter 뒤에 매기면 같은 거래가 구간마다 딴 번호를 갖는다 — 그건 번호가
       아니다. map(번호) → filter(구간) 순서가 그 규율이다. */
    expect(code).toMatch(/\.map\(\(t, k\) => \(\{ t, n: k \+ 1 \}\)\)\s*\.filter/);
  });

  it('레벨·Δ 열이 거래 표에 선다 — 청산 레벨 − 진입 레벨 ≈ Δ 가 한 줄에서 닫힌다', () => {
    expect(code).toMatch(/진입 레벨/);
    expect(code).toMatch(/청산 레벨/);
    /* bp 계열 레벨은 **2자리**다(fmtReconLevel) — Δ 가 2자리라 1자리 레벨로는
       「청산 − 진입 = Δ」가 표시 정밀도에서 깨진다(실측 3.5→1.8 대 Δ −1.75). */
    expect(code).toMatch(/fmtReconLevel\(t\.entryV, unit\)/);
    expect(code).toMatch(/fmtReconLevel\(t\.exitV, unit\)/);
    expect(code).toMatch(/unit === 'bp' \? v\.toFixed\(2\)/);
    expect(code).toMatch(/fmtBp\(t\.dv, 2\)/);
  });

  it('레벨이 화면에 서고, 대사와 **같은 위계**로 선다', () => {
    /* 2026-09-03 에 레벨·z 가 대사표에서 나와 「일별 레벨」 칸이 됐다
       [OWNER — "일별대사와 일별레벨은 동일한 위계임"]. 지키는 명제는 둘이다:
       레벨이 여전히 화면에 서고, 그것이 대사의 **하위가 아니라 형제 탭**이다.
       위계가 무너지면 「어디에 있었나」가 「얼마나 벌었나」의 부속이 된다. */
    /* 열을 **상수로 붙들지 않는다** — 다리 이름이 계열마다 달라서 화면이
       다리에서 뽑는다(2026-09-03 감사: 상수를 두었더니 화면은 안 읽고 가드만
       읽는 죽은 상수가 됐고, `국고·IRS` 로 못 박혀 선물 계열에선 틀렸다). */
    expect(code).toMatch(/const levelCols/);
    expect(code).toMatch(/'레벨', 'z'/);
    expect(code).toMatch(/kind="level"/);
    expect(code).toContain('levelPane');
    /* 서랍 탭 배열에 둘이 나란히 — 하나가 다른 하나 안에 들어가면 안 된다. */
    const tabs = code.slice(code.indexOf('drawer={['), code.indexOf(']}', code.indexOf('drawer={[')));
    expect(tabs).toContain("id: 'recon'");
    expect(tabs).toContain("id: 'levels'");
  });

  it('다리 레벨(국고·IRS·CD)이 점에 실리고 화면이 조건부로 세운다', () => {
    /* [OWNER 2026-09-02 — "스왑 파 커브 상의 레벨, 채권 커브 상의 레벨, CD금리
       레벨이 진입시점에 확인되고"]. 계약은 점에 싣는다(거래에 또 실으면 같은
       수가 두 자리다) — 화면은 진입일을 찾아 적고, BSS 아닌 계열·구 백엔드에선
       열이 통째로 접힌다(빈 열은 없는 데이터를 있는 척한다). */
    const api = src('src/mr/api.ts');
    expect(api).toMatch(/govt\?: number \| null/);
    expect(api).toMatch(/irs\?: number \| null/);
    expect(api).toMatch(/cd\?: number \| null/);
    expect(code).toMatch(/진입 국고/);
    /* CD 는 **다리가 아니다**(감도·Δ 가 없어 줄로 세우면 유령 다리가 된다) —
       「일별 레벨」의 맨 끝 열로 서고 BSS 에만 있다. 다리 레벨 자체는 서버가
       봉마다 실어 준 `legs[].lvl` 을 그대로 적는다. */
    expect(code).toMatch(/hasLegLevels \? \['CD'\]/);
    /* 값은 이름이 아니라 **자리**로 찾는다 — 머리와 몸통이 `legNames` 한
       목록만 읽어야 봉 하나가 다리를 빠뜨려도 격자가 안 어긋난다
       (2026-09-03 감사가 그 두 출처를 잡았다). */
    expect(code).toMatch(/const legNames/);
    expect(code).toMatch(/p\.legs\?\.\[j\]\?\.lvl/);
    expect(code).toMatch(/hasLegLevels/);
    /* 서버 조인은 캐리와 같은 출처(mrseries)다 — 낱개 라우트 안에서. */
    const py = fs.readFileSync(path.join(root, 'backend/app/main.py'), 'utf8');
    const strat = py.slice(py.indexOf('def mr_strategy('), py.indexOf('def mr_book('));
    expect(strat).toMatch(/mrs\.legs\(/);
    expect(strat).toMatch(/mrs\.bundle\(\)\["cd"\]/);
  });

  it('청산 z 는 null 일 수 있다 — 서버는 가드하고 화면은 — 로 적는다', () => {
    /* 타임스탑은 z 를 안 보므로 time 청산이 σ=0(z=null) 봉에 앉을 수 있다.
       무가드 round 가 유효 노브(lookback 2~600 × timeStop)에서 창을 통째로
       500 으로 죽였다(2026-09-02 적대 대사가 잡음). 같은 무가드가 화면의
       toFixed 로 재연되면 안 된다. */
    const py = fs.readFileSync(path.join(root, 'backend/app/main.py'), 'utf8');
    expect(py).toMatch(/round\(t\["exitZ"\], 2\) if t\["exitZ"\] is not None else None/);
    expect(src('src/mr/api.ts')).toMatch(/exitZ: number \| null/);
    expect(code).toMatch(/exitZ == null \? '—'/);
    expect(src('src/mr/BookWindow.tsx')).toMatch(/exitZ == null \? '—'/);
  });

  it('명목·액면이 화면에 서고, 액면은 **거래마다 진입일 커브**로 잰다', () => {
    /* 2026-09-03 검산이 잡은 자리다. 종전에는 액면을 **지금 커브** pv01 하나로
       6년 내내 환산했고, `mrcarry` 가 그것을 「[알려진 근사]」로 적으면서
       «크기만 정하고 부호·시점은 안 건드린다» 고 했다 — 손익이
       `명목 × Δ스프레드` 이던 시절에는 참이었다.

       회계가 실가격으로 바뀌면서 그 문장이 거짓이 됐다: 손익이 액면을 가격해서
       나오므로 환산 오차가 손익 전체를 스케일한다. 실측으로 옛 거래가 명목
       노브보다 최대 16%(10Y) 큰 포지션이었고 총손익이 2~8% 부풀어 있었다.

       그래서 거래마다 진입일 커브로 잰다. 지키는 명제는 **「명목 N원/bp」가 모든
       거래에서 같은 뜻이다** — 그 항등(`명목 = 액면 × pv01 × 1e-4`)이 페이로드
       안에서 닫히는 것은 `test_mr_legrecon` 이 라우트를 타고 잰다. */
    /* `pv01` 이 **null 일 수 있다** [2026-09-04]: 선물 계열은 스왑 연금계수가
       아니라 합성채 PVBP 로 환산하므로 그 항등(`명목 = 액면 x pv01 x 1e-4`)이
       안 선다 — 그 칸을 비운다(공란 정책). 타입이 그 사실을 지지 않으면
       화면이 없는 수를 곱한다. */
    expect(src('src/mr/api.ts')).toMatch(
      /principal: \{ krw: number; pv01: number \| null \} \| null/,
    );
    /* 머리의 액면은 «지금 세우면» 이라고 화면이 말한다. */
    expect(code).toMatch(/지금 커브/);
    const py = fs.readFileSync(path.join(root, 'backend/app/main.py'), 'utf8');
    expect(py).toMatch(/def _mr_pv01_at\(/);
    expect(py).toMatch(/def _mr_principal_at\(/);
    /* 대사 라우트와 엔진이 **같은 자**를 쓴다 — 안 그러면 표와 헤드라인이 갈린다. */
    expect(py).toMatch(/principal = _mr_principal_at\(entry_d, tenor, notional\)/);
    /* 회계 쪽 호출. 2026-09-04 에 선물 갈래가 붙으면서 날짜를 위에서 한 번만
       파싱하게 바뀌었다 — 지키는 명제는 그대로 「**그 거래의 진입일**로 잰다」
       이므로 표기만 옮긴다(가드가 옛 표기를 붙들면 리팩터가 못 지나간다). */
    expect(py).toMatch(/e_d, x_d = dt\.date\.fromisoformat\(e_iso\), dt\.date\.fromisoformat\(x_iso\)/);
    expect(py).toMatch(/principal = _mr_principal_at\(e_d, tenor, notional\)/);
    /* **미청산 다리도 같이 가격한다** — 총손익·낙폭이 그것을 실시간으로 지고
       있어서(`mrbacktest` 의 그 주석), 빼먹으면 그 구간 봉이 통째로 0 이 되고
       `Σ거래 + 미청산 ≠ 총손익` 이 된다(실측 2026-09-03: BSS-9M 51봉). */
    expect(py).toMatch(/legs_to_price\.append\(\(op,/);
    expect(py).toMatch(/summary"\]\["openPnl"\] = op\["pnl"\]/);
  });
});
