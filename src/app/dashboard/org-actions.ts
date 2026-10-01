"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ACTIVE_ORG_COOKIE, getCurrentUserOrganizations } from "@/application/services/auth-service";

/** Change l'entreprise active. Refuse toute entreprise dont l'utilisateur n'est pas membre. */
export async function switchOrganizationAction(formData: FormData): Promise<void> {
  const requested = String(formData.get("organizationId") ?? "");
  const orgs = await getCurrentUserOrganizations();
  if (!orgs.some((o) => o.organizationId === requested)) {
    redirect("/dashboard");
  }
  (await cookies()).set(ACTIVE_ORG_COOKIE, requested, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}
