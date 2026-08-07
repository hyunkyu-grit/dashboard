/**
 * Typed HTTP client for this project's FastAPI backend.
 *
 * Slimmed from krw-fi-pms's api-client.ts, which carried ~40 endpoints for
 * seven screens. This app has one screen, so the client covers exactly what the
 * backend serves: market data and the book. `/api/simulate` is deliberately
 * NOT here — it has its own transport in `sim/api/simulation-api.ts`, because
 * it is the only call whose runtime is measured in minutes. (That module also
 * carried its own base origin once; it does not any more — see API_BASE below.)
 *
 * The error-shape handling below is carried over verbatim in behaviour, and the
 * reasons are worth keeping: a network failure and an HTTP error are different
 * things and must not render the same, and FastAPI's 422 returns `detail` as an
 * array of Pydantic error objects rather than a string.
 */
import type {
  DateRangeResponse,
  MarketDataResponse,
  ParsedPosition,
  PositionsSummary,
} from "./api-types";
import type { ExpandedLeg, InstrumentCatalog } from "./manual-position";

// Base origin for all /api/* calls — RE-EXPORTED from the monitor's, not
// decided here (2026-08-07). There is one backend now, on :8100, and two
// modules answering "where is the backend" is how they drift.
//
// What this replaced: a `NEXT_PUBLIC_API_BASE_URL ?? (dev ? 127.0.0.1:8200 : "")`
// ladder from when the simulation was its own service. The env var name was
// different from this repo's (`NEXT_PUBLIC_API_BASE`), so setting the one
// documented in the README moved the monitor's calls and left the
// simulation's pointed at a :8200 that no longer exists.
//
// The behaviour that mattered is unchanged and comes free from the shared
// definition: unset → "" → every fetch below is SAME-ORIGIN `/api/...`, which
// the deployed site proxies to the backend through the Next rewrite. An
// absolute origin in a shipped bundle is what guards/production-env.test.ts
// forbids, and it would need CORS besides.
//
// The simulation is LIVE-ONLY, like /api/backtest and for the same reason:
// its answer depends on inputs the reader chooses, so it has no static twin
// to fall back on. With no backend reachable these calls fail and surface as
// the ApiError panel — see staticPaths.ts::backtestUrl for the ruling.
export { API_BASE } from "@/lib/staticPaths";
import { API_BASE } from "@/lib/staticPaths";

const NETWORK_ERROR_MESSAGE = "가격 서버에 연결할 수 없어요 — 서버가 떠 있는지 확인해 주세요.";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// FastAPI's own request validation (422, before a route handler even runs)
// returns `detail` as an array of Pydantic error objects, not a string — every
// other error path (HTTPException) already returns a plain string. Without this,
// an array `detail` renders as "[object Object]" instead of the actual
// per-field validation message.
function detailToMessage(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => (typeof e === "string" ? e : ((e as { msg?: string })?.msg ?? JSON.stringify(e))))
      .join(", ");
  }
  return `요청이 실패했어요 (HTTP ${status}).`;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(detailToMessage(body?.detail, res.status), res.status);
  }
  return body as T;
}

// fetch() throws a generic TypeError only for network-level failures — server
// not running, refused connection, CORS, DNS. HTTP error responses (4xx/5xx)
// resolve normally and are handled in handleResponse() with the backend's own
// detail message. Distinguishing the two means the UI never shows a bare,
// unexplained "Failed to fetch".
async function apiGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`);
  } catch {
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
  }
  return handleResponse<T>(res);
}

async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
  }
  return handleResponse<T>(res);
}

export const marketDataApi = {
  dateRange: () => apiGet<DateRangeResponse>("/api/market-data/range"),
  snapshot: (valuationDate: string) =>
    apiGet<MarketDataResponse>(`/api/market-data/${valuationDate}`),
};

/** 상품 목록과 다리 전개. 둘 다 모니터 쪽 라우터(app/main.py)가 답한다 —
 * 다리 규칙과 DV01 가중이 백테스트의 것과 같아야 하고, 그 기계가 거기 있다. */
export const instrumentsApi = {
  catalog: () => apiGet<InstrumentCatalog>("/api/instruments"),
  /** LIVE. 가중이 기준일 커브에 달려 있어 정적 쌍둥이를 만들 수 없다. */
  expand: (req: { seriesId: string; direction: number; notional: number; baseDate: string }) =>
    apiPost<{ seriesId: string; kind: string; legs: ExpandedLeg[] }>(
      "/api/instruments/expand",
      req,
    ),
};

/* `creditCurveApi` (taxonomy + series) stood here and is DELETED
 * [OWNER, 2026-08-07]. It read /api/credit-curve/*, backed by
 * `Credit Matrix Data.xlsx` — the 42 MB workbook removed when the market
 * source became this repo's own irsdata.xlsx. Its only caller was the 국고
 * reference line in CurvePreview, gone with it.
 *
 * The backend routes still exist and would now 500. That is exactly why this
 * export could not simply be left unused: guards/live-routes-proxied reads the
 * paths named in this file to decide what the deployed site must forward, so a
 * dead declaration here would have demanded a rewrite to a broken endpoint. */

/** The book, parsed server-side from `data/Portfolio Data.xlsx`. Replaces the
 * source app's upload screen + localStorage ledger entirely. */
export const positionsApi = {
  list: () => apiGet<ParsedPosition[]>("/api/positions"),
  summary: () => apiGet<PositionsSummary>("/api/positions/summary"),
};
