/**
 * 토스페이먼츠 거래 조회 client.
 *
 * 2026-06-19 결제 PG 를 토스로 전환 → 그 이후 매출은 토스 거래조회로 가져온다.
 * GET /v1/transactions, Secret Key 의 Basic 인증 (키 뒤에 콜론, 비밀번호는 빈값).
 *
 * 토스 거래는 PortOne 과 응답 구조가 다르다. aggregate.ts(PortOne 콘솔 정의로
 * 정교하게 튜닝됨) 를 건드리지 않도록, tossToPortonePayments() 로 PortonePayment
 * 형태로 변환해 기존 집계에 그대로 흘려보낸다.
 */
import type { PortonePayment } from "./portone";

const BASE = "https://api.tosspayments.com";

export type TossTransaction = {
  mId?: string;
  transactionKey?: string;
  paymentKey?: string;
  orderId?: string;
  method?: string;          // 카드 / 가상계좌 / 간편결제 / 휴대폰 / 계좌이체 ...
  amount?: number;
  status?: string;          // READY, IN_PROGRESS, DONE, CANCELED, PARTIAL_CANCELED ...
  transactionAt?: string;   // ISO 8601
  currency?: string;        // KRW ...
};

export type TossFetchDebug = {
  attempts: Array<{ startingAfter: string; status: number; itemsCount: number }>;
  totalItems: number;
  stopReason: string;
};

function authHeader(): Record<string, string> {
  const key = process.env.TOSS_SECRET_KEY;
  if (!key) throw new Error("TOSS_SECRET_KEY env var is missing");
  const basic = Buffer.from(`${key}:`).toString("base64");
  return {
    Authorization: `Basic ${basic}`,
    "Content-Type": "application/json",
  };
}

// yyyy-mm-dd → KST 경계 문자열. 토스 거래조회는 KST 기준이라 +09:00 을 명시.
function kstStart(d: string): string {
  return `${d}T00:00:00+09:00`;
}
function kstEnd(d: string): string {
  return `${d}T23:59:59+09:00`;
}

/**
 * 기간 내 모든 거래를 startingAfter 커서로 페이지네이션해 가져온다.
 * limit 최대 5000 이지만 안전하게 1000 으로 둔다.
 */
export async function fetchAllTossTransactions(opts: {
  from: string;    // yyyy-mm-dd
  until: string;   // yyyy-mm-dd
  cap?: number;
}): Promise<{ items: TossTransaction[]; debug: TossFetchDebug }> {
  const cap = opts.cap ?? 50000;
  const LIMIT = 1000;
  const all: TossTransaction[] = [];
  const debug: TossFetchDebug = { attempts: [], totalItems: 0, stopReason: "loop_end" };
  let startingAfter: string | undefined;

  for (let i = 0; i < 200 && all.length < cap; i++) {
    const qs = new URLSearchParams();
    qs.set("startDate", kstStart(opts.from));
    qs.set("endDate", kstEnd(opts.until));
    qs.set("limit", String(LIMIT));
    if (startingAfter) qs.set("startingAfter", startingAfter);

    const res = await fetch(`${BASE}/v1/transactions?${qs.toString()}`, {
      method: "GET",
      headers: authHeader(),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      debug.stopReason = `status_${res.status}`;
      throw new Error(`Toss list_transactions failed: ${res.status} ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as TossTransaction[] | { data?: TossTransaction[] };
    const items: TossTransaction[] = Array.isArray(data)
      ? data
      : Array.isArray((data as { data?: TossTransaction[] })?.data)
        ? (data as { data: TossTransaction[] }).data
        : [];

    debug.attempts.push({
      startingAfter: startingAfter || "(first)",
      status: res.status,
      itemsCount: items.length,
    });

    if (!items.length) {
      debug.stopReason = "empty_page";
      break;
    }
    all.push(...items);
    if (items.length < LIMIT) {
      debug.stopReason = "partial_page";
      break;
    }
    const last = items[items.length - 1];
    if (!last?.transactionKey) {
      debug.stopReason = "no_cursor";
      break;
    }
    startingAfter = last.transactionKey;
  }

  debug.totalItems = all.length;
  return { items: all.slice(0, cap), debug };
}

/**
 * 토스 method(한글) → PortOne method shape.
 * aggregate.ts 의 methodLabel 이 영문 type 으로 결제수단을 분류하므로 거기에 맞춘다.
 * 토스 거래조회는 간편결제 세부 제공사(카카오페이 등)를 주지 않아 "간편결제" 수준으로만 구분된다.
 */
function tossMethodToPortone(method?: string): { type?: string; provider?: string } {
  const m = method || "";
  if (m.includes("카드")) return { type: "PaymentMethodCard" };
  if (m.includes("가상계좌")) return { type: "PaymentMethodVirtualAccount" };
  if (m.includes("계좌이체") || m.includes("이체")) return { type: "PaymentMethodTransfer" };
  if (m.includes("휴대폰")) return { type: "PaymentMethodMobilePhone" };
  if (m.includes("상품권") || m.includes("문화")) return { type: "PaymentMethodGiftCertificate" };
  if (m.includes("간편")) return { type: "PaymentMethodEasyPay" };
  return { type: "" };
}

type TossGroup = {
  id: string;
  approved: number;   // 승인(DONE) amount 합
  canceled: number;   // 취소(CANCELED/PARTIAL_CANCELED) amount 합
  currency: string;
  method?: string;
  at?: string;        // 승인 시각 (가장 이른 DONE 거래 기준 = 결제일)
};

/**
 * 토스 거래 → PortonePayment 형태 변환 (paymentKey 단위 순승인 계산).
 *
 * 토스 /v1/transactions 는 한 결제의 **승인과 취소를 별도 행**으로 준다.
 * 실데이터(2026-07-01) 검증으로 확인한 규칙:
 *   - 취소 행: status=CANCELED, amount 는 **양수**(음수 아님), 원 승인행과 **같은 paymentKey**.
 *   - 승인 행: 취소돼도 status=DONE 유지 (별도 CANCELED 행이 추가될 뿐).
 * → paymentKey 로 묶어 approved(DONE 합) - canceled(CANCELED 합) = 순매출.
 *   이렇게 해야 환불된 결제가 매출에서 정확히 빠진다(기존엔 취소를 안 빼 과대계상).
 *
 * 변환 결과는 aggregate.ts / profit.ts 의 PAID·CANCELLED·PARTIAL_CANCELLED 정의에
 * 그대로 태워 순매출 = 승인 - 취소 로 잡힌다.
 */
export function tossToPortonePayments(txns: TossTransaction[]): PortonePayment[] {
  const groups = new Map<string, TossGroup>();

  for (const t of txns) {
    const status = (t.status || "").toUpperCase();
    const key = t.paymentKey || t.orderId || t.transactionKey || "";
    if (!key) continue;
    const amount = Math.abs(Number(t.amount) || 0);
    if (amount <= 0) continue;

    const g =
      groups.get(key) ||
      ({
        id: key,
        approved: 0,
        canceled: 0,
        currency: (t.currency || "").toUpperCase(),
        method: t.method,
        at: undefined,
      } as TossGroup);

    if (status === "DONE") {
      g.approved += amount;
      if (t.transactionAt && (!g.at || t.transactionAt < g.at)) g.at = t.transactionAt;
    } else if (status === "CANCELED" || status === "PARTIAL_CANCELED") {
      g.canceled += amount;
    } else {
      continue; // READY / IN_PROGRESS / WAITING_FOR_DEPOSIT / ABORTED / EXPIRED 등 미완료 제외
    }
    if (!g.currency && t.currency) g.currency = t.currency.toUpperCase();
    if (!g.method && t.method) g.method = t.method;
    groups.set(key, g);
  }

  const out: PortonePayment[] = [];
  for (const g of groups.values()) {
    if (g.approved <= 0) continue; // 조회범위에 취소 행만 있는 경우 등 → 매출 아님
    const canceled = Math.min(g.canceled, g.approved); // 과다취소 방지
    let status: string;
    if (canceled <= 0) status = "PAID";
    else if (canceled >= g.approved) status = "CANCELLED";
    else status = "PARTIAL_CANCELLED";

    out.push({
      id: g.id,
      status,
      paidAt: g.at,
      requestedAt: g.at,
      amount: {
        total: g.approved,
        paid: g.approved - canceled,
        cancelled: canceled,
      },
      channel: { pgProvider: "TOSS", type: "" },
      method: tossMethodToPortone(g.method),
      currency: g.currency || "KRW",
    } as PortonePayment);
  }
  return out;
}
