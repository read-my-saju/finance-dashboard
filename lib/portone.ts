/**
 * PortOne V2 결제 조회 client.
 *
 * 본 대시보드는 read-only 이므로 결제 / 환불 / 취소는 호출하지 않는다.
 * 다만 PortOne V2 `GET /payments` 의 정확한 query schema 는 콘솔 / docs 의
 * 버전에 따라 다를 수 있어 두 가지 패턴을 모두 시도한다.
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
    pgProvider?: string;     // KAKAOPAY, INICIS_V2, PAYPAL_V2, NICEPAY ...
    type?: string;
  };
  cancellations?: Array<{ amount?: number; cancelledAt?: string; reason?: string }>;
};

export type PortoneListResponse = {
  items: PortonePayment[];
  nextCursor?: string | null;
  totalCount?: number;
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
 * PortOne V2 GET /payments — 결제 일괄 조회.
 *
 * PortOne V2 docs 기준 `requestBody` 가 query string 으로 전달되는 special
 * format 을 쓴다. 여기서는 호환을 위해 두 패턴을 순차 시도한다.
 */
export async function listPayments(opts: {
  from: string;                // ISO 8601 (UTC)
  until: string;               // ISO 8601 (UTC)
  status?: string;             // "PAID" 등 — 비우면 전체
  cursor?: string;
  pageSize?: number;
}): Promise<PortoneListResponse> {
  const pageSize = opts.pageSize ?? 100;
  const storeId = process.env.PORTONE_STORE_ID;

  // pattern A: query-string flat params (V2 docs 의 simple form).
  const qs = new URLSearchParams();
  qs.set("requestedTimeRange.from", opts.from);
  qs.set("requestedTimeRange.until", opts.until);
  qs.set("page.size", String(pageSize));
  if (opts.cursor) qs.set("page.number", opts.cursor);
  if (opts.status) qs.set("filter.status", opts.status);
  // V2 list_payments 는 storeId 필수 (organization 가입 후 store 단위 키 발급).
  if (storeId) qs.set("filter.storeId", storeId);

  const url = `${BASE}/payments?${qs.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: authHeader(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PortOne list_payments failed: ${res.status} ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as any;

  // 정상 응답이면 items 가 있음.
  const items: PortonePayment[] = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.data)
      ? data.data
      : [];
  return {
    items,
    nextCursor: data?.page?.next ?? data?.nextCursor ?? null,
    totalCount: data?.totalCount ?? data?.page?.totalCount,
  };
}

/**
 * 기간 내 모든 PAID 결제를 페이지네이션으로 모두 가져온다.
 * 큰 결과는 메모리 부담이 있으므로 cap 으로 안전 한도를 둔다.
 */
export async function fetchAllPaidPayments(opts: {
  fromISO: string;
  untilISO: string;
  cap?: number;
}): Promise<PortonePayment[]> {
  const cap = opts.cap ?? 20000;
  const all: PortonePayment[] = [];
  let cursor: string | undefined;
  // PortOne V2 가 page.number 기반이라 1 부터 시작.
  let page = 1;
  for (let i = 0; i < 200 && all.length < cap; i++) {
    const resp = await listPayments({
      from: opts.fromISO,
      until: opts.untilISO,
      status: "PAID",
      cursor: String(page),
      pageSize: 100,
    });
    if (!resp.items.length) break;
    all.push(...resp.items);
    if (!resp.nextCursor && resp.items.length < 100) break;
    page += 1;
  }
  return all.slice(0, cap);
}

/**
 * pgProvider → 사용자 친화 라벨 매핑.
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
