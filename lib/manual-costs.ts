/**
 * API 로 못 가져오는 비용을 손으로 넣는 곳 (사장님 결정 2026-11-02). 금액은 엑셀 월별 P&L 과 같다.
 *
 * - SEEDING_AD_COSTS: 인플루언서 시딩비. 광고비 합계·공헌이익·MER 에만 더하고 메타 캠페인·채널 ROAS 에는 안 섞는다.
 * - NAVER_AD_COSTS  : 네이버 검색광고(파워링크) 비즈머니 소진액(VAT 포함, 광고센터 결제 관리 일별 합계).
 *                     광고비 합계와 채널 '검색광고' 광고비에 들어간다. 2026-09-23 잔액 소진 후 광고 꺼짐.
 *                     첫 광고비 지원 페이백은 무상 쿠폰 49,866원(10/25 발급, 미사용)이라 비용에서 빼지 않는다.
 * - AI_API_PAYMENTS : 2026-10 부터 리포트 생성원가 = Claude·OpenAI API 실제 결제액만 (나머지는 크레딧).
 *                     건당 단가는 0원(calc.ts).
 *
 * 모든 항목은 date 가 속한 달의 일수로 나눠 그 달 매일에 넣는다 (사장님 결정 2026-11-02: 하루에 몰리면
 * 일별 손익·손익분기 추이가 튄다). 달이 마감되면 여기에 한 줄씩 추가한다. date 는 KST YYYY-MM-DD.
 */

export type ManualCost = { date: string; amount: number; label: string };

export const SEEDING_AD_COSTS: ManualCost[] = [
  { date: "2026-10-02", amount: 1_100_000, label: "인플루언서 시딩 지우니·죠대리 (3.3% 총액)" },
  { date: "2026-10-06", amount: 500_000, label: "핏플루언스 시딩 (공급가)" },
  { date: "2026-10-31", amount: 2_200_000, label: "콜보드 SNS 브랜딩 기본료 (VAT 포함 입금액)" },
  { date: "2026-11-30", amount: 11_000_000, label: "콜보드 인플루언서 시딩 릴스 3건 (VAT 포함 입금액)" },
];

export const NAVER_AD_COSTS: ManualCost[] = [
  { date: "2026-08-31", amount: 6_137, label: "네이버 파워링크 8/28~31 소진" },
  { date: "2026-09-30", amount: 44_029, label: "네이버 파워링크 9/1~23 소진" },
];

export const AI_API_PAYMENTS: ManualCost[] = [
  // Claude: 롯데 AMEX 9건 513,100 + KB NEED 5건 $315.50 ≈ 421,669(10월 평균 환율 추정). OpenAI 결제 0건(크레딧).
  { date: "2026-10-31", amount: 934_769, label: "10월 Claude·OpenAI API 결제액" },
];

/** 항목을 그 달 일수로 나눠 기간 안의 날짜별로 합친다. computeProfit 의 metaByDay 와 같은 모양. */
export function spreadByMonth(list: ManualCost[], range: { from: string; until: string }): Array<{ date: string; spend: number }> {
  const m = new Map<string, number>();
  for (const c of list) {
    const [y, mo] = c.date.split("-").map(Number);
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) {
      const date = `${c.date.slice(0, 8)}${String(d).padStart(2, "0")}`;
      if (date < range.from || date > range.until) continue;
      m.set(date, (m.get(date) || 0) + c.amount / days);
    }
  }
  return Array.from(m, ([date, spend]) => ({ date, spend }));
}

/** 기간에 들어간 금액 합계 (spreadByMonth 기준). */
export function totalInRange(list: ManualCost[], range: { from: string; until: string }): number {
  return spreadByMonth(list, range).reduce((s, r) => s + r.spend, 0);
}
