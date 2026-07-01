/**
 * PortOne V2 결제 조회 client — 공식 OpenAPI spec 기준.
 *
 * V2 의 GET /payments-by-cursor 는 PortOne 특유의 형식을 씀:
 *  - HTTP method: GET
 *  - body 를 query string 의 `requestBody=` 에 URL-encoded JSON 으로 전달
 *  - 응답: { items: [{ payment, cursor }, ...] }
 *  - 페이지네이션: 응답 items 의 마지막 cursor 를 다음 요청 cursor 로
 *
 * 처음 작성 시 query 를 nested params 로 보내서 PortOne 이 from/until 을
 * 무시하고 default (최근 90일) 만 반환하던 버그가 있었음. requestBody 형식
 * 으로 수정.
 */

const BASE = "https://api.portone.io";

export type PortonePayment = {
  id?: string;
  status?: string;
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
  // 결제 통화 (KRW/USD ...). 토스 해외결제·국내결제 구분 및 KRW 필터에 사용.
  currency?: string;
  cancellations?: Array<{ amount?: number; cancelledAt?: string; reason?: string }>;
};

export type FetchDebug = {
  attempts: Array<{
    cursor: string;
    url: string;
    status: number;
    itemsCount: number;
    rawKeys: string[];
    nextCursor: string | null;
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
 * GET /payments-by-cursor 한 page fetch.
 */
async function fetchCursorPage(args: {
  from: string;
  until: string;
  cursor?: string;
  size: number;
}): Promise<{ url: string; status: number; data: any }> {
  const storeId = process.env.PORTONE_STORE_ID;
  const body: Record<string, any> = {
    from: args.from,
    until: args.until,
    size: args.size,
  };
  if (storeId) body.storeId = storeId;
  if (args.cursor) body.cursor = args.cursor;
  const url = `${BASE}/payments-by-cursor?requestBody=${encodeURIComponent(JSON.stringify(body))}`;
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

/**
 * 기간 내 모든 결제 (status 무관) 를 cursor 기반으로 모두 가져온다.
 * status=PAID 필터는 client 측 aggregate 에서.
 */
export async function fetchAllPaidPayments(opts: {
  fromISO: string;
  untilISO: string;
  cap?: number;
}): Promise<{ items: PortonePayment[]; debug: FetchDebug }> {
  const cap = opts.cap ?? 50000;
  const SIZE = 1000;
  const all: PortonePayment[] = [];
  const debug: FetchDebug = { attempts: [], totalItems: 0, stopReason: "loop_end" };

  // payment.id 로 dedup. PortOne cursor 페이지네이션이 inclusive 라
  // 페이지 경계에서 마지막 결제가 다음 페이지 첫 결제로 다시 들어오는 경우
  // 있어서 합산 시 inflate. id 기준으로 한 번 처리.
  const seenIds = new Set<string>();

  let cursor: string | undefined;
  for (let i = 0; i < 200 && all.length < cap; i++) {
    const { url, status, data } = await fetchCursorPage({
      from: opts.fromISO,
      until: opts.untilISO,
      cursor,
      size: SIZE,
    });

    const rawKeys = data && typeof data === "object" ? Object.keys(data) : [];
    const items: Array<{ payment: PortonePayment; cursor: string }> = Array.isArray(data?.items)
      ? data.items
      : [];

    if (status !== 200) {
      debug.attempts.push({
        cursor: cursor || "(first)",
        url,
        status,
        itemsCount: 0,
        rawKeys,
        nextCursor: null,
      });
      debug.stopReason = `status_${status}`;
      break;
    }

    let pageDups = 0;
    for (const it of items) {
      const p = it.payment;
      if (!p) continue;
      const id = (p as any).id;
      if (id && seenIds.has(id)) {
        pageDups += 1;
        continue;
      }
      if (id) seenIds.add(id);
      all.push(p);
    }
    const lastCursor = items.length > 0 ? items[items.length - 1].cursor : null;

    debug.attempts.push({
      cursor: cursor || "(first)",
      url,
      status,
      itemsCount: items.length,
      rawKeys,
      nextCursor: lastCursor,
    });

    if (items.length === 0) {
      debug.stopReason = "empty_page";
      break;
    }
    if (!lastCursor) {
      debug.stopReason = "no_next_cursor";
      break;
    }
    if (items.length < SIZE) {
      debug.stopReason = "partial_page";
      // 마지막 page, cursor 진행 안 함.
      break;
    }
    cursor = lastCursor;
  }

  debug.totalItems = all.length;
  return { items: all.slice(0, cap), debug };
}

/**
 * pgProvider → 사용자 친화 라벨.
 */
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
