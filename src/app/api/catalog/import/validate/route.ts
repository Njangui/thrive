import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/application/services/auth-service";
import { validateDraftProducts } from "@/application/services/catalog-smart-import-service";
import { isModuleEnabled } from "@/application/services/module-service";
import { AppError, toClientErrorResponse, ValidationError } from "@/lib/errors";

const BodySchema = z.object({
  organizationId: z.string().uuid(),
  productIds: z.array(z.string().uuid()).min(1).max(1000),
});

/** Validation en bloc des brouillons importés : un geste, périmètre = ce tenant uniquement. */
export async function POST(request: Request) {
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("organizationId et productIds (uuid) requis");
    const { organizationId, productIds } = parsed.data;

    const membership = await requireMembership(organizationId, ["owner", "admin", "manager"]);
    if (!(await isModuleEnabled(organizationId, "catalog"))) {
      throw new ValidationError("Module catalogue désactivé pour cette organisation");
    }
    return NextResponse.json(await validateDraftProducts(organizationId, productIds, membership.userId));
  } catch (error) {
    if (!(error instanceof AppError)) console.error("Validation en bloc catalogue: erreur inattendue:", error);
    const { status, body } = toClientErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
