import type { PortonePayment } from "./portone";

export type DashboardSummary = {
  range: { from: string; until: string };
  fetchedAt: string;
  gross: number;            // 거래액 (PAID + CANCELLED + PARTIAL_CANCELLED 의 amount.total)
  netRevenue: number;       // 순거래액 = gross - cancelled
  cancelled: number;        // 거래취소액 (amount.cancelled 합)
  paidCount: number;
  cancelCount: number;
  byChannel: Array<{ label: string; gross: number; net: number; count: number; pct: number }>;
  daily: Array<{ date: string; gross: number }>;
  weekly: Array<{ weekStart: string; gross: number }>;
};

// PortOne 의 다양한 결제 정보를 우리가 다루기 위한 확장 타입.
type AnyPayment = PortonePayment & {
  method?: {
    type?: string;        // PaymentMethodCard / PaymentMethodEasyPay / ...
    provider?: string;    // KAKAOPAY / NAVERPAY / TOSSPAY / SAMSUNGPAY ...
  } | null;
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

function weekStart(d: Date): string {
  const x = new Date(d);
  const day = x.getDay();
  const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return ymd(x);
}

/**
 * PortOne 콘솔의 "결제수단별" 분류와 동일하게:
 *   - method.type === PaymentMethodCard → "신용카드"
 *   - method.type === PaymentMethodEasyPay → provider 매핑 (카카오페이/Npay/토스페이/삼성페이/...)
 *   - method.type === PaymentMethodTransfer → "계좌이체"
 *   - method.type === PaymentMethodVirtualAccount → "가상계좌"
 *   - method.type === PaymentMethodMobile → "휴대폰결제"
 *   - 그 외 → channel.pgProvider 로 fallback
 */
function methodLabel(payment: AnyPayment): string {
  const m = payment.method || {};
  const type = (m.type || "").toUpperCase();
  const provider = (m.provider || "").toUpperCase();

  if (type.includes("CARD")) return "신용카드";
  if (type.includes("EASYPAY") || type.includes("EASY_PAY")) {
    if (provider.includes("KAKAOPAY")) return "카카오페이";
    if (provider.includes("NAVERPAY")) return "Npay";
    if (provider.includes("TOSSPAY") || provider.includes("TOSS_BRANDPAY")) return "토스페이";
    if (provider.includes("SAMSUNGPAY")) return "삼성페이";
    if (provider.includes("PAYCO")) return "페이코";
    if (provider.includes("APPLEPAY")) return "Apple Pay";
    if (provider.includes("PAYPAL")) return "PayPal";
    if (provider.includes("SSGPAY")) return "SSG페이";
    if (provider.includes("LPAY")) return "LPAY";
    if (provider.includes("LINEPAY")) return "라인페이";
    if (provider.includes("ALIPAY")) return "Alipay";
    if (provider) return provider;
    return "간편결제";
  }
  if (type.includes("TRANSFER")) return "계좌이체";
  if (type.includes("VIRTUAL")) return "가상계좌";
  if (type.includes("MOBILE")) return "휴대폰결제";
  if (type.includes("CONVENIENCE")) return "편의점";
  if (type.includes("GIFT")) return "상품권";

  // fallback to pgProvider
  const pg = (payment.channel?.pgProvider || "").toUpperCase();
  if (pg.includes("KAKAOPAY")) return "카카오페이";
  if (pg.includes("INICIS") || pg.includes("KG")) return "KG이니시스";
  if (pg.includes("PAYPAL")) return "PayPal";
  return pg || "기타";
}

export function aggregate(
  payments: PortonePayment[],
  range: { from: string; until: string },
): DashboardSummary {
  // PortOne 콘솔 정의 (정밀 매칭):
  //  - 거래액   = PAID + PARTIAL_CANCELLED 의 amount.total
  //               (CANCELLED 전액환불은 "거래 없었던 것" 으로 보고 제외)
  //  - 거래취소액 = PARTIAL_CANCELLED 의 amount.cancelled
  //               + CANCELLED 의 amount.cancelled (= 전액환불)
  //  - 순거래액  = 거래액 - 거래취소액
  //  - FAILED / READY / PAY_PENDING / VIRTUAL_ACCOUNT_ISSUED 는 모두 제외.

  let gross = 0;
  let cancelled = 0;
  let paidCount = 0;
  let cancelCount = 0;

  const channelMap = new Map<string, { gross: number; net: number; count: number }>();
  const dailyMap = new Map<string, number>();
  const weeklyMap = new Map<string, number>();

  // PortOne 콘솔 정의 (OpenAPI PaymentAmount 스키마 기준):
  //   "거래액"   = amount.paid + amount.cancelled   (= total - discount)
  //               즉 PG 가 실제로 처리한 금액 (할인 제외, 환불 부분 포함).
  //   "거래취소액" = amount.cancelled
  //   "순거래액"  = 거래액 - 거래취소액 = amount.paid
  //
  // 모든 status (PAID / PARTIAL_CANCELLED / CANCELLED) 가 위 정의에 기여한다:
  //   PAID:               paid = total - discount,         cancelled = 0
  //   PARTIAL_CANCELLED:  paid = total - discount - canc,  cancelled = canc
  //   CANCELLED:          paid = 0,                        cancelled = total - discount
  //
  // 따라서 status 별 분기 없이 amount 필드만 일관되게 합산하면 됨.
  const INCLUDE_STATUSES = new Set(["PAID", "PARTIAL_CANCELLED", "CANCELLED"]);

  for (const raw of payments) {
    const p = raw as AnyPayment;
    const status = (p.status || "").toUpperCase();
    if (!INCLUDE_STATUSES.has(status)) continue;

    const amount = p.amount || {};
    const paid = Number(amount.paid) || 0;
    const cancelledAmt = Number(amount.cancelled) || 0;
    const channelAmount = paid + cancelledAmt;   // 거래액 (할인 제외)
    const channelNet = paid;                     // 순거래액 = 실제 남은 결제금액

    gross += channelAmount;
    cancelled += cancelledAmt;
    if (status === "PAID" || status === "PARTIAL_CANCELLED") paidCount += 1;
    if (status === "CANCELLED" || status === "PARTIAL_CANCELLED") cancelCount += 1;

    const label = methodLabel(p);
    const c = channelMap.get(label) || { gross: 0, net: 0, count: 0 };
    c.gross += channelAmount;
    c.net += channelNet;
    c.count += 1;
    channelMap.set(label, c);

    const at = parseIso(p.paidAt) || parseIso(p.requestedAt);
    if (at) {
      const dkey = ymd(at);
      dailyMap.set(dkey, (dailyMap.get(dkey) || 0) + channelNet);
      const wkey = weekStart(at);
      weeklyMap.set(wkey, (weeklyMap.get(wkey) || 0) + channelNet);
    }
  }

  const netRevenue = gross - cancelled;

  const byChannel = Array.from(channelMap.entries())
    .map(([label, v]) => ({
      label,
      gross: v.gross,
      net: v.net,
      count: v.count,
      pct: netRevenue > 0 ? (v.net / netRevenue) * 100 : 0,
    }))
    .sort((a, b) => b.net - a.net);

  const daily = Array.from(dailyMap.entries())
    .map(([date, g]) => ({ date, gross: g }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const weekly = Array.from(weeklyMap.entries())
    .map(([weekStart, g]) => ({ weekStart, gross: g }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return {
    range,
    fetchedAt: new Date().toISOString(),
    gross,
    netRevenue,
    cancelled,
    paidCount,
    cancelCount,
    byChannel,
    daily,
    weekly,
  };
}
