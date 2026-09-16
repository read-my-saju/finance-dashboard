import { redirect } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import { isAuthed } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  // 미들웨어는 쿠키 존재만 봄 → 서명 검증으로 SESSION_SECRET 교체 시 기존 세션 차단
  if (!(await isAuthed())) redirect("/login");
  return <Dashboard />;
}
