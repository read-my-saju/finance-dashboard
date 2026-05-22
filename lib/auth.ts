/**
 * 단순 비밀번호 인증.
 *
 * 환경변수:
 *   DASHBOARD_PASSWORD  로그인 비밀번호 (필수)
 *   SESSION_SECRET      쿠키 서명용 (필수)
 *
 * 세션 토큰 = HMAC-SHA256(SESSION_SECRET, "v1:" + expISOdate) 의 16진수.
 * exp 30 일.
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
  const exp = new Date(Date.now() + TTL_DAYS * 24 * 3600 * 1000).toISOString();
  const sig = crypto.createHmac("sha256", secret()).update(`v1:${exp}`).digest("hex");
  return `${exp}.${sig}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;
  if (new Date(exp).getTime() < Date.now()) return false;
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
