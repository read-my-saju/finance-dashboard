/**
 * PortOne 결제 + Meta 광고비 를 일별로 결합해 손익 시계열을 만든다.
 *
 * 순매출 정의 (사장님 2026-05-23 확정):
 *   순매출 = PortOne 콘솔의 "순거래액" 과 동일 값
 *          = PAID 의 amount.total 합산 (CANCELLED 는 별도 통계, 순매출에서 빼지 않음)
 *          = aggregate.ts 의 netRevenue
 *   화면 상단 (결제 거래) 과 광고 손익 KPI 의 "순매출" 은 반드시 동일 값.
 *
 * 일별 결합:
 *   - 일별 순매출 = 그날 PAID 의 amount.total + PARTIAL_CANCELLED 의 (total - cancelled)
 *   - 일별 결제 건수 = 그날 PAID + PARTIAL_CANCELLED 건수
 *   - 일별 광고비 = Meta insights 의 spend (광고계정 통화 KRW)
 *
 * lib/calc.ts 의 공식만 사용. UI/페이지에서 직접 계산하지 않는다.
 */

import type { PortonePayment } from "./portone";
import { methodLabel } from "./aggregate";
import {
  calc,
  calculateBreakEvenRoas,
  calculateContributionMargin,
  calculateContributionProfit,
  calculateReportCost,
  calculateRevenueExVat,
  calculateRoas,
  calculateVat,
  pgFeeRateForMethod,
  DEFAULT_PG_FEE_RATE,
  DEFAULT_REPORT_COST_PER_UNIT,
  reportCostPerUnitForDate,
  type CalcResult,
} from "./calc";

type AnyPayment = PortonePayment & {
  currency?: string;
  amount?: {
    total?: number;
    paid?: number;
    cancelled?: number;
  };
};

function parseIso(s?: string): Date | null {
  if (!s) return null;
  try {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

function ymd(d: Date): string {
  // KST (Asia/Seoul, UTC+9) 기준 YYYY-MM-DD.
  //
  // Vercel serverless 는 UTC 로 동작하므로 d.getFullYear()/getMonth()/getDate() 를
  // 그대로 쓰면 KST 자정~오전 8:59 결제가 전날로 분류된다. 사장님 화면 기준이
  // KST 이고 PortOne 콘솔도 KST 이므로 일자 키를 KST 로 통일.
  //
  // 트릭: epoch 에 +9h 를 더한 Date 의 toISOString().slice(0,10) 은 KST 일자.
  // (meta-store.ts 와 동일 패턴 — 결과적으로 모든 일별 집계가 같은 TZ 기준.)
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * 일별 PortOne 통계. aggregate.ts 의 netRevenue 정의와 동일 (PAID 만).
 *   netRevenue       = PAID 의 amount.total + PARTIAL_CANCELLED 의 (total - cancelled)
 *   reportCount      = PAID 건수 + PARTIAL_CANCELLED 건수
 *   cancelledAmount  = 참고용 통계 (광고 손익 계산에는 안 씀)
 *
 * CANCELLED 는 PortOne 콘솔의 "거래취소액" 별도 통계이므로 일별 순매출에서 빼지 않음.
 */
function aggregatePortoneByDay(
  payments: PortonePayment[],
): Map<string, { netRevenue: number; reportCount: number; cancelledAmount: number; pgFee: number }> {
  const m = new Map<
    string,
    { netRevenue: number; reportCount: number; cancelledAmount: number; pgFee: number }
  >();

  function bump(
    date: string,
    netDelta: number,
    reportDelta: number,
    cancelDelta: number,
    feeDelta: number,
  ) {
    const cur = m.get(date) || { netRevenue: 0, reportCount: 0, cancelledAmount: 0, pgFee: 0 };
    cur.netRevenue += netDelta;
    cur.reportCount += reportDelta;
    cur.cancelledAmount += cancelDelta;
    cur.pgFee += feeDelta;
    m.set(date, cur);
  }

  // 순매출(VAT 제외) × 결제수단별 요율 = 그 결제의 PG수수료.
  function feeFor(payment: AnyPayment, netAmount: number): number {
    if (netAmount <= 0) return 0;
    const exVat = calculateRevenueExVat(netAmount);
    return exVat * pgFeeRateForMethod(methodLabel(payment as any));
  }

  for (const raw of payments) {
    const p = raw as AnyPayment;
    const status = (p.status || "").toUpperCase();
    const channelType = (p.channel?.type || "").toUpperCase();
    if (channelType === "TEST") continue;
    const currency = ((p as any).currency || "").toUpperCase();
    if (currency && currency !== "KRW") continue;

    const amount = p.amount || {};
    const total = Number(amount.total) || 0;
    const cancelledAmt = Number(amount.cancelled) || 0;

    const at = parseIso(p.paidAt) || parseIso(p.requestedAt);
    if (!at) continue;
    const date = ymd(at);

    if (status === "PAID") {
      bump(date, total, 1, 0, feeFor(p, total));
    } else if (status === "CANCELLED") {
      // PortOne 콘솔 순거래액은 CANCELLED 제외. 일별 통계에도 미반영.
      bump(date, 0, 0, total, 0);
    } else if (status === "PARTIAL_CANCELLED") {
      const net = total - cancelledAmt;
      bump(date, net, 1, cancelledAmt, feeFor(p, net));
    }
  }

  return m;
}

export type DailyProfitRow = {
  date: string;
  netRevenue: number;
  vat: number;
  revenueExVat: number;
  pgFee: number;
  reportCost: number;
  adSpend: number;
  contributionProfit: number;
  contributionMargin: number | null;
  roas: number | null;
  breakEvenRoas: number;     // 동적 (원가구조 기반)
  reportCount: number;
  cancelledAmount: number;   // 참고용 (PortOne 거래취소액)
};

export type ProfitSummary = {
  range: { from: string; until: string };
  settings: { pgFeeRate: number; reportCostPerUnit: number };
  totals: CalcResult & {
    reportCount: number;
    cancelledAmount: number;
  };
  daily: DailyProfitRow[];
};

export function computeProfit(args: {
  payments: PortonePayment[];
  metaByDay: Array<{ date: string; spend: number }>;
  range: { from: string; until: string };
  pgFeeRate?: number;
  reportCostPerUnit?: number;
}): ProfitSummary {
  const pgFeeRate = args.pgFeeRate ?? DEFAULT_PG_FEE_RATE;
  const reportCostPerUnit = args.reportCostPerUnit ?? DEFAULT_REPORT_COST_PER_UNIT;

  const portoneByDay = aggregatePortoneByDay(args.payments);
  const adByDay = new Map<string, number>();
  for (const r of args.metaByDay) {
    adByDay.set(r.date, (adByDay.get(r.date) || 0) + (Number(r.spend) || 0));
  }

  // union of dates (PortOne 결제 일 + 광고비 일).
  const allDates = new Set<string>([...portoneByDay.keys(), ...adByDay.keys()]);
  const dailyArr: DailyProfitRow[] = [];

  let totalNetRevenue = 0;
  let totalReport = 0;
  let totalAdSpend = 0;
  let totalCancelled = 0;
  let totalReportCost = 0;   // 일별(날짜별 단가) reportCost 합산 — 기간 합계 정합성용
  let totalPgFee = 0;        // 결제수단별 PG수수료 합산 — 기간 합계 정합성용

  for (const date of Array.from(allDates).sort()) {
    const po = portoneByDay.get(date) || { netRevenue: 0, reportCount: 0, cancelledAmount: 0, pgFee: 0 };
    const adSpend = adByDay.get(date) || 0;

    const netRevenue = po.netRevenue;
    const vat = calculateVat(netRevenue);
    const revenueExVat = calculateRevenueExVat(netRevenue);
    const pgFee = po.pgFee;   // 결제수단별 요율로 이미 합산됨 (calc.ts pgFeeRateForMethod)
    const perUnit = reportCostPerUnitForDate(date, reportCostPerUnit);
    const reportCost = calculateReportCost(po.reportCount, perUnit);
    const cp = calculateContributionProfit(revenueExVat, pgFee, reportCost, adSpend);
    const cm = calculateContributionMargin(cp, netRevenue);
    const roas = calculateRoas(netRevenue, adSpend);

    dailyArr.push({
      date,
      netRevenue,
      vat,
      revenueExVat,
      pgFee,
      reportCost,
      adSpend,
      contributionProfit: cp,
      contributionMargin: cm,
      roas,
      breakEvenRoas: calculateBreakEvenRoas(netRevenue, revenueExVat, pgFee, reportCost),
      reportCount: po.reportCount,
      cancelledAmount: po.cancelledAmount,
    });

    totalNetRevenue += netRevenue;
    totalReport += po.reportCount;
    totalAdSpend += adSpend;
    totalCancelled += po.cancelledAmount;
    totalReportCost += reportCost;
    totalPgFee += pgFee;
  }

  // 기간 합계: calc() 한 번으로 계산 (단일 진실).
  const periodCalc = calc({
    netRevenue: totalNetRevenue,
    adSpend: totalAdSpend,
    reportCount: totalReport,
    pgFeeRate,
    reportCostPerUnit,
    reportCostOverride: totalReportCost,   // 날짜별 단가 합산값으로 기간 reportCost 고정
    pgFeeOverride: totalPgFee,             // 결제수단별 요율 합산값으로 기간 PG수수료 고정
  });

  // 화면 "PG X%" 표기는 실효 혼합요율(합산 수수료 / VAT제외 매출)로 노출.
  const periodExVat = calculateRevenueExVat(totalNetRevenue);
  const effectivePgRate = periodExVat > 0 ? totalPgFee / periodExVat : pgFeeRate;

  return {
    range: args.range,
    settings: { pgFeeRate: effectivePgRate, reportCostPerUnit },
    totals: {
      ...periodCalc,
      reportCount: totalReport,
      cancelledAmount: totalCancelled,
    },
    daily: dailyArr,
  };
}
