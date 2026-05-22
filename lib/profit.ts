/**
 * PortOne 결제 + Meta 광고비 를 일별로 결합해 손익 시계열을 만든다.
 *
 * 입력:
 *   - PortOne payments (raw): aggregate.ts 가 받아온 PortonePayment[]
 *   - Meta daily spend: { date, spend } 일별 광고비
 *   - settings: pgFeeRate, reportCostPerUnit
 *
 * 출력:
 *   - daily 손익 series (그래프/표 용)
 *   - period 합계 + KPI (calc 결과)
 *   - 인사이트 (가장 수익 좋은 캠페인 등 — 캠페인 집계는 caller 에서)
 *
 * lib/calc.ts 의 공식만 사용. UI/페이지에서 직접 계산하지 않는다.
 */

import type { PortonePayment } from "./portone";
import {
  calc,
  calculateAvailableBeforeAds,
  calculateBreakEvenRoas,
  calculateContributionMargin,
  calculateContributionProfit,
  calculatePgFee,
  calculateReportCost,
  calculateRoas,
  calculateVat,
  DEFAULT_PG_FEE_RATE,
  DEFAULT_REPORT_COST_PER_UNIT,
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 일별 PortOne 통계.
 *   paidAmount      = 그 날 PAID 의 amount.total + PARTIAL_CANCELLED 의 (total - cancelledAmt)
 *   cancelledAmount = 그 날 CANCELLED + PARTIAL_CANCELLED 의 amount.cancelled
 *   reportCount     = PAID 건수 + PARTIAL_CANCELLED 건수 (= 발급된 보고서 수)
 *
 * 사장님 비즈니스 정의: 보고서 1건당 250원 ASP 비용이 발생하고, 환불된 결제도
 * 보고서는 이미 발급된 상태라 환불 시점에 비용을 되돌리지 않는다. 즉
 * reportCount 는 paid 시점 기준으로만 카운트.
 *
 * 일자 기준: paidAt > requestedAt 순으로 fallback.
 */
function aggregatePortoneByDay(
  payments: PortonePayment[],
): Map<string, { paidAmount: number; cancelledAmount: number; reportCount: number }> {
  const m = new Map<string, { paidAmount: number; cancelledAmount: number; reportCount: number }>();

  function bump(date: string, paidDelta: number, cancelDelta: number, reportDelta: number) {
    const cur = m.get(date) || { paidAmount: 0, cancelledAmount: 0, reportCount: 0 };
    cur.paidAmount += paidDelta;
    cur.cancelledAmount += cancelDelta;
    cur.reportCount += reportDelta;
    m.set(date, cur);
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
      bump(date, total, 0, 1);
    } else if (status === "CANCELLED") {
      bump(date, 0, total, 0);
    } else if (status === "PARTIAL_CANCELLED") {
      bump(date, total - cancelledAmt, cancelledAmt, 1);
    }
  }

  return m;
}

export type DailyProfitRow = {
  date: string;
  netRevenue: number;
  vat: number;
  pgFee: number;
  reportCost: number;
  adSpend: number;
  contributionProfit: number;
  contributionMargin: number | null;
  roas: number | null;
  breakEvenRoas: number | null;
  reportCount: number;
  // raw for sanity:
  paidAmount: number;
  cancelledAmount: number;
};

export type ProfitSummary = {
  range: { from: string; until: string };
  settings: { pgFeeRate: number; reportCostPerUnit: number };
  totals: CalcResult & {
    paidAmount: number;
    cancelledAmount: number;
    reportCount: number;
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

  let totalPaid = 0;
  let totalCancelled = 0;
  let totalReport = 0;
  let totalAdSpend = 0;

  for (const date of Array.from(allDates).sort()) {
    const po = portoneByDay.get(date) || { paidAmount: 0, cancelledAmount: 0, reportCount: 0 };
    const adSpend = adByDay.get(date) || 0;

    const netRevenue = Math.max(0, po.paidAmount - po.cancelledAmount);
    const vat = calculateVat(netRevenue);
    const pgFee = calculatePgFee(netRevenue, pgFeeRate);
    const reportCost = calculateReportCost(po.reportCount, reportCostPerUnit);
    const cp = calculateContributionProfit(netRevenue, vat, pgFee, reportCost, adSpend);
    const cm = calculateContributionMargin(cp, netRevenue);
    const roas = calculateRoas(netRevenue, adSpend);
    const avail = calculateAvailableBeforeAds(netRevenue, vat, pgFee, reportCost);
    const ber = calculateBreakEvenRoas(netRevenue, avail);

    dailyArr.push({
      date,
      netRevenue,
      vat,
      pgFee,
      reportCost,
      adSpend,
      contributionProfit: cp,
      contributionMargin: cm,
      roas,
      breakEvenRoas: ber,
      reportCount: po.reportCount,
      paidAmount: po.paidAmount,
      cancelledAmount: po.cancelledAmount,
    });

    totalPaid += po.paidAmount;
    totalCancelled += po.cancelledAmount;
    totalReport += po.reportCount;
    totalAdSpend += adSpend;
  }

  const periodCalc = calc({
    paidAmount: totalPaid,
    cancelledAmount: totalCancelled,
    adSpend: totalAdSpend,
    reportCount: totalReport,
    pgFeeRate,
    reportCostPerUnit,
  });

  return {
    range: args.range,
    settings: { pgFeeRate, reportCostPerUnit },
    totals: {
      ...periodCalc,
      paidAmount: totalPaid,
      cancelledAmount: totalCancelled,
      reportCount: totalReport,
    },
    daily: dailyArr,
  };
}
