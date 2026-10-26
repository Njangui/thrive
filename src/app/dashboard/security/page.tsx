import Link from "next/link";
import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { listChannelIdentities } from "@/application/services/channel-identity-service";
import { SupabaseStepUpAdapter } from "@/infrastructure/channels/supabase-step-up-adapter";
import { env } from "@/lib/env";
import { LinkTelegramCard, PinForm } from "./forms";
import { resetPinAction, revokeIdentityAction } from "./actions";

export const dynamic = "force-dynamic";

const CHANNEL_LABEL = { telegram: "Telegram", whatsapp: "WhatsApp" } as const;

export default async function SecurityPage() {
  const actor = await requireDashboardActor();
  const [identities, hasPin] = await Promise.all([listChannelIdentities(actor), new SupabaseStepUpAdapter().hasPin(actor.membershipId)]);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Sécurité du pilotage par chat</h1>
        <p className="text-sm text-slate-600">Reliez votre Telegram pour piloter l&apos;entreprise depuis votre téléphone, et protégez les actions sensibles par un PIN.</p>
      </header>

      <section className="adm-card space-y-3 p-5" aria-labelledby="sec-link">
        <h2 id="sec-link" className="font-medium">Relier Telegram</h2>
        <LinkTelegramCard botConfigured={Boolean(env.TELEGRAM_BOT_USERNAME)} />
      </section>

      <section className="adm-card space-y-2 p-5" aria-labelledby="sec-wa">
        <h2 id="sec-wa" className="font-medium">Relier WhatsApp</h2>
        <p className="text-sm text-slate-600">Pilotez aussi l&apos;entreprise depuis votre WhatsApp.</p>
        <Link href="/dashboard/security/whatsapp" className="adm-btn-secondary inline-block px-3 py-1.5 text-sm">Configurer WhatsApp</Link>
      </section>

      <section className="adm-card space-y-3 p-5" aria-labelledby="sec-pin">
        <h2 id="sec-pin" className="font-medium">PIN de validation</h2>
        <p className="text-sm text-slate-600">Demandé pour les actions sensibles (remboursement, changement de prix…). Après 5 erreurs, il se verrouille temporairement. Si vous avez oublié votre PIN, réinitialisez-le puis définissez-en un nouveau.</p>
        <PinForm hasPin={hasPin} />
        {hasPin && <form action={resetPinAction}><button type="submit" className="adm-btn-secondary px-3 py-1.5 text-sm">Réinitialiser mon PIN</button></form>}
      </section>

      <section className="adm-card space-y-3 p-5" aria-labelledby="sec-ids">
        <h2 id="sec-ids" className="font-medium">Appareils reliés</h2>
        {identities.length === 0 ? <p className="text-sm text-slate-500">Aucun appareil relié.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {identities.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{CHANNEL_LABEL[i.channel]} {i.label ? `· ${i.label}` : ""}{i.memberName ? ` · ${i.memberName}` : ""}</p>
                  <p className="text-xs text-slate-500">Relié le {fmt(i.linkedAt)}{i.lastSeenAt ? ` · dernière activité le ${fmt(i.lastSeenAt)}` : ""}</p>
                </div>
                <form action={revokeIdentityAction}><input type="hidden" name="identityId" value={i.id} /><button type="submit" className="adm-btn-secondary px-3 py-1.5 text-sm">Délier</button></form>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">Téléphone perdu ou volé ? Déliez-le immédiatement : il cesse de fonctionner au message suivant.</p>
      </section>
    </div>
  );
}
