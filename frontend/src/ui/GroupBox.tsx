"use client";

/* KIT Group Boxes — 본문의 구획 하나 [OWNER, 2026-08-07].
 *
 * 킷이 주는 것은 `Group Boxes/Light` · `Group Boxes/Dark` 심볼 둘, 둘 다
 * 100×100 짜리 빈 프레임뿐이다 (Design.MD §5.1). 테두리·라운드·배경이 거기서
 * 오고, **헤더 문법은 목업이 지은 것**이다 — sauron.html / defense.html 의
 * `.groupbox > header`. 그래서 이 파일은 킷 값 + 목업 구성이다.
 *
 * ── 값 ────────────────────────────────────────────────────────────────────
 *   테두리   1px `--bw-border`   (킷 Global/Color Area Outline; 킷은 0.5px)
 *   라운드   10px               (`--r-win`. 킷에 코너 반경 토큰이 없다 §7)
 *   배경     `--bw-tile`        **불투명**. HIG §6.1 "Don't use Liquid Glass
 *                               in the content layer" — 유리는 기능 레이어 것
 *   헤더     36 = 킷 5 XL 칸 · 좌우 12 · gap 9 · 아래 헤어라인
 *   제목     15/600  (킷 04 Title3 Emphasized)
 *   부기     13      (킷 06 Body) · `--bw-ink-2`
 *
 * ── 두 가지 규율 ──────────────────────────────────────────────────────────
 * 1. **헤더는 선택이다.** sauron.html 의 표 박스에는 헤더가 없다 — 표의
 *    `thead` 가 이미 그 일을 하고, 붙이면 제목 줄이 둘이 된다.
 * 2. **본문이 스크롤을 갖는다.** 박스는 `flex-col` + `min-h-0` 이고 테두리는
 *    움직이지 않는다. sauron.html 이 defense.html 과 갈리는 지점이 정확히
 *    이것이다(저쪽에는 스크롤되는 표가 없다).
 *
 * 헤더 안의 `gap` 은 슬롯이 아니라 스페이서다. defense 는 제목·부기·gap·버튼,
 * sauron 은 제목·gap·부기·버튼 — 놓는 자리가 곧 정렬이라 `header` 로 통째로
 * 받는다. */

import type { ReactNode } from "react";

export function GroupBox({
  header,
  children,
  className = "",
}: {
  /** 헤더 줄의 내용. 없으면 헤더 자체가 안 그려진다. */
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-popover border border-edge bg-tile ${className}`}
    >
      {header && (
        <header className="flex h-9 shrink-0 items-center gap-[9px] border-b border-edge px-3">
          {header}
        </header>
      )}
      {children}
    </section>
  );
}

/** 헤더의 제목. 킷 04 Title3 Emphasized. */
export function GroupBoxTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="whitespace-nowrap text-[15px] font-semibold text-ink">{children}</h2>
  );
}

/** 헤더의 부기 — 제목이 아니라 그 옆에 붙는 사실. 킷 06 Body, 이차 잉크. */
export function GroupBoxNote({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap text-[13px] text-ink-2">{children}</span>
  );
}

/** 헤더의 스페이서. */
export function GroupBoxGap() {
  return <span className="flex-1" />;
}
