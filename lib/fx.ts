/**
 * USD → KRW 환율 조회.
 *
 * 메타 광고계정이 USD (Read My Saju_USD) 라서, Meta 가 돌려주는 광고비/전환값을
 * 원화로 환산해야 대시보드의 매출(KRW)과 같은 단위로 손익·ROAS 를 계산할 수 있다.
 * (이 환산이 없으면 spend=30(USD) 이 30원으로 취급돼 광고비가 ~1,300배 축소된다.)
 *
 * 소스 우선순위:
 *   1. frankfurter.app — 무료·키 불필요·ECB 기준·과거 일자 지원.
 *      https://api.frankfurter.app/{YYYY-MM-DD}?base=USD&symbols=KRW
 *      주말/공휴일(ECB 미고시일)은 직전 영업일 값을 돌려준다.
 *   2. open.er-api.com 최신값 — frankfurter 실패 시 (과거 일자에도 최신환율로 근사).
 *   3. 상수 fallback — 둘 다 실패해도 서비스가 죽지 않도록.
 *
 * 날짜별 in-memory Map 캐시. warm 컨테이너 동안 같은 날짜는 재호출 안 함.
 * (일자별 환산 → 메타 실제 청구(일 단위 환율)와 근접.)
 */

// 둘 다 실패 시 최후 fallback. 실제 환율과 다를 수 있으나 서비스 중단보다 낫다.
export const FALLBACK_USD_KRW = 1350;

const cache = new Map<string, number>();

function todayKstYmd(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function fetchFrankfurter(date: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.frankfurter.app/${date}?base=USD&symbols=KRW`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const rate = Number(data?.rates?.KRW);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

async function fetchErApiLatest(): Promise<number | null> {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/USD`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const rate = Number(data?.rates?.KRW);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

/**
 * 특정 일자(YYYY-MM-DD)의 USD→KRW 환율. 미래/미고시일은 근접 영업일 값.
 * 항상 성공 (fallback 상수까지). 날짜별 캐시.
 */
export async function getUsdKrwRate(date: string): Promise<number> {
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayKstYmd();
  const cached = cache.get(d);
  if (cached !== undefined) return cached;

  let rate = await fetchFrankfurter(d);
  if (rate === null) rate = await fetchErApiLatest();
  if (rate === null) rate = FALLBACK_USD_KRW;

  cache.set(d, rate);
  return rate;
}

/** 여러 날짜의 환율을 한 번에 조회 (중복 제거 후 병렬). */
export async function getUsdKrwRates(dates: string[]): Promise<Map<string, number>> {
  const uniq = Array.from(new Set(dates.filter(Boolean)));
  const out = new Map<string, number>();
  await Promise.all(
    uniq.map(async (d) => {
      out.set(d, await getUsdKrwRate(d));
    }),
  );
  return out;
}
