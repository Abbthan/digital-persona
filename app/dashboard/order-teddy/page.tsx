import { redirect } from "next/navigation";
import { ComingSoon } from "@/front_end/components/ComingSoon";
import { getCurrentUser } from "@/back_end/services/auth";

export default async function OrderTeddyPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    redirect("/?authRequired=1");
  }

  return (
    <ComingSoon
      title="Order Teddy"
      blurb="A physical companion for your persona — coming in a later phase."
      backHref="/dashboard"
    />
  );
}
