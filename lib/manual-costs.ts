/**
 * API 로 못 가져오는 비용을 손으로 넣는 곳 (사장님 결정 2026-11-02). 금액은 엑셀 월별 P&L 과 같다.
 *
 * - SEEDING_COSTS / BRANDING_COSTS: 마케팅비(인플루언서 시딩·SNS 브랜딩). 매일 광고 효율이 흐려지지 않게 기본 광고비에는
 *                     넣지 않고, 화면 '시딩·브랜딩 포함' 버튼을 켜면 광고비 합계·공헌이익·MER 에 더한다 (사장님 결정 2026-11-02 밤).
 *                     메타 캠페인·채널 ROAS 에는 어느 쪽이든 안 섞는다.
 * - NAVER_AD_COSTS  : 네이버 검색광고(파워링크) 비즈머니 소진액(VAT 포함, 광고센터 결제 관리 일별 합계).
 *                     광고비 합계와 채널 '검색광고' 광고비에 들어간다. 2026-09-23 잔액 소진 후 광고 꺼짐.
 *                     첫 광고비 지원 페이백은 무상 쿠폰 49,866원(10/25 발급, 미사용)이라 비용에서 빼지 않는다.
 * - AI_API_PAYMENTS : 건당 원가(calc.ts) 밖에서 따로 낸 AI API 비용. 2026-11-08 결정으로 10월분은 건당 원가
 *                     (10/1~10/10 1,500원, 10/11~ 500원)에 들어 있어 비워 둔다.
 *
 * 모든 항목은 date 가 속한 달의 일수로 나눠 그 달 매일에 넣는다 (사장님 결정 2026-11-02: 하루에 몰리면
 * 일별 손익·손익분기 추이가 튄다). 실제 집행 기간을 아는 비용(네이버)은 from~date 에만 나눈다.
 * 달이 마감되면 여기에 한 줄씩 추가한다. date 는 KST YYYY-MM-DD.
 */

// from 이 있으면 from~date 사이에만 나눈다 (실제 집행일을 아는 비용). 없으면 date 가 속한 달 전체.
export type ManualCost = { date: string; amount: number; label: string; from?: string };

export const SEEDING_COSTS: ManualCost[] = [
  { date: "2026-10-02", amount: 1_100_000, label: "인플루언서 시딩 지우니·죠대리 (3.3% 총액)" },
  { date: "2026-10-06", amount: 550_000, label: "핏플루언스 시딩 (VAT 포함)" },
  { date: "2026-11-30", amount: 11_000_000, label: "콜보드 인플루언서 시딩 릴스 3건 (VAT 포함 입금액)" },
];

export const BRANDING_COSTS: ManualCost[] = [
  { date: "2026-10-31", amount: 2_200_000, label: "콜보드 SNS 브랜딩 기본료 (VAT 포함 입금액)" },
];

export const NAVER_AD_COSTS: ManualCost[] = [
  { from: "2026-08-28", date: "2026-08-31", amount: 6_137, label: "네이버 파워링크 8/28~31 소진" },
  { from: "2026-09-01", date: "2026-09-23", amount: 44_029, label: "네이버 파워링크 9/1~23 소진" },
];

export const AI_API_PAYMENTS: ManualCost[] = [];

// 서버비(월별 손익 엑셀 매출원가의 서버 칸과 같은 금액). 리포트 원가 칸에 더해 공헌이익에서 뺀다.
export const SERVER_COSTS: ManualCost[] = [
  { date: "2026-09-30", amount: 400_000, label: "AWS 9월" },
  { date: "2026-10-31", amount: 116_760, label: "Vercel 10월 (10/1 55,509 + 10/31 61,251)" },
];

/** 항목을 나눌 날짜들: from~date, from 이 없으면 date 가 속한 달 전체. */
function spreadDays(c: ManualCost): string[] {
  const [y, mo] = c.date.split("-").map(Number);
  const monthEnd = `${c.date.slice(0, 8)}${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
  const first = c.from ?? `${c.date.slice(0, 8)}01`;
  const last = c.from ? c.date : monthEnd;
  const out: string[] = [];
  for (let d = new Date(`${first}T00:00:00Z`); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** 항목을 그 달(또는 from~date) 일수로 나눠 기간 안의 날짜별로 합친다. computeProfit 의 metaByDay 와 같은 모양. */
export function spreadByMonth(list: ManualCost[], range: { from: string; until: string }): Array<{ date: string; spend: number }> {
  const m = new Map<string, number>();
  for (const c of list) {
    const days = spreadDays(c);
    for (const date of days) {
      if (date < range.from || date > range.until) continue;
      m.set(date, (m.get(date) || 0) + c.amount / days.length);
    }
  }
  return Array.from(m, ([date, spend]) => ({ date, spend }));
}

/** 마케팅비(시딩 + 브랜딩) 날짜별 금액. 화면에서 '시딩·브랜딩 포함'을 켰을 때만 광고비에 더한다. */
export function marketingByDay(range: { from: string; until: string }): Array<{ date: string; spend: number }> {
  return [...spreadByMonth(SEEDING_COSTS, range), ...spreadByMonth(BRANDING_COSTS, range)];
}

/** 기간에 들어간 금액 합계 (spreadByMonth 기준). */
export function totalInRange(list: ManualCost[], range: { from: string; until: string }): number {
  return spreadByMonth(list, range).reduce((s, r) => s + r.spend, 0);
}
