/* BSS 테너 **통합** 밴드 워치 [OWNER 2026-09-01 — "BSS만을 활용한 전략을 구상한다고
 * 할 때 지금은 각 테너별로 흩어져있는데, BSS 테너 통합 밴드 워치를 하나 만들어서
 * 승률 및 세부사항들을 확인할 수 있게 해줘.. 밴드워치 랭킹 순위, 계열 밑에 따로
 * 하나 빼주면 되겠다"].
 *
 * ## 이 파일이 지는 명제 넷
 *
 * **통합 줄은 랭킹이 아니다.** |z| 로 매긴 순위에 집계 한 줄을 끼우면 그 줄이
 * 「14위」로 읽힌다. 순위 칸은 비고, 레벨·전일 칸은 아예 값이 없다 — 만기가 다른
 * 아홉 스프레드의 평균은 거래할 수 있는 값이 아니라서 지어내지 않는다.
 *
 * **고정은 CSS 한 줄에 달려 있다.** CDS `Table` 이 표를 `overflow: auto` 상자로
 * 감싸므로 sticky 의 기준이 바깥 스크롤러가 아니라 그 상자가 된다. 그걸 풀어 주는
 * 규칙이 없으면 통합 줄도 **열 머리도** 안 붙는다(실측 2026-09-01: thead 가
 * −107px 로 밀려 올라갔고, 그때까지 주석은 「머리는 스크롤을 따라온다」였다).
 *
 * **승률의 분모와 걸린 돈을 화면이 말한다.** 통합 승률은 아홉 승률의 평균이 아니라
 * 한 통에 모은 거래의 승률이고(실측 78.41% 대 78.29% — 갈린다), 동일가중 합이라
 * 아홉이 동시에 서면 명목이 아홉 배다. 둘 다 안 적으면 큰 숫자만 남는다.
 *
 * **노브는 한 벌이다.** 낱개 창과 통합 창이 노브를 따로 그리면 프리셋 하나만
 * 바뀌어도 두 화면이 갈리고, 「낱개로는 벌고 통합으로는 잃는다」가 규칙 탓인지
 * 노브 탓인지 못 가린다. 서버도 같은 자리를 하나로 뒀다(`main._mr_leg`).
 *
 * 합치기의 산술 자체(총합·승률·상관·손익분기)는 파이썬 시험이 진다
 * (`backend/tests/test_mrbook.py`) — 그 계산이 사는 곳이 거기다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from './_source';

const root = path.resolve(import.meta.dirname, '..');
const src = (rel: string) => stripComments(fs.readFileSync(path.join(root, rel), 'utf8'));
const raw = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('통합 줄은 랭킹이 아니다', () => {
  const page = src('src/mr/MrPage.tsx');

  it('랭킹 행 뒤에 **따로** 선다 — `rows.map` 밖이다', () => {
    /* 지도의 일부로 그리면(예: rows 에 밀어 넣기) 순위가 매겨진다.
       ⚠ 종전 판정은 `page.indexOf('))}')` 로 **파일의 첫** `))}` 를 집었는데
       그건 `BookDetail` 안 스트립 map 의 끝이라(192줄) 통합 줄을 랭킹 map
       **안**으로 밀어 넣어도 초록이었다(2026-09-02 검사). 이제 `rows.map(` 의
       여는 괄호부터 짝이 맞는 닫는 괄호까지를 잘라 **그 안에 없음**을 본다. */
    expect(page).toMatch(/\{watch \?/);
    expect(page).toMatch(/className="sr-mr-book"/);
    const open = page.indexOf('rows.map(');
    expect(open, 'rows.map(').toBeGreaterThan(0);
    let depth = 0;
    let close = -1;
    for (let i = page.indexOf('(', open); i < page.length; i++) {
      const c = page[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) { close = i; break; } }
    }
    expect(close, 'rows.map 의 닫는 괄호').toBeGreaterThan(open);
    expect(page.slice(open, close)).not.toContain('sr-mr-book');
  });

  it('레벨·전일 칸에 수를 안 적는다 — 평균 낼 수 없는 것은 안 낸다', () => {
    const row = page.slice(page.indexOf('className="sr-mr-book"'), page.indexOf('watchText(watch)'));
    /* 순위·값·1D 세 칸이 전부 `MINUS` 한 글자다. */
    expect(row.match(/\{MINUS\}/g)?.length).toBe(3);
    /* 계약에도 그 자리가 없다 — 서버가 아예 안 보낸다. */
    const api = src('src/mr/api.ts');
    const watch = api.slice(api.indexOf('export interface MrWatch {'), api.indexOf('export interface MrBoard'));
    expect(watch).not.toMatch(/^\s*v:/m);
    expect(watch).not.toMatch(/^\s*d1:/m);
    for (const k of ['meanAbsZ', 'meanPctB', 'outLow', 'outHigh', 'reentry', 'inside', 'peak']) {
      expect(watch, k).toMatch(new RegExp(`${k}:`));
    }
  });

  it('만기 순 스트립은 만기 순이다 — 서버가 준 차례를 다시 정렬하지 않는다', () => {
    const detail = page.slice(page.indexOf('function BookDetail'), page.indexOf('export function MrPage'));
    expect(detail).toMatch(/watch\.legs\.map/);
    expect(detail).not.toMatch(/\.sort\(/);
  });

  it('종가가 갈리면 그 사실을 말한다 — 최신 날짜만 적지 않는다', () => {
    expect(page).toMatch(/watch\.stale/);
    expect(page).toMatch(/watch\.asofMin/);
  });
});

describe('고정 — 통합 줄도 열 머리도 붙는다', () => {
  const css = raw('src/theme/type.css');

  it('CDS 가 두른 `overflow: auto` 상자를 풀어 준다', () => {
    /* 이 규칙이 없으면 sticky 의 기준 스크롤러가 «굴릴 것이 없는 상자» 가 된다.
       지우면 통합 줄과 열 머리가 **조용히** 안 붙는다 — 에러도 경고도 없다. */
    expect(css).toMatch(/\.sr-rv-rank-scroll > div \{\s*overflow: visible;/);
  });

  it('통합 줄은 바닥에 붙고 배경이 불투명하다', () => {
    const block = css.slice(css.indexOf('tr.sr-mr-book > td {'));
    expect(block).toMatch(/position: sticky;/);
    expect(block).toMatch(/bottom: 0;/);
    /* 반투명이면 밑을 지나는 틴트가 비쳐 줄이 격자처럼 읽힌다(ReconStack 의 규칙). */
    expect(block).toMatch(/background: var\(--sr-card\);/);
  });

  it('색이 아니라 헤어라인이 랭킹과 가른다 — 사이드 스트라이프 금지', () => {
    const block = css.slice(css.indexOf('tr.sr-mr-book > td {'), css.indexOf('tr.sr-mr-book > td {') + 600);
    expect(block).not.toMatch(/border-left/);
    expect(block).toMatch(/--color-bgLine/);
    expect(block).not.toMatch(/--sr-(up|down)/);
  });
});

describe('통합 장부 창이 말해야 하는 것', () => {
  const win = src('src/mr/BookWindow.tsx');

  it('승률의 **분모**를 적는다 — 아홉 승률의 평균이 아니다', () => {
    expect(win).toMatch(/한 통에/);
    /* 미청산 다리는 원본 규약대로 승률에 안 든다 — 몇 다리인지를 옆에서 말한다. */
    expect(win).toMatch(/openLegs/);
    expect(win).toMatch(/미청산 \$\{run\.summary\.openLegs\}다리/);
  });

  it('걸린 돈을 적는다 — 동일가중 합의 대가', () => {
    expect(win).toMatch(/book\.maxLegs/);
    expect(win).toMatch(/book\.peakNotional/);
    expect(win).toMatch(/book\.idleShare/);
  });

  it('묶어서 나아졌는지를 답한다 — 개별 SR·쌍상관·유효 독립', () => {
    expect(win).toMatch(/legSharpe\.median/);
    expect(win).toMatch(/diversification\.meanPairCorr/);
    expect(win).toMatch(/diversification\.effectiveN/);
  });

  it('못 선 만기를 조용히 빼지 않는다', () => {
    expect(win).toMatch(/run\.excluded/);
  });

  it('없는 것도 적는다 — 이웃 칸이 왜 없는지', () => {
    expect(win).toMatch(/이웃 칸/);
  });

  it('명구 의무 — 재현 도구이고 국고 다리는 민평이다', () => {
    expect(win).toMatch(/투자판단이 아니에요/);
    expect(win).toMatch(/민평/);
  });
});

describe('노브는 한 벌이다', () => {
  it('두 창이 같은 노브 바와 같은 stale 판정을 임포트한다', () => {
    for (const f of ['src/mr/StrategyWindow.tsx', 'src/mr/BookWindow.tsx']) {
      const code = src(f);
      expect(code, f).toMatch(/import \{ MrKnobBar, mrKnobsStale \} from '\.\/KnobBar'/);
    }
  });

  it('σ 알약은 `KnobBar` 에만 있고, 값 고르개·숫자 칸 손 구현은 없다', () => {
    /* 2026-09-02 승격의 명제 갱신: 종전에는 `NumInput`·`Choice` 도 KnobBar 의
       로컬이었는데, 숫자 칸은 공용 `NumField`(ui/ControlCard), 배타 선택은 캐논
       `Segmented`(같은 파일)가 됐다 — 손 구현이 mr 어디에도 되살아나면 안 된다.
       `SigmaPick` 만 남는다(프리셋 밖 값이면 무선택이라는 자기 근거가 그 파일
       주석에 있다). 공용 쪽의 단일성은 `guards/shared-controls.test.ts` 가 진다. */
    const mrFiles = ['src/mr/KnobBar.tsx', 'src/mr/StrategyWindow.tsx', 'src/mr/BookWindow.tsx', 'src/mr/MrPage.tsx'];
    const sigmaHomes = mrFiles.filter((f) => src(f).includes('function SigmaPick'));
    expect(sigmaHomes).toEqual(['src/mr/KnobBar.tsx']);
    for (const name of ['function NumInput', 'function Choice']) {
      const homes = mrFiles.filter((f) => src(f).includes(name));
      expect(homes, `${name} 손 구현은 승격으로 사라졌다`).toEqual([]);
    }
    expect(src('src/mr/KnobBar.tsx')).toMatch(
      /import \{ Field, NumField, Segmented \} from '@\/ui\/ControlCard'/,
    );
  });

  it('청산 사유의 우리말은 앱에 한 벌이다 — 두 표가 같은 사건을 같게 부른다', () => {
    const homes = ['src/mr/parts.tsx', 'src/mr/StrategyWindow.tsx', 'src/mr/BookWindow.tsx']
      .filter((f) => src(f).includes('const WHY_WORD'));
    expect(homes).toEqual(['src/mr/parts.tsx']);
    for (const f of ['src/mr/StrategyWindow.tsx', 'src/mr/BookWindow.tsx']) {
      expect(src(f), f).toMatch(/WHY_WORD/);
    }
  });

  it('통합 창의 노브 쿼리는 낱개와 **한 함수**에서 나온다', () => {
    const api = src('src/mr/api.ts');
    expect(api).toMatch(/function strategyQuery\(/);
    /* 두 페처가 같은 조립기를 쓴다 — 한쪽만 노브가 빠지면 두 판이 딴 규칙이 된다. */
    const strat = api.slice(api.indexOf('export function fetchMrStrategy'));
    expect(strat).toMatch(/strategyQuery\(p\)/);
    const book = api.slice(api.indexOf('export function fetchMrBook'));
    expect(book).toMatch(/strategyQuery\(p\)/);
  });
});

describe('서버도 한 자리다', () => {
  it('낱개 라우트와 통합 라우트가 같은 준비·시뮬 함수를 부른다', () => {
    const py = fs.readFileSync(path.join(root, 'backend/app/main.py'), 'utf8');
    expect(py).toMatch(/def _mr_leg\(/);
    const strategy = py.slice(py.indexOf('def mr_strategy('), py.indexOf('def mr_book('));
    expect(strategy).toMatch(/_mr_leg\(/);
    const book = py.slice(py.indexOf('def mr_book('));
    expect(book).toMatch(/_mr_leg\(/);
    /* 노브 검증도 한 문이다 — 두 벌이면 한쪽만 통과하는 조합이 생긴다. */
    expect(strategy).toMatch(/_mr_check_knobs\(/);
    expect(book).toMatch(/_mr_check_knobs\(/);
  });

  it('보드 페이로드가 바뀌었으니 캐시 스키마가 올라가 있다', () => {
    /* 안 올리면 옛 캐시가 `watch` 없는 보드를 계속 내주고 화면은 통합 줄을
       아예 안 그린다 — 실제로 한 번 밟았다(2026-09-01). v14 = fut defn 정정
       (「5% 합성」 오라벨 — 2026-09-02 적대 대사). */
    const cache = fs.readFileSync(path.join(root, 'backend/app/cache.py'), 'utf8');
    expect(cache).toMatch(/SCHEMA_VERSION = 14/);
    expect(cache).toMatch(/v14 \(2026-09-02\)/);
  });
});
