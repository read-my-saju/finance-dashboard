/**
 * 광고 손익 계산 공식 (단일 진실 — UI 에서 직접 계산 금지, 본 모듈만 사용).
 *
 * 사장님 정의 (2026-05-23 재정의):
 *   순매출(netRevenue)       = 결제완료 - 환불 (한 정의로 통일, 화면 전체 동일 값)
 *   VAT                      = 순매출 / 11                    (VAT 포함가 기준)
 *   부가세 제외 순매출(exVat) = 순매출 - VAT
 *   PG수수료(pgFee)          = 부가세 제외 순매출 * 3.52%      (계약 PG 수수료율)
 *   리포트 생성원가          = 결제완료 건수 * 250             (건당 단가)
 *   리포트원가율             = 리포트 생성원가 / 부가세 제외 순매출
 *   실질 ROAS                = 부가세 제외 순매출 / 광고비 * 100
 *   손익분기 ROAS (BEP)      = 1 / (1 - PG수수료율 - 리포트원가율) * 100
 *   공헌이익                 = 부가세 제외 순매출 - PG - 리포트원가 - 광고비
 *   마진                     = 공헌이익 / 순매출 * 100
 *
 * BEP 와 실질 ROAS 모두 "부가세 제외 매출" 기준이라 분모가 동일.
 * 실질 ROAS > BEP 이면 광고 증액 가능.
 */

export type CalcInput = {
  netRevenue: number;       // 결제완료 - 환불 (VAT 포함, source of truth)
  adSpend: number;
  reportCount: number;      // 결제완료 건수
  pgFeeRate: number;        // 0.0352 같은 비율
  reportCostPerUnit: number; // 250 같은 단가
};

export type CalcResult = {
  netRevenue: number;        // VAT 포함 순매출
  vat: number;
  revenueExVat: number;      // 부가세 제외 순매출
  pgFee: number;             // 부가세 제외 매출 × PG율
  reportCost: number;        // 결제 건수 × 단가
  reportCostRate: number;    // 리포트원가 / 부가세 제외 매출
  adSpend: number;
  contributionProfit: number;
  contributionMargin: number | null;  // 공헌이익 / 순매출 (VAT 포함)
  realRoas: number | null;            // 부가세 제외 매출 / 광고비
  breakEvenRoas: number | null;       // 1 / (1 - pgRate - reportRate)
  status: "흑자" | "손익분기" | "적자";
  adAdvice: "증액 가능" | "광고비 주의" | "광고비 없음";
};

export const DEFAULT_PG_FEE_RATE = 0.0352;
export const DEFAULT_REPORT_COST_PER_UNIT = 250;

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

export function calculateRealRoas(revenueExVat: number, adSpend: number): number | null {
  if (adSpend <= 0) return null;
  return (revenueExVat / adSpend) * 100;
}

/**
 * BEP = 1 / (1 - PG율 - 리포트원가율)
 * 실질 ROAS 와 분모가 같아서 직접 비교 가능.
 */
export function calculateBreakEvenRoas(
  pgFeeRate: number,
  reportCostRate: number,
): number | null {
  const denom = 1 - pgFeeRate - reportCostRate;
  if (denom <= 0) return null;
  return (1 / denom) * 100;
}

export function calc(input: CalcInput): CalcResult {
  const netRevenue = Math.max(0, input.netRevenue);
  const vat = calculateVat(netRevenue);
  const revenueExVat = calculateRevenueExVat(netRevenue);
  const pgFee = calculatePgFee(revenueExVat, input.pgFeeRate);
  const reportCost = calculateReportCost(input.reportCount, input.reportCostPerUnit);
  const reportCostRate = revenueExVat > 0 ? reportCost / revenueExVat : 0;
  const adSpend = input.adSpend;

  const contributionProfit = calculateContributionProfit(revenueExVat, pgFee, reportCost, adSpend);
  const contributionMargin = calculateContributionMargin(contributionProfit, netRevenue);
  const realRoas = calculateRealRoas(revenueExVat, adSpend);
  const breakEvenRoas = calculateBreakEvenRoas(input.pgFeeRate, reportCostRate);

  // 상태 판단 — netRevenue 의 0.5% 이내는 손익분기로 간주.
  const tolerance = Math.max(1000, netRevenue * 0.005);
  let status: CalcResult["status"];
  if (contributionProfit > tolerance) status = "흑자";
  else if (contributionProfit < -tolerance) status = "적자";
  else status = "손익분기";

  let adAdvice: CalcResult["adAdvice"];
  if (adSpend <= 0) adAdvice = "광고비 없음";
  else if (realRoas !== null && breakEvenRoas !== null && realRoas > breakEvenRoas) {
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
    realRoas,
    breakEvenRoas,
    status,
    adAdvice,
  };
}
