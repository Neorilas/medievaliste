import { AuthForm } from "@/components/AuthForm";

export default function RegisterPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-950 px-4 py-12 text-zinc-100">
      <AuthForm mode="register" googleEnabled={!!process.env.AUTH_GOOGLE_ID} />
    </main>
  );
}
