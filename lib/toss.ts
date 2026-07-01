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

/**
 * 토스 거래 → PortonePayment 형태 변환 (기존 aggregate 재사용).
 * status 매핑: DONE→PAID, CANCELED/PARTIAL_CANCELED→CANCELLED.
 *
 * 안전 개선 (무회귀):
 *   - currency 를 실어보내 aggregate/profit 의 KRW 필터가 토스 해외(USD) 결제를
 *     국내 매출에서 분리하도록 한다 (기존엔 currency 유실로 USD 도 KRW 취급).
 *   - 음수 amount 는 status 와 무관하게 취소로 간주 (음수는 절대 매출이 아님).
 *
 * TODO(진단 후): 토스 /v1/transactions 는 취소를 별도 행으로 주므로, paymentKey 로
 *   묶어 부분취소를 정밀 반영하는 게 정확하다. 다만 취소행 부호 규칙이 문서에
 *   불명확해, /api/toss-raw 덤프로 실데이터 검증 후 그룹 집계로 전환한다.
 *   (현재는 부분취소를 전액취소로 근사 — 사주 디지털상품 특성상 드묾.)
 */
export function tossToPortonePayments(txns: TossTransaction[]): PortonePayment[] {
  const out: PortonePayment[] = [];
  for (const t of txns) {
    const status = (t.status || "").toUpperCase();
    const rawAmount = Number(t.amount) || 0;
    const amount = Math.abs(rawAmount);
    if (amount <= 0) continue;

    let mapped: string;
    if (rawAmount < 0) mapped = "CANCELLED"; // 음수 = 환불/취소 (매출 아님)
    else if (status === "DONE") mapped = "PAID";
    else if (status === "CANCELED" || status === "PARTIAL_CANCELED") mapped = "CANCELLED";
    else continue; // READY / IN_PROGRESS / WAITING_FOR_DEPOSIT 등 미완료 제외

    out.push({
      id: t.transactionKey || t.paymentKey || "",
      status: mapped,
      paidAt: t.transactionAt,
      requestedAt: t.transactionAt,
      amount: {
        total: amount,
        paid: amount,
        cancelled: mapped === "CANCELLED" ? amount : 0,
      },
      channel: { pgProvider: "TOSS", type: "" },
      method: tossMethodToPortone(t.method),
      currency: (t.currency || "KRW").toUpperCase(),
    } as PortonePayment);
  }
  return out;
}
