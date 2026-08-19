'use client';

import { Component, type ReactNode } from 'react';

import { VStack } from '@coinbase/cds-web/layout';
import { TextBody, TextCaption } from '@coinbase/cds-web/typography';

/**
 * 한 영역이 렌더 중에 던져도 **그 영역만** 죽는다.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * React 에서 렌더 예외에 경계가 없으면 루트까지 언마운트된다. 이 제품에서 그건
 * **흰 화면**이고, 흰 화면은 "백엔드가 느리다" 와 구분되지 않는다 — 이 리포가
 * `DataState` 를 만들면서 이미 고친 실패의 얼굴 그대로다(같은 파일 주석). 표 한
 * 칸의 포맷터가 `null` 에 걸린 것 때문에 상단 내비까지 사라지면, 읽는 사람은
 * 되돌릴 방법이 없다.
 *
 * ── `DataState` 와 무엇이 다른가 ────────────────────────────────────────────
 * `ErrorState` 는 **가져오기** 실패다 — 원인을 알고, 다시 시도가 답이다.
 * 여기는 **렌더** 실패다 — 원인은 코드 결함이고 다시 그려도 같은 자리에서 또
 * 죽는다. 그래서 「다시 시도」 버튼을 두지 않는다. 없는 회복을 제안하지 않는 것이
 * 이 제품의 규칙이다.
 *
 * ── 경계는 화면당 하나가 아니라 영역마다 하나다 ─────────────────────────────
 * 표·미리보기·창·띠가 각자 경계를 진다. 하나로 묶으면 미리보기의 결함이 표를
 * 지우고, 그러면 "무엇이 고장났는지" 를 화면이 못 말한다. `region` 은 콘솔 줄에
 * 쓰이는데, 경계가 넷이면 "상세 뷰 오류" 는 셋에서 거짓말이 된다(v1 의 실측 주석).
 */

interface Props {
  children: ReactNode;
  /** 읽는 사람이 보는 한 줄. 무엇이 안 그려졌는지를 말한다. */
  fallback: string;
  /** 콘솔 줄에 붙는 영역 이름. */
  region: string;
  /** 크롬 높이의 영역(하단 띠)은 한 줄짜리 대체물을 받는다 — 34px 안에 문단이
   * 들어갈 자리가 없고, 블록을 넣으면 띠가 고정하려던 레이아웃을 도로 민다. */
  compact?: boolean;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // 진단은 콘솔로, 읽는 사람은 대체물만 본다.
    console.error(`[sauron-v2] ${this.props.region} 렌더 오류:`, error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.compact) {
      return (
        <div className="sr-eb-compact" role="alert">
          {this.props.fallback}
        </div>
      );
    }

    return (
      <VStack gap={0.5} padding={3} alignItems="center" justifyContent="center" role="alert">
        <TextBody as="p">{this.props.fallback}</TextBody>
        {/* 메시지는 옅게, 그러나 **보인다**. 이 줄이 없으면 결함 신고가
            "뭔가 안 나와요" 가 되고, 그 신고로는 아무것도 못 찾는다. */}
        <TextCaption as="span" color="fgMuted">
          {error.message}
        </TextCaption>
      </VStack>
    );
  }
}
