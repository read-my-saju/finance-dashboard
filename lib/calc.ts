/**
 * 광고 손익 계산 공식 (단일 진실 — UI 에서 직접 계산 금지, 본 모듈만 사용).
 *
 * 사장님 정의 (2026-05-23 최종):
 *   결제매출(netRevenue)     = PortOne 콘솔 순거래액 (VAT 포함, 단일 진실)
 *   VAT                      = 결제매출 / 11
 *   VAT 제외 매출(exVat)     = 결제매출 - VAT
 *   PG수수료(pgFee)          = VAT 제외 매출 × 3.52%
 *   리포트 생성원가          = 결제완료 건수 × 건당원가(결제일별: ~2026-04 250 / 2026-05 266 / 2026-06~ 390)
 *   ROAS                     = 결제매출(VAT 포함) / 광고비 × 100
 *   손익분기 ROAS (BEP)      = 118% (고정)
 *   공헌이익                 = 결제매출 - VAT - PG - 리포트원가 - 광고비
 *   마진                     = 공헌이익 / 결제매출 × 100
 *
 * ROAS 는 결제매출(VAT 포함) 기준으로 단일화. BEP 118% 는 약 115~120% 범위에서
 * 사장님이 합의한 운영 기준값. ROAS > 118% 이면 '증액 가능'.
 */

export type CalcInput = {
  netRevenue: number;       // 결제완료 - 환불 (VAT 포함, source of truth)
  adSpend: number;
  reportCount: number;      // 결제완료 건수
  pgFeeRate: number;        // 0.0352 같은 비율
  reportCostPerUnit: number; // 250 같은 단가
  reportCostOverride?: number; // 날짜별 단가로 합산한 reportCost 직접 지정 (있으면 reportCount×perUnit 대신 사용)
};

export type CalcResult = {
  netRevenue: number;        // VAT 포함 결제매출 (PortOne 순거래액)
  vat: number;
  revenueExVat: number;      // VAT 제외 매출
  pgFee: number;             // VAT 제외 매출 × PG율
  reportCost: number;        // 결제 건수 × 단가
  reportCostRate: number;    // 리포트원가 / VAT 제외 매출 (참고용)
  adSpend: number;
  contributionProfit: number;
  contributionMargin: number | null;  // 공헌이익 / 결제매출
  roas: number | null;                // 결제매출(VAT 포함) / 광고비 × 100
  breakEvenRoas: number;              // BEP 고정 118%
  status: "흑자" | "손익분기" | "적자";
  adAdvice: "증액 가능" | "광고비 주의" | "광고비 없음";
};

export const DEFAULT_PG_FEE_RATE = 0.0352;
export const DEFAULT_REPORT_COST_PER_UNIT = 250;   // 2026-04 이전 기본 단가
export const BREAK_EVEN_ROAS = 118;       // 손익분기 ROAS (고정, % 단위)

/**
 * 결제일(KST, YYYY-MM-DD) 별 리포트 건당 원가.
 * Claude API 실원가 반영 (사장님 2026-06 확정):
 *   ~2026-04  : base (기본 250)
 *   2026-05    : 266  (5월 실원가)
 *   2026-06~   : 390  (Opus 전환 후 실원가)
 */
export const REPORT_COST_PER_UNIT_2026_05 = 266;
export const REPORT_COST_PER_UNIT_2026_06 = 390;

export function reportCostPerUnitForDate(
  date: string,
  base: number = DEFAULT_REPORT_COST_PER_UNIT,
): number {
  if (date >= "2026-06-01") return REPORT_COST_PER_UNIT_2026_06;
  if (date >= "2026-05-01") return REPORT_COST_PER_UNIT_2026_05;
  return base;
}

export function calculateVat(netRevenue: number): number {
  return netRevenue / 11;
}

export function calculateRevenueExVat(netRevenue: number): number {
  return netRevenue - calculateVat(netRevenue);
}

export function calculatePgFee(revenueExVat: number, rate: number): number {
  return revenueExVat * rate;
}

export function calculateReportCost(reportCount: number, perUnit: number): number {
  return reportCount * perUnit;
}

export function calculateContributionProfit(
  revenueExVat: number,
  pgFee: number,
  reportCost: number,
  adSpend: number,
): number {
  return revenueExVat - pgFee - reportCost - adSpend;
}

export function calculateContributionMargin(
  contributionProfit: number,
  netRevenue: number,
): number | null {
  if (netRevenue <= 0) return null;
  return (contributionProfit / netRevenue) * 100;
}

/**
 * ROAS = 결제매출(VAT 포함) / 광고비 × 100.
 * BEP 118% 와 분모가 다르지만 같은 단위(% of 결제매출)라 직접 비교 가능.
 */
export function calculateRoas(netRevenue: number, adSpend: number): number | null {
  if (adSpend <= 0) return null;
  return (netRevenue / adSpend) * 100;
}

export function calc(input: CalcInput): CalcResult {
  const netRevenue = Math.max(0, input.netRevenue);
  const vat = calculateVat(netRevenue);
  const revenueExVat = calculateRevenueExVat(netRevenue);
  const pgFee = calculatePgFee(revenueExVat, input.pgFeeRate);
  const reportCost = input.reportCostOverride ?? calculateReportCost(input.reportCount, input.reportCostPerUnit);
  const reportCostRate = revenueExVat > 0 ? reportCost / revenueExVat : 0;
  const adSpend = input.adSpend;

  const contributionProfit = calculateContributionProfit(revenueExVat, pgFee, reportCost, adSpend);
  const contributionMargin = calculateContributionMargin(contributionProfit, netRevenue);
  const roas = calculateRoas(netRevenue, adSpend);
  const breakEvenRoas = BREAK_EVEN_ROAS;

  // 상태 판단 — netRevenue 의 0.5% 이내는 손익분기로 간주.
  const tolerance = Math.max(1000, netRevenue * 0.005);
  let status: CalcResult["status"];
  if (contributionProfit > tolerance) status = "흑자";
  else if (contributionProfit < -tolerance) status = "적자";
  else status = "손익분기";

  let adAdvice: CalcResult["adAdvice"];
  if (adSpend <= 0) adAdvice = "광고비 없음";
  else if (roas !== null && roas > breakEvenRoas) {
    adAdvice = "증액 가능";
  } else {
    adAdvice = "광고비 주의";
  }

  return {
    netRevenue,
    vat,
    revenueExVat,
    pgFee,
    reportCost,
    reportCostRate,
    adSpend,
    contributionProfit,
    contributionMargin,
    roas,
    breakEvenRoas,
    status,
    adAdvice,
  };
}
