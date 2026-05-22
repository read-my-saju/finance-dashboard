import { NextRequest, NextResponse } from "next/server";
import { buildToken, checkPassword, cookieName, ttlSeconds } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const password = String(body?.password || "");

  if (!checkPassword(password)) {
    return NextResponse.json({ ok: false, error: "invalid_password" }, { status: 401 });
  }

  const token = buildToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: cookieName(),
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ttlSeconds(),
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: cookieName(),
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
