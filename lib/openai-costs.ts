/**
 * OpenAI 실제 사용액(Costs API)으로 하루 리포트 생성 원가를 잡는다 (사장님 결정 2026-11-28).
 * 건당 단가 추정 대신 OpenAI 분석 화면 '지출'과 같은 숫자를 쓴다.
 *   GET https://api.openai.com/v1/organization/costs  (관리자 키 OPENAI_ADMIN_KEY 필요)
 *
 * - 하루 단위는 UTC 자정 기준이라 한국 시간 09시~다음 날 09시가 그 날짜로 들어간다.
 * - 원화 환산은 메타 광고비와 같은 ECB 일별 환율(lib/fx.ts). 부가세 없음(청구서 $40 = 크레딧 $40).
 * - ChatGPT 구독에 딸린 API 크레딧으로 쓴 부분도 사용액에 들어간다(구독료는 손익 원장 구독비).
 * - 아직 안 끝난 하루와 0원인 날은 넣지 않는다 → 그날은 calc.ts 건당 단가로 계산된다.
 * - 11/7 이후 OpenAI 자동충전 결제액을 manual-costs.ts AI_API_PAYMENTS 에 넣으면 이중으로 잡힌다(넣지 말 것).
 * - 키가 없으면 조용히 건당 단가로, 키가 있는데 실패하면 화면 알림과 함께 건당 단가로.
 */
import { getUsdKrwRates } from "./fx";

export const OPENAI_COST_FROM = "2026-11-07";   // 이 날부터 실제 사용액. 이전은 calc.ts·manual-costs.ts 그대로

type CostBucket = { start_time: number; results?: Array<{ amount?: { value?: number | string } }> };

/**
 * 버킷 → 날짜(UTC 기준 YYYY-MM-DD)별 달러.
 * 아직 안 끝난 하루(KST 00~09시엔 어제, 그 뒤엔 오늘)와 0원인 날은 뺀다 → 그날은 건당 단가로 계산.
 */
export function usdByDay(buckets: CostBucket[], nowSec: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of buckets) {
    if (b.start_time + 86_400 > nowSec) continue;
    const usd = (b.results ?? []).reduce((s, r) => s + (Number(r.amount?.value) || 0), 0);
    if (usd <= 0) continue;
    const date = new Date(b.start_time * 1000).toISOString().slice(0, 10);
    m.set(date, (m.get(date) || 0) + usd);
  }
  return m;
}

export async function fetchOpenAiCostByDay(
  from: string,
  until: string,
): Promise<{ rows: Array<{ date: string; spend: number }>; error: string | null }> {
  const key = process.env.OPENAI_ADMIN_KEY;
  const start = from > OPENAI_COST_FROM ? from : OPENAI_COST_FROM;
  if (!key || start > until) return { rows: [], error: null };

  try {
    const buckets: CostBucket[] = [];
    let page: string | undefined;
    // 180일 한 쪽이면 1번에 끝난다. 다음 쪽 표시가 계속 와도 10번에서 멈춘다.
    for (let i = 0; i < 10; i++) {
      const q = new URLSearchParams({
        start_time: String(Date.parse(`${start}T00:00:00Z`) / 1000),
        end_time: String(Date.parse(`${until}T00:00:00Z`) / 1000 + 86_400),
        bucket_width: "1d",
        limit: "180",
      });
      if (page) q.set("page", page);
      const res = await fetch(`https://api.openai.com/v1/organization/costs?${q}`, {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),   // 멈추면 대시보드 전체가 기다리므로
      });
      if (!res.ok) throw new Error(`OpenAI costs ${res.status}`);
      const j: any = await res.json();
      buckets.push(...(j.data ?? []));
      page = j.has_more ? j.next_page : undefined;
      if (!page) break;
    }
    const usd = usdByDay(buckets, Date.now() / 1000);
    const rates = await getUsdKrwRates([...usd.keys()]);
    return { rows: [...usd].map(([date, v]) => ({ date, spend: v * rates.get(date)! })), error: null };
  } catch (e: any) {
    // 외부 응답 본문은 화면에 내보내지 않는다.
    console.warn("[openai-costs]", String(e?.message || e).slice(0, 200));
    return { rows: [], error: "OpenAI 사용액을 받지 못해 리포트 원가를 건당 추정 단가로 계산하고 있습니다." };
  }
}
