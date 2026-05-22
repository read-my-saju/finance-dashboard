/**
 * 결제 데이터 raw dump CSV. PortOne 콘솔의 결제내역 CSV 와 직접 1:1 비교용.
 *
 * 사용:
 *   /api/payments-raw?from=2026-01-01&until=2026-05-23
 *   → CSV 다운로드. 컬럼: id, status, paidAt, requestedAt, method.type,
 *      method.provider, pgProvider, amount.total, amount.discount, amount.paid,
 *      amount.cancelled, currency
 */
import { NextRequest, NextResponse } from "next/server";
import { fetchAllPaidPayments } from "@/lib/portone";
import { isAuthed } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isoStartOfDay(s: string): string {
  return new Date(s + "T00:00:00+09:00").toISOString();
}
function isoEndOfDay(s: string): string {
  return new Date(s + "T23:59:59+09:00").toISOString();
}

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || "2026-01-01";
  const until = searchParams.get("until") || new Date().toISOString().slice(0, 10);

  try {
    const { items } = await fetchAllPaidPayments({
      fromISO: isoStartOfDay(from),
      untilISO: isoEndOfDay(until),
    });

    const headers = [
      "id",
      "status",
      "paidAt",
      "requestedAt",
      "method.type",
      "method.provider",
      "pgProvider",
      "currency",
      "amount.total",
      "amount.discount",
      "amount.paid",
      "amount.cancelled",
      "orderName",
    ];
    const rows: string[] = [headers.join(",")];
    for (const p of items as any[]) {
      const m = p.method || {};
      const a = p.amount || {};
      const row = [
        p.id,
        p.status,
        p.paidAt || "",
        p.requestedAt || "",
        m.type || "",
        m.provider || "",
        p.channel?.pgProvider || "",
        p.currency || "",
        a.total ?? "",
        a.discount ?? "",
        a.paid ?? "",
        a.cancelled ?? "",
        p.orderName || "",
      ].map(csvEscape);
      rows.push(row.join(","));
    }

    const csv = rows.join("\n");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="payments-${from}-to-${until}.csv"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "fetch_failed", detail: String(e?.message || e) },
      { status: 502 },
    );
  }
}
