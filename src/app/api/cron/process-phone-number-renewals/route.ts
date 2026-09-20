import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { processPhoneNumberRenewals } from "@/application/services/phone-number-rental-service";

/**
 * Traite les échéances de location des numéros WhatsApp dédiés aux
 * groupes (relance J-3 + reprise automatique si non renouvelé) — même
 * pattern exact que `/api/cron/process-subscription-renewals`, sur un
 * cycle VOLONTAIREMENT indépendant (voir phone-number-rental-service.ts
 * et 0058_whatsapp_coexistence_dedicated_numbers.sql). Protection par
 * CRON_SECRET (voir lib/cron-auth.ts), à programmer toutes les 1-4h
 * comme les autres routes cron (voir docs/DEPLOYMENT.md).
 */
async function handle(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorized) {
    return NextResponse.json(auth.body, { status: auth.status });
  }

  try {
    const result = await processPhoneNumberRenewals();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("/api/cron/process-phone-number-renewals: échec:", error);
    return NextResponse.json({ ok: false, error: "Erreur interne" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
