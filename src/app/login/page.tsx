import { redirect } from "next/navigation";
import { authEnabled, isAuthenticated } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Only ever forward to an internal path ("/x", not "//host" or a full URL)
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (!authEnabled() || (await isAuthenticated())) redirect(safeNext);
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-[12px] font-bold text-white">
            M
          </span>
          <span className="text-[16px] font-semibold tracking-tight">
            Meridian
          </span>
        </div>
        <h1 className="text-[15px] font-semibold">Welcome back</h1>
        <p className="mb-5 mt-1 text-[13px] text-ink-2">
          Enter your passphrase to unlock your dashboard.
        </p>
        <LoginForm next={safeNext} />
      </div>
    </div>
  );
}
