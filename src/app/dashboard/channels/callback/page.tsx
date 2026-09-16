import { redirect } from "next/navigation";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { persistZernioOAuthConnection } from "@/application/services/zernio-channel-service";

export default async function ZernioChannelCallback({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const connected = String(params.connected ?? "");
  const profileId = String(params.profileId ?? "");
  const accountId = String(params.accountId ?? "");
  const username = params.username ? String(params.username) : undefined;
  const error = params.error ? String(params.error) : "";
  const { organizationId } = await requireCurrentOrganization();

  if (error) redirect(`/dashboard/channels?error=${encodeURIComponent(`Connexion refusée par le fournisseur (${error}).`)}`);
  if (!connected || !profileId || !accountId) {
    redirect("/dashboard/channels?error=Connexion%20incompl%C3%A8te%20ou%20annul%C3%A9e.");
  }

  await persistZernioOAuthConnection(organizationId, connected, profileId, accountId, username);
  redirect(`/dashboard/channels?success=${encodeURIComponent(`${connected} connecté avec succès.`)}`);
}
