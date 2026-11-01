/**
 * API 로 못 가져오는 비용을 손으로 넣는 곳 (사장님 결정 2026-11-02). 금액은 엑셀 월별 P&L 과 같다.
 *
 * - SEEDING_AD_COSTS: 인플루언서 시딩비. 광고비 합계·공헌이익·MER 에만 더하고 메타 캠페인·채널 ROAS 에는 안 섞는다.
 * - AI_API_PAYMENTS : 2026-10 부터 리포트 생성원가 = Claude·OpenAI API 실제 결제액만 (나머지는 크레딧).
 *                     건당 단가는 0원(calc.ts)이고, 그달 결제 합계를 말일에 한 건으로 넣는다.
 *
 * 달이 마감되면 여기에 한 줄씩 추가한다. date 는 KST YYYY-MM-DD.
 */

export type ManualCost = { date: string; amount: number; label: string };

export const SEEDING_AD_COSTS: ManualCost[] = [
  { date: "2026-10-02", amount: 1_100_000, label: "인플루언서 시딩 지우니·죠대리 (3.3% 총액)" },
  { date: "2026-10-06", amount: 500_000, label: "핏플루언스 시딩 (공급가)" },
  { date: "2026-10-31", amount: 2_200_000, label: "콜보드 SNS 브랜딩 기본료 (VAT 포함 입금액)" },
  { date: "2026-11-30", amount: 11_000_000, label: "콜보드 인플루언서 시딩 릴스 3건 (VAT 포함 입금액)" },
];

export const AI_API_PAYMENTS: ManualCost[] = [
  // Claude: 롯데 AMEX 9건 513,100 + KB NEED 5건 $315.50 ≈ 421,669(10월 평균 환율 추정). OpenAI 결제 0건(크레딧).
  { date: "2026-10-31", amount: 934_769, label: "10월 Claude·OpenAI API 결제액" },
];

/** 기간 안의 항목만 날짜별로 합친다. computeProfit 의 metaByDay 와 같은 모양. */
export function manualByDay(list: ManualCost[], range: { from: string; until: string }): Array<{ date: string; spend: number }> {
  const m = new Map<string, number>();
  for (const c of list) {
    if (c.date < range.from || c.date > range.until) continue;
    m.set(c.date, (m.get(c.date) || 0) + c.amount);
  }
  return Array.from(m, ([date, spend]) => ({ date, spend }));
}
