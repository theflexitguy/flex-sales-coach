import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { signOut } from "./actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <Sidebar user={user} onSignOut={signOut} />
      <main className="lg:pl-64">
        <div className="px-4 py-6 lg:px-8 pt-16 lg:pt-6">{children}</div>
      </main>
    </div>
  );
}
