import { NextRequest, NextResponse } from "next/server";

/**
 * 인증 미들웨어. 로그인 페이지 / 정적 자산 / 로그인 API 외에는 쿠키
 * 가 없으면 /login 으로 리다이렉트. 쿠키 서명 검증은 Edge runtime 의
 * 제약으로 page / api 안에서 다시 수행 (Node crypto 필요).
 */

const COOKIE = "rmsf_session";

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon|api/auth).*)"],
};

export function middleware(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  // 서명 검증은 page / route handler 안에서 isAuthed() 로 다시 확인.
  return NextResponse.next();
}
