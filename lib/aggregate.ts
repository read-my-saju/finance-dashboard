import type { PortonePayment } from "./portone";

export type DashboardSummary = {
  range: { from: string; until: string };
  fetchedAt: string;
  gross: number;            // 거래액 = (PAID + CANCELLED).amount.total
  netRevenue: number;       // 순거래액 = PAID.amount.total (CANCELLED 제외)
  cancelled: number;        // 거래취소액 = CANCELLED.amount.total
  paidCount: number;
  cancelCount: number;
  byChannel: Array<{ label: string; gross: number; net: number; count: number; pct: number }>;
  daily: Array<{ date: string; gross: number }>;
  weekly: Array<{ weekStart: string; gross: number }>;
};

type AnyPayment = PortonePayment & {
  method?: {
    type?: string;
    provider?: string;
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
 * PortOne 콘솔의 "결제수단별 순거래액 TOP5" 매핑.
 *
 * 사장님 PortOne 결제내역 CSV (12,986 rows) 실측으로 확정한 규칙:
 *   "상세 결제수단" 컬럼 == method.provider (EasyPayProvider enum)
 *   - "KAKAOPAY"   → "카카오페이"
 *   - "NAVERPAY"   → "Npay"
 *   - "TOSSPAY"    → "토스페이"
 *   - "SAMSUNGPAY" → "삼성페이"
 *   - (빈값/없음)  → "신용카드"  (= 일반 카드결제)
 *
 * 우리 API 의 method.provider 가 있으면 그 값으로 분류, 없으면 type 기반:
 *   - method.type 이 PaymentMethodCard 이고 provider 없음 → "신용카드"
 *   - method.type 이 PaymentMethodEasyPay 이고 provider 매핑
 *   - 그 외 type → 적절 라벨
 */
function methodLabel(payment: AnyPayment): string {
  const m = payment.method || {};
  const provider = (m.provider || "").toUpperCase();
  const type = (m.type || "").toUpperCase();

  // 엑셀 검증 기준: provider 가 있으면 그 값이 결제수단 판별의 1차 기준.
  if (provider.includes("KAKAOPAY")) return "카카오페이";
  if (provider.includes("NAVERPAY")) return "Npay";
  if (provider.includes("TOSSPAY") || provider.includes("TOSS_BRANDPAY")) return "토스페이";
  if (provider.includes("SAMSUNGPAY")) return "삼성페이";
  if (provider.includes("PAYCO")) return "페이코";
  if (provider.includes("APPLEPAY")) return "Apple Pay";
  if (provider.includes("PAYPAL")) return "PayPal";
  if (provider.includes("SSGPAY")) return "SSG페이";
  if (provider.includes("LPAY")) return "LPAY";

  // provider 없음: type 기반.
  if (type.includes("CARD")) return "신용카드";
  if (type.includes("TRANSFER")) return "계좌이체";
  if (type.includes("VIRTUAL")) return "가상계좌";
  if (type.includes("MOBILE")) return "휴대폰결제";
  if (type.includes("CONVENIENCE")) return "편의점";
  if (type.includes("GIFT")) return "상품권";
  if (type.includes("EASYPAY") || type.includes("EASY_PAY")) return "간편결제";

  // fallback
  const pg = (payment.channel?.pgProvider || "").toUpperCase();
  if (pg.includes("KAKAOPAY")) return "카카오페이";
  if (pg.includes("INICIS") || pg.includes("KG")) return "KG이니시스";
  return pg || "기타";
}

export function aggregate(
  payments: PortonePayment[],
  range: { from: string; until: string },
): DashboardSummary {
  // PortOne 콘솔 정의 (사장님 PortOne 결제내역 엑셀 12,986 rows 실측 검증):
  //   거래액      = (PAID + CANCELLED).amount.total
  //   순거래액     = PAID.amount.total 만 (CANCELLED 제외)
  //   거래취소액   = CANCELLED.amount.total (= 환불액)
  //   결제수단별   = PAID 만, method.provider (없으면 "신용카드")
  //   일/주간 그래프 = PAID 만
  //
  // amount.discount 는 무시 (PortOne 콘솔의 거래액은 할인 무관 = total 그대로).
  // FAILED 는 모두 제외.
  //
  // PARTIAL_CANCELLED 는 엑셀에 없었지만 V2 API 응답에는 가능. 처리:
  //   - 거래액에 amount.total 포함
  //   - 순거래액에 (amount.total - amount.cancelled) 포함
  //   - 거래취소액에 amount.cancelled 포함
  //   → 사실상 PAID + (그 일부가 cancelled) 처럼 동작.

  let gross = 0;
  let netRevenue = 0;
  let cancelled = 0;
  let paidCount = 0;
  let cancelCount = 0;

  const channelMap = new Map<string, { gross: number; net: number; count: number }>();
  const dailyMap = new Map<string, number>();
  const weeklyMap = new Map<string, number>();

  for (const raw of payments) {
    const p = raw as AnyPayment;
    const status = (p.status || "").toUpperCase();

    // 테스트 채널 결제 제외 (PortOne 콘솔의 "테스트 데이터" toggle OFF 와 동일).
    // SelectedChannel.type === "TEST" 이면 테스트 연동 채널. 콘솔 export 도 제외.
    // 사장님 PortOne 엑셀 vs 우리 CSV 1:1 diff 결과 50건 / 686,260원 차이가
    // 모두 이 케이스로 확인됨.
    const channelType = (p.channel?.type || "").toUpperCase();
    if (channelType === "TEST") continue;

    const amount = p.amount || {};
    const total = Number(amount.total) || 0;
    const cancelledAmt = Number(amount.cancelled) || 0;

    if (status === "PAID") {
      gross += total;
      netRevenue += total;
      paidCount += 1;

      const label = methodLabel(p);
      const c = channelMap.get(label) || { gross: 0, net: 0, count: 0 };
      c.gross += total;
      c.net += total;
      c.count += 1;
      channelMap.set(label, c);

      const at = parseIso(p.paidAt) || parseIso(p.requestedAt);
      if (at) {
        const dkey = ymd(at);
        dailyMap.set(dkey, (dailyMap.get(dkey) || 0) + total);
        const wkey = weekStart(at);
        weeklyMap.set(wkey, (weeklyMap.get(wkey) || 0) + total);
      }
    } else if (status === "CANCELLED") {
      gross += total;            // 거래액에 포함
      cancelled += total;         // CANCELLED 전액 환불 = total = cancelled amount
      cancelCount += 1;
      // 순거래액 / 결제수단별 / 그래프엔 제외 (PortOne 콘솔 동일).
    } else if (status === "PARTIAL_CANCELLED") {
      // 엑셀엔 없었지만 V2 API 가능. PAID + 부분환불로 처리.
      gross += total;
      netRevenue += total - cancelledAmt;
      cancelled += cancelledAmt;
      paidCount += 1;
      cancelCount += 1;

      const label = methodLabel(p);
      const c = channelMap.get(label) || { gross: 0, net: 0, count: 0 };
      c.gross += total;
      c.net += total - cancelledAmt;
      c.count += 1;
      channelMap.set(label, c);

      const at = parseIso(p.paidAt) || parseIso(p.requestedAt);
      if (at) {
        const dkey = ymd(at);
        dailyMap.set(dkey, (dailyMap.get(dkey) || 0) + (total - cancelledAmt));
        const wkey = weekStart(at);
        weeklyMap.set(wkey, (weeklyMap.get(wkey) || 0) + (total - cancelledAmt));
      }
    }
    // FAILED / READY / PAY_PENDING / VIRTUAL_ACCOUNT_ISSUED → 무시
  }

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
