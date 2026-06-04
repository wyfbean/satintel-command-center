import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "登录 / 注册 · 卫星情报" };

export default async function SignInPage() {
  // Already authenticated → go straight to news
  const session = await auth();
  if (session?.user?.id) redirect("/news");

  const hasGoogle = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fc] px-4">
      <div className="w-full max-w-md">
        {/* Logo / header */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#1a1f2e] text-lg font-bold text-white">
            轨道
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">卫星情报中心</h1>
          <p className="text-sm text-slate-500">登录以启用个性化推荐与跨设备偏好同步</p>
        </div>

        <SignInForm hasGoogle={hasGoogle} />
      </div>
    </main>
  );
}
