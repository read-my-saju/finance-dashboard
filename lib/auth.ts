/**
 * 단순 비밀번호 인증.
 *
 * 환경변수:
 *   DASHBOARD_PASSWORD  로그인 비밀번호 (필수)
 *   SESSION_SECRET      쿠키 서명용 (필수)
 *
 * 세션 토큰 = `{expUnixMs}.{HMAC-SHA256(SESSION_SECRET, "v1:" + expUnixMs)}`.
 * 이전 버전은 expiry 를 ISO datetime 으로 썼는데 milliseconds 가 포함한 `.`
 * 때문에 split(".") 가 토큰을 3 개로 쪼개 모든 검증이 실패하던 버그가 있었음.
 * 단순한 Unix milliseconds 숫자로 통일해서 안전.
 */
import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE_NAME = "rmsf_session";
const TTL_DAYS = 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET env var is missing");
  return s;
}

export function buildToken(): string {
  const expMs = Date.now() + TTL_DAYS * 24 * 3600 * 1000;
  const exp = String(expMs);
  const sig = crypto.createHmac("sha256", secret()).update(`v1:${exp}`).digest("hex");
  return `${exp}.${sig}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const idx = token.indexOf(".");
  if (idx <= 0) return false;
  const exp = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!exp || !sig) return false;
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const expected = crypto.createHmac("sha256", secret()).update(`v1:${exp}`).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function checkPassword(input: string): boolean {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function isAuthed(): Promise<boolean> {
  const c = cookies().get(COOKIE_NAME);
  return verifyToken(c?.value);
}

export function cookieName(): string {
  return COOKIE_NAME;
}

export function ttlSeconds(): number {
  return TTL_DAYS * 24 * 3600;
}
