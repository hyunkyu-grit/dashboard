'use client';

/* Lab 「모형」 — 세 면의 셸.
 *
 * ## 이 파일은 세션 1 것이고, 세션 2·3 은 여기를 고치지 않는다
 *
 * 두 세션이 **동시에** 돈다. 셸·라우팅·레이아웃을 각자 건드리면 병합 시점에
 * 충돌하고, 충돌한 셸은 양쪽 화면을 다 못 뜨게 만든다. 그래서 껍데기는 여기서
 * 끝내고 각자 자기 슬롯 안에만 컴포넌트를 넣는다.
 *
 *     strategy/   세션 2
 *     model/      세션 3
 *     method/     세션 3
 *
 * ## 왜 면이 셋인가 [OWNER 2026-08-21]
 *
 * 읽는 사람이 다르다. **Strategy** 는 매일 쓰는 것 — 경로 하나를 놓으면 데스크
 * 노트가 나온다. **Model** 은 «이 숫자 어디서 왔어» 에 답한다. **Method** 는
 * «믿어도 돼» 에 답한다. 한 화면에 합치면 셋 다 안 읽힌다.
 *
 * 이 물건의 자리는 **셀사이드 데스크 전략 도구**다 — 거시 뷰를 커브 포지션으로
 * 옮기는 것이지, 리서치 전망 제품도 아니고 트레이더가 직접 조작하는 화면도
 * 아니다.
 *
 * ## 면은 탭이 아니라 URL 상태다
 *
 * `?g=lab&lab=model&view=strategy`. Lab 세입자가 그렇게 사는 것과 같은 이유다
 * (`ui/nav.ts` 의 주석) — 탭 상태를 따로 들면 «섹션은 유도값» 규칙에 두 번째
 * 상태가 끼어든다. 앵커 링크(`anchors.ts::hrefFor`)도 이 파라미터로 면을 옮긴다.
 */

import { useCallback, useEffect, useState } from 'react';

import { HStack, VStack } from '@coinbase/cds-web/layout';
import { SegmentedTabs } from '@coinbase/cds-web/tabs';
import { Text } from '@coinbase/cds-web/typography';

import { ErrorBoundary } from '@/ui/ErrorBoundary';

import { SURFACES, SURFACE_BLURB, SURFACE_LABEL, type Surface } from './anchors';

/** `SegmentedTabs` 는 `activeTab` 을 **객체 신원**으로 비교한다 — 렌더마다 새
 *  배열을 만들면 활성 표시가 흔들린다(`ScenarioPage` 가 같은 자리에 같은 주석을
 *  달아 두었다). 그래서 모듈 상수다. */
const VIEW_TABS = SURFACES.map((id) => ({ id, label: SURFACE_LABEL[id] }));

function readView(): Surface {
  if (typeof window === 'undefined') return 'strategy';
  const v = new URLSearchParams(window.location.search).get('view');
  return (SURFACES as readonly string[]).includes(v ?? '') ? (v as Surface) : 'strategy';
}

/** 세션 2·3 이 자기 슬롯을 채우기 전까지 서 있는 자리.
 *
 * 빈 화면이 아니라 **누가 채울 자리인지**를 말한다. 아무것도 없는 면은 «고장»
 * 으로 읽히고, 그러면 다음 사람이 원인을 찾느라 시간을 쓴다. */
function Slot({ surface, owner }: { surface: Surface; owner: string }) {
  return (
    <VStack gap={1} paddingY={4} maxWidth={620}>
      <Text as="h2" font="title3">
        {SURFACE_LABEL[surface]}
      </Text>
      {/* 설명은 **머리에 한 번만** 선다. 처음엔 여기에도 뒀는데 탭 옆의 것과
          나란히 두 번 찍혔다(실측 2026-08-21). 슬롯이 할 말은 «누가 채우나»
          하나다. */}
      <Text as="p" font="body" color="fgMuted">
        아직 비어 있어요 — {owner}이 채워요.
      </Text>
      <Text as="p" font="legal" color="fgMuted">
        껍데기·계약·앵커는 서 있고 엔진 산출물도 준비돼 있어요. 읽을 것은
        <b> docs/MODEL_LANE_CONTEXT.md</b> 예요.
      </Text>
    </VStack>
  );
}

export function ModelSpace() {
  const [view, setView] = useState<Surface>('strategy');

  /* URL 이 정본이다. 첫 렌더에서 서버·클라이언트가 갈리지 않게 마운트 뒤에
     읽는다(`window` 는 서버에 없다). */
  useEffect(() => {
    setView(readView());
    const onPop = () => setView(readView());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((next: Surface) => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set('view', next);
    /* `replace` 다 — 면을 옮기는 것은 새 목적지가 아니라 같은 화면의 자리
       이동이라, 뒤로가기가 면 전환을 하나씩 되짚으면 Lab 을 빠져나가는 데
       세 번이 걸린다(백테스트 창이 같은 이유로 replace 를 쓴다). */
    window.history.replaceState(null, '', url);
  }, []);

  return (
    <VStack gap={2} width="100%" minHeight={0} flexGrow={1}>
      <HStack gap={2} alignItems="center" flexWrap="wrap">
        <SegmentedTabs
          accessibilityLabel="전략 · 모형 · 방법"
          tabs={VIEW_TABS}
          activeTab={VIEW_TABS.find((t) => t.id === view) ?? null}
          onChange={(t) => t && go(t.id)}
        />
        <Text as="span" font="legal" color="fgMuted">
          {SURFACE_BLURB[view]}
        </Text>
      </HStack>

      {/* 면마다 경계를 따로 둔다 — 한 면이 깨져도 나머지 둘은 열려야 한다.
          세션 둘이 동시에 짜는 동안 특히 그렇다. */}
      <ErrorBoundary
        region={`모형 · ${SURFACE_LABEL[view]}`}
        fallback={`${SURFACE_LABEL[view]} 면을 그리지 못했어요.`}
      >
        {view === 'strategy' ? (
          <Slot surface="strategy" owner="다음 세션" />
        ) : view === 'model' ? (
          <Slot surface="model" owner="다음 세션" />
        ) : (
          <Slot surface="method" owner="다음 세션" />
        )}
      </ErrorBoundary>
    </VStack>
  );
}
