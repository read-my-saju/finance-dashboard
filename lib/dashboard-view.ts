/** 대시보드 화면 가공 순수 함수. 날짜는 YYYY-MM-DD(KST) 문자열을 UTC 날짜로 다룬다. */

export type PresetKey = "today" | "yesterday" | "week" | "month30" | "thisMonth" | "lastMonth" | "all";

const PRESET_KEYS: PresetKey[] = ["today", "yesterday", "week", "month30", "thisMonth", "lastMonth", "all"];

function shift(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function presetRange(key: PresetKey, today: string): { from: string; until: string } {
  const [y, m] = today.split("-").map(Number);
  switch (key) {
    case "today": return { from: today, until: today };
    case "yesterday": return { from: shift(today, -1), until: shift(today, -1) };
    case "week": return { from: shift(today, -7), until: shift(today, -1) };
    case "month30": return { from: shift(today, -30), until: shift(today, -1) };
    case "thisMonth": return { from: `${y}-${String(m).padStart(2, "0")}-01`, until: today };
    case "lastMonth": {
      const first = `${y}-${String(m).padStart(2, "0")}-01`;
      return { from: shift(first, -1).slice(0, 8) + "01", until: shift(first, -1) };
    }
    case "all": return { from: "2026-01-01", until: today };
  }
}

export function presetOf(from: string, until: string, today: string): PresetKey | null {
  return PRESET_KEYS.find((k) => {
    const r = presetRange(k, today);
    return r.from === from && r.until === until;
  }) ?? null;
}

/** 어제 시간대별 매출에서 현재 시각(hour:minute)까지의 누적. 해당 시간대는 분 비율로 안분. */
export function sameTimeRevenue(hourly: Array<{ hour: number; amount: number }>, hour: number, minute: number): number {
  return hourly.reduce((sum, h) => {
    if (h.hour < hour) return sum + h.amount;
    if (h.hour === hour) return sum + (h.amount * minute) / 60;
    return sum;
  }, 0);
}

/** 만 원 단위 표기. 10만 원 미만은 소수 한 자리. */
export function fmtMan(won: number): string {
  if (won === 0) return "0원";
  const sign = won < 0 ? "−" : "";
  const man = Math.abs(won) / 10000;
  if (Math.abs(won) >= 100000) return sign + Math.round(man).toLocaleString("en-US") + "만";
  return sign + man.toFixed(1).replace(/\.0$/, "") + "만";
}

export type BreakdownInput = { netRevenue: number; vat: number; revenueExVat: number; pgFee: number; reportCost: number; adSpend: number; contributionProfit: number };
export type BreakdownRow = { sign: "" | "−" | "="; label: string; amount: number; per100: number; kind: "start" | "minus" | "eq" | "final" };
export type BreakdownSeg = { key: "costs" | "ad" | "profit"; label: string; amount: number; per100: number };

export function profitBreakdown(t: BreakdownInput): { rows: BreakdownRow[]; segs: BreakdownSeg[]; profitPer100: number } {
  const p = (n: number) => (t.netRevenue === 0 ? 0 : (n / t.netRevenue) * 100);
  const row = (sign: BreakdownRow["sign"], label: string, amount: number, kind: BreakdownRow["kind"]): BreakdownRow =>
    ({ sign, label, amount, per100: p(amount), kind });
  const costs = t.vat + t.pgFee + t.reportCost;
  const profit = Math.max(t.contributionProfit, 0);
  return {
    rows: [
      row("", "결제매출", t.netRevenue, "start"),
      row("−", "부가세", t.vat, "minus"),
      row("=", "부가세 제외 매출", t.revenueExVat, "eq"),
      row("−", "결제수수료", t.pgFee, "minus"),
      row("−", "리포트 원가", t.reportCost, "minus"),
      row("−", "광고비", t.adSpend, "minus"),
      row("=", "공헌이익 (남는 돈)", t.contributionProfit, "final"),
    ],
    segs: [
      { key: "costs", label: "부가세·수수료·원가", amount: costs, per100: p(costs) },
      { key: "ad", label: "광고비", amount: t.adSpend, per100: p(t.adSpend) },
      { key: "profit", label: "남는 돈", amount: profit, per100: p(profit) },
    ],
    profitPer100: p(t.contributionProfit),
  };
}

export function profitHeadline(profitPer100: number, live: boolean): string {
  if (profitPer100 < 0) return `결제 100원당 ${(-profitPer100).toFixed(1)}원 손실입니다`;
  return `결제 100원 중 ${profitPer100.toFixed(1)}원이 남습니다${live ? " (진행 중)" : ""}`;
}

export type Verdict = "good" | "warn" | "bad";

/** ROAS가 손익분기 미만이면 bad, 분기 대비 10% 이상 위면 good, 사이는 warn. */
export function verdictOf(roas: number | null, breakEven: number): Verdict | null {
  if (roas === null) return null;
  if (roas < breakEven) return "bad";
  return roas >= breakEven * 1.1 ? "good" : "warn";
}
