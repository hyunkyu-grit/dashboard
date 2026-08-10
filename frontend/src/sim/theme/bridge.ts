/* 테마 브릿지.
 *
 * 차트 캔버스는 CSS 커스텀 프로퍼티를 해석하지 못한다. 이 모듈은 DOM 프로브로
 * 시맨틱 토큰을 실제 색 문자열로 해석하고(color-mix()도 이 과정에서 평탄화된다),
 * 테마 속성이 뒤집히면 구독자에게 알려 캔버스 옵션을 다시 만들게 한다.
 *
 * 캔버스 옵션에 날 `var(...)` 문자열을 넘기면 **조용히 아무것도 안 칠한다** —
 * 선행 시스템에서 반복해서 나온 결함 유형이다. 캔버스 옵션 팩토리는 결과를
 * 반드시 assertNoCssVars()에 통과시켜야 한다.
 */

export type SemanticToken = "page" | "tile" | "popover" | "ink" | "border" | "borderLive";

const TOKEN_VARS: Record<SemanticToken, string> = {
  page: "--bw-page",
  tile: "--bw-tile",
  popover: "--bw-popover",
  ink: "--bw-ink",
  border: "--bw-border",
  borderLive: "--bw-border-live",
};

export type ResolvedTheme = Record<SemanticToken, string>;

/** CSS 커스텀 프로퍼티 하나를 DOM 프로브로 실제 색 문자열로 해석 (color-mix()도
 * 여기서 평탄화된다). 클라이언트 전용. */
function resolveVar(cssVar: string): string {
  if (typeof document === "undefined") {
    throw new Error("테마 해석은 클라이언트 전용입니다");
  }
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = `var(${cssVar})`;
  document.body.appendChild(probe);
  try {
    return getComputedStyle(probe).color;
  } finally {
    probe.remove();
  }
}

/** 시맨틱 토큰 전부를 실제 색 문자열(rgb/rgba)로 해석. */
export function resolveTheme(): ResolvedTheme {
  const out = {} as ResolvedTheme;
  for (const [token, cssVar] of Object.entries(TOKEN_VARS)) {
    out[token as SemanticToken] = resolveVar(cssVar);
  }
  return out;
}

/** 잉크(전경) 색. 다계열 램프의 바탕이 된다. */
export function resolveInk(): string {
  return resolveVar("--bw-ink");
}

/** 차트 선 색. */
export function resolveLine(): string {
  return resolveVar("--bw-line");
}

/** 방향색 — 빨강 상승 / 파랑 하락. 호출부가 조용히 뒤바꿀 수 없도록 부호를
 * 인자로 받는다. */
export function resolveDirection(up: boolean): string {
  return resolveVar(up ? "--bw-up" : "--bw-down");
}

/** 시나리오 케이스 색 [OWNER, 2026-08-10]. tokens.css의 --bw-case-* 네
 * 토큰과 1:1 — 이름을 바꾸면 여기도 같이 바꿀 것. */
export function resolveCaseColor(id: "base" | "bull" | "bear" | "crisis"): string {
  return resolveVar(`--bw-case-${id}`);
}

/** 해석된 `rgb(...)` 색에 알파를 입힌다. 캔버스에는 stroke-opacity가 없으므로,
 * 램프 농도는 이 함수를 거쳐 색 자체에 녹아든다. 이미 알파를 든 문자열은
 * 이중으로 흐려지지 않게 그대로 통과시킨다. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})` : color;
}

/** 현재 테마. 루트의 data-theme 속성이 유일한 진실이다. */
export function currentTheme(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "light";
}

/** 루트 data-theme가 바뀔 때마다 `cb` 호출. */
export function onThemeChange(cb: () => void): () => void {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

/**
 * 캔버스에 묶이는 옵션 객체가 아직 CSS 변수를 들고 있으면 거부한다.
 * 객체를 깊이 훑어 "var(" 를 포함한 문자열에서 던진다.
 */
export function assertNoCssVars(options: unknown, path = "options"): void {
  if (typeof options === "string") {
    if (options.includes("var(")) {
      throw new Error(`캔버스 옵션 ${path}에 해석되지 않은 CSS var가 있습니다: "${options}"`);
    }
    return;
  }
  if (Array.isArray(options)) {
    options.forEach((v, i) => assertNoCssVars(v, `${path}[${i}]`));
    return;
  }
  if (options !== null && typeof options === "object") {
    for (const [k, v] of Object.entries(options)) {
      assertNoCssVars(v, `${path}.${k}`);
    }
  }
}
