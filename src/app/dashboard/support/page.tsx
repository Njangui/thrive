import { requireCurrentOrganization } from "@/application/services/auth-service";
import { SUPPORT_CONTACTS, supportWhatsAppUrl } from "@/application/config/customer-support";
import { IconChat } from "@/app/_components/app-icons";

export const metadata = { title: "Service client" };

/**
 * Page « Service client » : présente les numéros WhatsApp du support.
 * Chaque bouton ouvre WhatsApp avec un message pré-rempli (nom de
 * l'entreprise inclus) pour que l'équipe sache tout de suite qui écrit.
 * Les numéros vivent dans `application/config/customer-support.ts`.
 */
export default async function SupportPage() {
  const org = await requireCurrentOrganization();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-jakarta text-2xl font-bold tracking-tight">Service client</h1>
        <p className="mt-1 text-sm text-slate-500">
          Une question, un souci de paiement, de connexion ou de configuration ? Écrivez-nous directement sur WhatsApp, notre équipe vous répond.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {SUPPORT_CONTACTS.map((contact) => (
          <div
            key={contact.digits}
            className="flex flex-col gap-4 rounded-2xl border border-navy-900/[0.06] bg-white p-5 shadow-[0_1px_2px_rgba(16,23,49,0.04)]"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-success-50 text-success-700">
                <IconChat className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">{contact.label}</p>
                <p className="font-jakarta text-lg font-semibold text-navy-900">{contact.display}</p>
              </div>
            </div>
            <a
              href={supportWhatsAppUrl(contact, org.organizationName)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700"
            >
              Écrire sur WhatsApp
            </a>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-navy-900/[0.06] bg-white p-5 text-sm text-slate-600">
        <h2 className="font-jakarta text-base font-semibold text-navy-900">Pour être aidé plus vite</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Précisez le nom de votre entreprise (déjà indiqué dans le message pré-rempli).</li>
          <li>Décrivez le problème en une phrase et joignez une capture d&apos;écran si possible.</li>
          <li>Pour un paiement, indiquez le montant, la date et le moyen de paiement utilisé.</li>
        </ul>
      </div>
    </div>
  );
}
