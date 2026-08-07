/* Theme bridge — design spec §9.
 *
 * Chart canvases cannot resolve CSS custom properties. This module resolves
 * semantic tokens to concrete color strings via a DOM probe (which also
 * flattens color-mix()), and notifies subscribers when the theme attribute
 * flips so canvas-bound options can be rebuilt and the chart redrawn.
 *
 * Passing a raw `var(...)` string into a canvas option silently paints
 * nothing — a recurring defect class in the predecessor system. Canvas
 * option factories must run their output through assertNoCssVars().
 */

export type SemanticToken =
  | "page"
  | "tile"
  | "popover"
  | "ink"
  | "border"
  | "borderLive";

const TOKEN_VARS: Record<SemanticToken, string> = {
  page: "--bw-page",
  tile: "--bw-tile",
  popover: "--bw-popover",
  ink: "--bw-ink",
  border: "--bw-border",
  borderLive: "--bw-border-live",
};

export type ResolvedTheme = Record<SemanticToken, string>;

/** Resolve a single CSS custom property to a concrete color string via a DOM
 * probe (also flattens color-mix()). Client-only. */
function resolveVar(cssVar: string): string {
  if (typeof document === "undefined") {
    throw new Error("theme resolution is client-only");
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

/** Resolve every semantic token to a concrete color string (rgb/rgba). */
export function resolveTheme(): ResolvedTheme {
  const out = {} as ResolvedTheme;
  for (const [token, cssVar] of Object.entries(TOKEN_VARS)) {
    out[token as SemanticToken] = resolveVar(cssVar);
  }
  return out;
}

/** 캔버스가 쓸 서체 스택 [2026-08-07].
 *
 * 캔버스는 CSS 를 상속하지 않는다. lightweight-charts 의 `layout.fontFamily`
 * 를 안 주면 라이브러리 기본값(`-apple-system, BlinkMacSystemFont,
 * 'Trebuchet MS', Roboto, Ubuntu, sans-serif`)으로 축 라벨과 크로스헤어 값을
 * 그린다 — 화면의 나머지는 Pretendard 인데 차트 숫자만 다른 서체였고, 그
 * 상태로 오래 있었다. HTML/SVG 는 상속하므로 멀쩡했던 것이 오히려 발견을
 * 늦췄다.
 *
 * 색과 같은 길을 지난다: 캔버스에 가는 값은 전부 이 브릿지를 거친다 — 컴포넌트가
 * 직접 문자열을 적으면 그 자리가 토큰 체계 밖으로 나간다. `--font-sans` 를
 * 그대로 읽으므로 서체를 바꿀 곳은 여전히 한 군데(globals.css)다. */
export function resolveFont(): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--font-sans")
    .trim();
}

/* The band sub-palette resolvers (resolveBandHue) and the navy lockup resolver
 * (resolveBrand) were removed with the palette cut — nothing referenced them and
 * the palette is red/blue/grey now. The sub-palette stays defined-but-unused in
 * tokens.css only. */

/** Resolve the chart-stroke color to hex for canvas (§9). Plain line charts are
 * blue as of Session 16 (§ Pass E). */
export function resolveLine(): string {
  return resolveVar("--bw-line");
}

/** Resolve a direction colour (red up / blue down) to hex for canvas — candle
 * bodies use the 상승 빨강 / 하락 파랑 convention, not the line blue (§9/§G). */
export function resolveDirection(up: boolean): string {
  return resolveVar(up ? "--bw-up" : "--bw-down");
}

/** Resolve the ink (foreground) colour for canvas. */
export function resolveInk(): string {
  return resolveVar("--bw-ink");
}

/** Resolve a reference-line colour for canvas [OWNER, 2026-08-04 — grey
 * solid for CD, translucent red solid for the base rate]. One resolver per
 * reference so a call site cannot swap them silently. Canvas has no
 * stroke-opacity, so callers pass the resolved colour through `withAlpha`
 * to get the same translucency the SVG charts carry. */
export function resolveRefCd(): string {
  return resolveVar("--bw-ref-cd");
}
export function resolveRefPolicy(): string {
  return resolveVar("--bw-ref-policy");
}

/** A resolved `rgb(...)` colour with an alpha applied, for canvas options.
 * The DOM probe returns `rgb(r, g, b)` for opaque tokens; anything already
 * carrying alpha is passed through unchanged rather than double-faded. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})` : color;
}

/** Notify `cb` whenever the root data-theme attribute changes. */
export function onThemeChange(cb: () => void): () => void {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

/**
 * Reject canvas-bound option objects that still reference CSS variables.
 * Deep-walks the object; throws on any string containing "var(".
 */
export function assertNoCssVars(options: unknown, path = "options"): void {
  if (typeof options === "string") {
    if (options.includes("var(")) {
      throw new Error(
        `canvas-bound option ${path} contains unresolved CSS var: "${options}"`,
      );
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
