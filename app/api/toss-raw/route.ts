/**
 * 토스 거래 raw dump CSV — 토스 상점관리자 "매출액" 과 1:1 대조 + 취소행 부호/상태 검증용.
 *
 * 사용:
 *   /api/toss-raw?from=2026-07-01&until=2026-07-01
 *   → CSV. 컬럼: transactionKey, paymentKey, orderId, status, method,
 *      currency, amount, transactionAt
 *
 * 그룹핑(paymentKey 단위 순승인) 이전의 **원본** 거래를 그대로 보여준다.
 * 취소 행이 음수 amount 인지, 승인 행 status 가 취소 후에도 DONE 인지 등을
 * 실데이터로 확인해 lib/toss.ts 매핑 가정을 검증한다.
 */
import { NextRequest, NextResponse } from "next/server";
import { fetchAllTossTransactions } from "@/lib/toss";
import { isAuthed } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  if (!process.env.TOSS_SECRET_KEY) {
    return NextResponse.json(
      { error: "no_toss_key", detail: "TOSS_SECRET_KEY 가 설정되지 않았습니다." },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || "2026-06-19";
  const until = searchParams.get("until") || new Date().toISOString().slice(0, 10);

  try {
    const { items, debug } = await fetchAllTossTransactions({ from, until });

    // ?debug=1 이면 수집 메타(건수/페이지)만 JSON 으로.
    if (searchParams.get("debug") === "1") {
      return NextResponse.json({ from, until, totalItems: items.length, debug });
    }

    const headers = [
      "transactionKey",
      "paymentKey",
      "orderId",
      "status",
      "method",
      "currency",
      "amount",
      "transactionAt",
    ];
    const rows: string[] = [headers.join(",")];
    for (const t of items) {
      rows.push(
        [
          t.transactionKey,
          t.paymentKey,
          t.orderId,
          t.status,
          t.method,
          t.currency,
          t.amount,
          t.transactionAt,
        ]
          .map(csvEscape)
          .join(","),
      );
    }

    return new NextResponse(rows.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="toss-raw-${from}-to-${until}.csv"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "fetch_failed", detail: String(e?.message || e).slice(0, 300) },
      { status: 502 },
    );
  }
}
