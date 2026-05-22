import type { PortonePayment } from "./portone";
import { channelLabel } from "./portone";

export type DashboardSummary = {
  range: { from: string; until: string };
  fetchedAt: string;
  gross: number;            // 거래액 (PAID 결제의 amount.total 합)
  netRevenue: number;       // 순거래액 (gross - cancelled)
  cancelled: number;        // 거래취소액 (amount.cancelled 합)
  paidCount: number;        // PAID 건수
  cancelCount: number;      // 취소 건수
  byChannel: Array<{ label: string; gross: number; net: number; count: number; pct: number }>;
  daily: Array<{ date: string; gross: number }>;          // 일별
  weekly: Array<{ weekStart: string; gross: number }>;    // 주간
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
  const day = x.getDay(); // 0=Sun
  const diff = (day + 6) % 7; // Mon=0
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return ymd(x);
}

export function aggregate(payments: PortonePayment[], range: { from: string; until: string }): DashboardSummary {
  let gross = 0;
  let cancelled = 0;
  let paidCount = 0;
  let cancelCount = 0;

  const channelMap = new Map<string, { gross: number; net: number; count: number }>();
  const dailyMap = new Map<string, number>();
  const weeklyMap = new Map<string, number>();

  for (const p of payments) {
    const amount = p.amount || {};
    const total = Number(amount.total) || 0;
    const cancelledAmt = Number(amount.cancelled) || 0;
    const net = total - cancelledAmt;
    const status = (p.status || "").toUpperCase();
    const label = channelLabel(p.channel?.pgProvider);

    if (status === "PAID") {
      gross += total;
      cancelled += cancelledAmt;
      paidCount += 1;
      if (cancelledAmt > 0) cancelCount += 1;

      const c = channelMap.get(label) || { gross: 0, net: 0, count: 0 };
      c.gross += total;
      c.net += net;
      c.count += 1;
      channelMap.set(label, c);

      const at = parseIso(p.paidAt) || parseIso(p.requestedAt);
      if (at) {
        const dkey = ymd(at);
        dailyMap.set(dkey, (dailyMap.get(dkey) || 0) + total);
        const wkey = weekStart(at);
        weeklyMap.set(wkey, (weeklyMap.get(wkey) || 0) + total);
      }
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
