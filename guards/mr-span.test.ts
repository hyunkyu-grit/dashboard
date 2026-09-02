/* 전략 실험 창의 **표시 구간과 대사 재료** [OWNER 2026-09-02 — "백테스트 기간을
 * 항상 전체로 설정하다보니 시인성과 목적의식이 불분명" · "진입 레벨과 기준
 * 노셔널과 같은 것들이 전부 나올 수 있게 해야 이게 직접 대사가 가능하므로"].
 *
 * ## 이 파일이 지는 명제 셋
 *
 * **표시 구간은 백테스트가 아니다.** 구간 탭(전체·1년·1분기·1개월)은 차트와
 * 거래 표의 «표시»만 자른다 — 엔진에 들어가면 z 밴드가 구간 앞머리 룩백만큼
 * 잘리고 「전체 재현」이라는 창의 계약이 깨진다. 그래서 노브 계약
 * (`MrStrategyParams`)에 없어야 하고, stale 을 세우면 안 된다.
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

  it('구간은 날짜로 자른다 — 달력 개월이지 봉 수가 아니다', () => {
    expect(code).toMatch(/monthsBefore\(/);
    expect(code).toMatch(/months: 12/);
    expect(code).toMatch(/months: 3/);
    expect(code).toMatch(/months: 1/);
  });

  it('누적 곡선은 구간 시작 0 재기준 — 전체 표시와 한 산술이다', () => {
    expect(code).toMatch(/p\.cum - baseCum/);
    /* 재기준점은 구간 **직전** 봉의 누적이다 — 첫 봉을 빼면 첫날 손익이 사라진다. */
    expect(code).toMatch(/run\.points\[w0 - 1\]!\.cum/);
  });

  it('고르개는 캐논 부품이다 — PeriodSelector + 무부호 판', () => {
    /* 손수 만든 알약 줄이 아니라 Main 미리보기의 그 컨트롤. 이 고르개의 선택은
       데이터 부호가 없으므로 `.sr-tabs-neutral`(theme/type.css 의 그 주석). */
    expect(code).toMatch(/PeriodSelector/);
    expect(code).toMatch(/sr-tabs-neutral/);
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

  it('일별 대사에 레벨 열이 있다 — Δ 가 어느 값에서의 변화인지 표가 스스로 보인다', () => {
    expect(code).toMatch(/\{ k: '레벨' \}/);
    expect(code).toMatch(/kind="level"/);
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
    expect(code).toMatch(/RECON_LEG_COLS/);
    expect(code).toMatch(/hasLegs/);
    /* 서버 조인은 캐리와 같은 출처(mrseries)다 — 낱개 라우트 안에서. */
    const py = fs.readFileSync(path.join(root, 'backend/app/main.py'), 'utf8');
    const strat = py.slice(py.indexOf('def mr_strategy('), py.indexOf('def mr_book('));
    expect(strat).toMatch(/mrs\.legs\(/);
    expect(strat).toMatch(/mrs\.bundle\(\)\["cd"\]/);
  });

  it('명목·액면이 화면에 선다 — 액면은 근사임을 같이 적는다', () => {
    /* 서버가 환산한다(지금 커브 pv01 하나 — 근사). 계약에 있어야 화면이 적는다. */
    expect(src('src/mr/api.ts')).toMatch(/principal: \{ krw: number; pv01: number \} \| null/);
    expect(code).toMatch(/pv01 근사/);
    const py = fs.readFileSync(path.join(root, 'backend/app/main.py'), 'utf8');
    /* 환산식은 캐리의 그 식과 같아야 한다 — 명목 / (pv01 × 1e-4). */
    expect(py).toMatch(/notional \/ \(pv \* 1e-4\)/);
  });
});
