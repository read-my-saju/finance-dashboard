/**
 * PortOne V2 결제 조회 client.
 *
 * V2 API 의 정확한 query schema 는 콘솔 / docs 의 minor version 에 따라 다를
 * 수 있어 방어적으로 작성. fetchAllPaidPayments 가 debug 정보 (요청 URL,
 * 응답 size, 처리한 page 수) 를 함께 반환한다.
 */

const BASE = "https://api.portone.io";

export type PortonePayment = {
  id?: string;
  status?: string;          // PAID, CANCELLED, READY ...
  requestedAt?: string;
  paidAt?: string;
  amount?: {
    total?: number;
    paid?: number;
    cancelled?: number;
  };
  channel?: {
    pgProvider?: string;
    type?: string;
  };
  cancellations?: Array<{ amount?: number; cancelledAt?: string; reason?: string }>;
};

export type PortoneListResponse = {
  items: PortonePayment[];
  nextCursor?: string | null;
  totalCount?: number;
  /** raw 응답 keys (디버그용). */
  rawKeys?: string[];
};

export type FetchDebug = {
  attempts: Array<{
    page: number;
    url: string;
    status: number;
    itemsCount: number;
    rawKeys: string[];
    hasNextCursor: boolean;
  }>;
  totalItems: number;
  stopReason: string;
};

function authHeader(): Record<string, string> {
  const key = process.env.PORTONE_API_KEY;
  if (!key) throw new Error("PORTONE_API_KEY env var is missing");
  return {
    Authorization: `PortOne ${key}`,
    "Content-Type": "application/json",
  };
}

/**
 * 단일 page fetch. raw 응답을 분석 가능하도록 그대로 반환.
 */
async function fetchOnePage(opts: {
  from: string;
  until: string;
  status?: string;
  page: number;
  pageSize: number;
  includeStoreId: boolean;
}): Promise<{ url: string; status: number; data: any }> {
  const storeId = process.env.PORTONE_STORE_ID;
  const qs = new URLSearchParams();
  qs.set("requestedTimeRange.from", opts.from);
  qs.set("requestedTimeRange.until", opts.until);
  qs.set("page.size", String(opts.pageSize));
  qs.set("page.number", String(opts.page));
  if (opts.status) qs.set("filter.status", opts.status);
  if (opts.includeStoreId && storeId) qs.set("filter.storeId", storeId);
  const url = `${BASE}/payments?${qs.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: authHeader(),
    cache: "no-store",
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { url, status: res.status, data };
}

function extractItems(data: any): PortonePayment[] {
  if (!data) return [];
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.payments)) return data.payments;
  return [];
}

function rawKeys(data: any): string[] {
  if (!data || typeof data !== "object") return [];
  return Object.keys(data);
}

/**
 * 기간 내 모든 PAID 결제를 페이지네이션으로 모두 가져온다.
 * 첫 page 응답 형식을 보고 pagination 전략을 결정.
 */
export async function fetchAllPaidPayments(opts: {
  fromISO: string;
  untilISO: string;
  cap?: number;
}): Promise<{ items: PortonePayment[]; debug: FetchDebug }> {
  const cap = opts.cap ?? 20000;
  const all: PortonePayment[] = [];
  const debug: FetchDebug = { attempts: [], totalItems: 0, stopReason: "" };

  let page = 1;
  let includeStoreId = true;
  const pageSize = 100;
  let stopReason = "loop_end";

  for (let i = 0; i < 200 && all.length < cap; i++) {
    const { url, status, data } = await fetchOnePage({
      from: opts.fromISO,
      until: opts.untilISO,
      status: "PAID",
      page,
      pageSize,
      includeStoreId,
    });

    if (status !== 200) {
      // 첫 page 가 4xx 면 storeId 가 문제일 수 있으니 한 번 더 storeId 없이.
      if (i === 0 && includeStoreId) {
        includeStoreId = false;
        debug.attempts.push({
          page,
          url,
          status,
          itemsCount: 0,
          rawKeys: rawKeys(data),
          hasNextCursor: false,
        });
        continue;
      }
      stopReason = `status_${status}_at_page_${page}`;
      debug.attempts.push({
        page,
        url,
        status,
        itemsCount: 0,
        rawKeys: rawKeys(data),
        hasNextCursor: false,
      });
      break;
    }

    const items = extractItems(data);
    debug.attempts.push({
      page,
      url,
      status,
      itemsCount: items.length,
      rawKeys: rawKeys(data),
      hasNextCursor: Boolean(data?.page?.next ?? data?.nextCursor),
    });
    all.push(...items);
    if (items.length === 0) {
      stopReason = `empty_page_${page}`;
      break;
    }
    if (items.length < pageSize) {
      stopReason = `partial_page_${page}`;
      break;
    }
    page += 1;
  }

  debug.totalItems = all.length;
  debug.stopReason = stopReason;
  return { items: all.slice(0, cap), debug };
}

export function channelLabel(pgProvider?: string): string {
  if (!pgProvider) return "기타";
  const p = pgProvider.toUpperCase();
  if (p.includes("KAKAOPAY") || p.startsWith("KAKAO")) return "카카오페이";
  if (p.includes("INICIS") || p.includes("KG")) return "KG이니시스";
  if (p.includes("PAYPAL")) return "PayPal";
  if (p.includes("TOSS")) return "토스페이";
  if (p.includes("NAVER") || p === "NPAY") return "Npay";
  if (p.includes("SAMSUNG")) return "삼성페이";
  if (p.includes("NICE")) return "나이스페이";
  return pgProvider;
}
