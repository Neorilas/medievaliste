import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin";
import { AdminPanel } from "@/components/AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) redirect("/"); // no admin → fuera
  return <AdminPanel />;
}
