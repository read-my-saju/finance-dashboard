/**
 * 결제 데이터 소스 통합.
 *
 * 2026-06-19 결제 PG 를 PortOne → 토스페이먼츠로 전환. 과거(PortOne) + 신규(Toss)
 * 매출을 한 번에 가져와 PortonePayment[] 로 합쳐 돌려준다. 토스는 PortonePayment
 * 형태로 어댑트되므로 (lib/toss.ts) aggregate / computeProfit 는 그대로 재사용된다.
 *
 * payments route(매출 조회)와 dashboard-cache(광고 손익) 양쪽이 이 함수를 쓴다.
 * 키가 없는 PG 는 빈 결과로 스킵(에러 아님). 한쪽이 실패해도 다른 쪽은 살린다.
 */
import { fetchAllPaidPayments, type PortonePayment } from "./portone";
import { fetchAllTossTransactions, tossToPortonePayments } from "./toss";

function isoStartOfDay(s: string): string {
  return new Date(s + "T00:00:00+09:00").toISOString();
}
function isoEndOfDay(s: string): string {
  return new Date(s + "T23:59:59+09:00").toISOString();
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type CombinedPayments = {
  payments: PortonePayment[];
  warnings: string[];
  portoneDebug: unknown;
  tossDebug: unknown;
  bothFailed: boolean;     // 양쪽 모두 실패 (보여줄 데이터 없음)
};

export async function fetchCombinedPayments(opts: {
  from: string;    // yyyy-mm-dd
  until: string;   // yyyy-mm-dd
}): Promise<CombinedPayments> {
  const fromISO = isoStartOfDay(opts.from);
  const untilISO = isoEndOfDay(opts.until);

  const hasPortone = !!process.env.PORTONE_API_KEY;
  const hasToss = !!process.env.TOSS_SECRET_KEY;

  const [pRes, tRes] = await Promise.allSettled([
    hasPortone
      ? fetchAllPaidPayments({ fromISO, untilISO })
      : Promise.resolve({ items: [] as PortonePayment[], debug: null }),
    hasToss
      ? fetchAllTossTransactions({ from: opts.from, until: opts.until })
      : Promise.resolve({ items: [], debug: null }),
  ]);

  const warnings: string[] = [];

  let portonePayments: PortonePayment[] = [];
  let portoneDebug: unknown = null;
  if (pRes.status === "fulfilled") {
    portonePayments = pRes.value.items;
    portoneDebug = pRes.value.debug;
  } else {
    warnings.push(`PortOne 조회 실패: ${errMsg(pRes.reason)}`);
  }

  let tossPayments: PortonePayment[] = [];
  let tossDebug: unknown = null;
  if (tRes.status === "fulfilled") {
    tossPayments = tossToPortonePayments(tRes.value.items);
    tossDebug = tRes.value.debug;
  } else {
    warnings.push(`Toss 조회 실패: ${errMsg(tRes.reason)}`);
  }

  return {
    payments: [...portonePayments, ...tossPayments],
    warnings,
    portoneDebug,
    tossDebug,
    bothFailed: pRes.status === "rejected" && tRes.status === "rejected",
  };
}
