/**
 * 광고 손익 계산 공식 (절대 변경 금지 — UI 에서 직접 계산 금지, 본 모듈만 사용).
 *
 * 사장님 정의:
 *   netRevenue        = paidAmount - cancelledAmount   (VAT 포함 실결제)
 *   vat               = netRevenue * 10 / 110
 *   pgFee             = netRevenue * pgFeeRate         (default 0.0352)
 *   reportCost        = reportCount * reportCostPerUnit (default 250)
 *   adSpend           = Meta 광고비
 *   contributionProfit= netRevenue - vat - pgFee - reportCost - adSpend
 *   contributionMargin= contributionProfit / netRevenue * 100   (netRevenue<=0 → null)
 *   roas              = netRevenue / adSpend * 100              (adSpend<=0 → null)
 *   availableBeforeAds= netRevenue - vat - pgFee - reportCost
 *   breakEvenRoas     = netRevenue / availableBeforeAds * 100   (available<=0 → null)
 */

export type CalcInput = {
  paidAmount: number;
  cancelledAmount: number;
  adSpend: number;
  reportCount: number;
  pgFeeRate: number;       // 0.0352 같은 비율
  reportCostPerUnit: number; // 250 같은 단가
};

export type CalcResult = {
  netRevenue: number;
  vat: number;
  pgFee: number;
  reportCost: number;
  adSpend: number;
  contributionProfit: number;
  contributionMargin: number | null;
  roas: number | null;
  availableBeforeAds: number;
  breakEvenRoas: number | null;
  status: "흑자" | "손익분기" | "적자";
  adAdvice: "증액 가능" | "광고비 주의" | "광고비 없음";
};

export const DEFAULT_PG_FEE_RATE = 0.0352;
export const DEFAULT_REPORT_COST_PER_UNIT = 250;

export function calculateNetRevenue(paidAmount: number, cancelledAmount: number): number {
  return Math.max(0, paidAmount - cancelledAmount);
}

export function calculateVat(netRevenue: number): number {
  return (netRevenue * 10) / 110;
}

export function calculatePgFee(netRevenue: number, rate: number): number {
  return netRevenue * rate;
}

export function calculateReportCost(reportCount: number, perUnit: number): number {
  return reportCount * perUnit;
}

export function calculateContributionProfit(
  netRevenue: number,
  vat: number,
  pgFee: number,
  reportCost: number,
  adSpend: number,
): number {
  return netRevenue - vat - pgFee - reportCost - adSpend;
}

export function calculateContributionMargin(
  contributionProfit: number,
  netRevenue: number,
): number | null {
  if (netRevenue <= 0) return null;
  return (contributionProfit / netRevenue) * 100;
}

export function calculateRoas(netRevenue: number, adSpend: number): number | null {
  if (adSpend <= 0) return null;
  return (netRevenue / adSpend) * 100;
}

export function calculateAvailableBeforeAds(
  netRevenue: number,
  vat: number,
  pgFee: number,
  reportCost: number,
): number {
  return netRevenue - vat - pgFee - reportCost;
}

export function calculateBreakEvenRoas(
  netRevenue: number,
  availableBeforeAds: number,
): number | null {
  if (availableBeforeAds <= 0) return null;
  return (netRevenue / availableBeforeAds) * 100;
}

export function calc(input: CalcInput): CalcResult {
  const netRevenue = calculateNetRevenue(input.paidAmount, input.cancelledAmount);
  const vat = calculateVat(netRevenue);
  const pgFee = calculatePgFee(netRevenue, input.pgFeeRate);
  const reportCost = calculateReportCost(input.reportCount, input.reportCostPerUnit);
  const adSpend = input.adSpend;
  const contributionProfit = calculateContributionProfit(
    netRevenue,
    vat,
    pgFee,
    reportCost,
    adSpend,
  );
  const contributionMargin = calculateContributionMargin(contributionProfit, netRevenue);
  const roas = calculateRoas(netRevenue, adSpend);
  const availableBeforeAds = calculateAvailableBeforeAds(netRevenue, vat, pgFee, reportCost);
  const breakEvenRoas = calculateBreakEvenRoas(netRevenue, availableBeforeAds);

  // 상태 판단 — netRevenue 의 0.5% 이내는 손익분기로 간주.
  const tolerance = Math.max(1000, netRevenue * 0.005);
  let status: CalcResult["status"];
  if (contributionProfit > tolerance) status = "흑자";
  else if (contributionProfit < -tolerance) status = "적자";
  else status = "손익분기";

  let adAdvice: CalcResult["adAdvice"];
  if (adSpend <= 0) adAdvice = "광고비 없음";
  else if (roas !== null && breakEvenRoas !== null && roas > breakEvenRoas) {
    adAdvice = "증액 가능";
  } else {
    adAdvice = "광고비 주의";
  }

  return {
    netRevenue,
    vat,
    pgFee,
    reportCost,
    adSpend,
    contributionProfit,
    contributionMargin,
    roas,
    availableBeforeAds,
    breakEvenRoas,
    status,
    adAdvice,
  };
}
