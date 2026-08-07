/**
 * Wire types for this project's backend. Field names are snake_case because
 * that is what FastAPI emits — they are not renamed on the way in, so a shape
 * here can be checked against `irs_pricer/api/models.py` by eye.
 *
 * `/api/simulate`'s request and response are NOT here: that contract is
 * camelCase (a frozen inheritance from the source simulator) and lives with the
 * rest of the engine surface in `sim/api/simulate-dto.ts`.
 */

export interface RateQuoteIn {
  tenor_years: number;
  rate: number;
  /** Sub-1Y quotes arrive as tenor_years:1 + tenor_months (6M/9M). The months
   * field is the real tenor; ignoring it stacks them all on 1Y. */
  tenor_months?: number | null;
}

export interface MarketDataResponse {
  valuation_date: string;
  cd_rate: number;
  on_rate?: number | null;
  swap_quotes: RateQuoteIn[];
}

export interface DateRangeResponse {
  min_date: string;
  max_date: string;
  available_dates: string[];
}

export interface TaxonomySectorOut {
  sector: string;
  ratings: string[]; // empty for unrated sectors (국고채) and IRS
  tenors: string[];
}

export interface InstrumentTaxonomyOut {
  sectors: TaxonomySectorOut[];
}

export interface CreditSeriesLegIn {
  sector: string;
  rating?: string | null;
  tenor: string;
}

export interface CreditSeriesRequest {
  legs: CreditSeriesLegIn[];
  start_date?: string | null;
  end_date?: string | null;
}

export interface CreditSeriesPointOut {
  valuation_date: string;
  value: number;
}

export interface CreditSeriesResultOut {
  sector: string;
  rating?: string | null;
  tenor: string;
  points: CreditSeriesPointOut[];
  /** A leg that can't resolve comes back with empty points AND this string,
   * rather than failing the whole batch — one bad leg never blanks a chart.
   * Render it; do not swallow it. */
  error?: string | null;
}

export interface CreditSeriesResponse {
  results: CreditSeriesResultOut[];
}

/** One row of the parsed book. Bond rows carry pre-computed risk read off the
 * source ledger (duration/pvbp are real, not zero); IRS rows carry contract
 * terms and let the backend resolve every market-derived field. */
export interface ParsedPosition {
  instrument_type: "bond" | "irs";
  position_id: string;
  sector: string;
  book: string;
  start_date?: string | null;
  maturity_date?: string | null;
  notional?: number | null;
  fixed_rate?: number | null;
  pay_fixed?: boolean | null;
  float_spread?: number | null;
  evaluation_amount?: number | null;
  remaining_days?: number | null;
  tenor_bucket?: string | null;
  entry_yield?: number | null;
  mtm_yield?: number | null;
  duration?: number | null;
  pvbp?: number | null;
  issue_date?: string | null;
  coupon_rate?: number | null; // percent, e.g. 3.125 (표면이율)
  payment_frequency?: number | null;
  rating?: string | null; // null for 국고채/통안채
}

export interface PositionsSummary {
  positions: number;
  bonds: number;
  irs: number;
  min_maturity?: string | null;
  max_maturity?: string | null;
}
