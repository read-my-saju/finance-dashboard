"use client";

import { Suspense, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Next.js 14 App Router 는 `useSearchParams()` 를 쓰는 client component 를
// 정적 prerender 하기 위해 반드시 <Suspense> 안에서 호출하도록 강제한다.
// 그렇지 않으면 production build 에서 다음 에러로 실패:
//   useSearchParams() should be wrapped in a suspense boundary.
// LoginForm 을 분리해 Suspense 로 감싸는 표준 패턴 적용.

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const nextPath = search.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error === "invalid_password" ? "비밀번호가 틀렸습니다." : "로그인 실패");
        setLoading(false);
        return;
      }
      router.replace(nextPath);
    } catch {
      setError("네트워크 오류");
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm"
    >
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">ReadMySaju</h1>
      <p className="mb-6 text-sm text-gray-500">결제 대시보드</p>
      <label className="mb-2 block text-sm font-medium text-gray-700">비밀번호</label>
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-portone focus:ring-2 focus:ring-portone-50"
        placeholder="••••••••"
      />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading || !password}
        className="w-full rounded-lg bg-portone py-2.5 text-sm font-medium text-white transition hover:bg-portone-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "확인 중…" : "로그인"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
