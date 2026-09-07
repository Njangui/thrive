/**
 * Seed de démo — "Mode Élégance" (master prompt §81/§93 ; périmètre
 * hérité du Lot O, jamais réalisé — voir RAPPORT_FUSION_6.md section 8).
 *
 *   npm run seed:demo
 *
 * Réutilise les VRAIS services applicatifs partout où c'est possible —
 * le seed doit respecter les mêmes règles métier que l'app réelle, pas
 * les contourner. Trois exceptions assumées et documentées à leur
 * endroit exact ci-dessous, pour des raisons structurelles réelles (pas
 * de la paresse) :
 *
 *   1. Création de l'organisation/propriétaire — `onboarding-service.ts
 *      ::createOrganization()` dépend des cookies d'une vraie requête
 *      Next.js (`getSupabaseServerSessionClient()`), qui n'existe pas
 *      dans un script autonome. Sa logique (slug, ligne organizations,
 *      membership owner, onboarding_step) est reprise directement ici.
 *   2. Groupes WhatsApp — `whatsapp-group-service.ts::connectGroup()`
 *      appelle réellement l'API Zernio. Le cahier autorise explicitement
 *      une insertion directe pour la démo ("le seed ne passe jamais par
 *      de vrais appels Zernio").
 *   3. Abonnement business + add-on — `purchaseAddon()` appelle
 *      réellement NotchPay. On simule un paiement déjà confirmé (ligne
 *      `subscription_payments` à `status: 'completed'`) puis on délègue
 *      la suite à `confirmAddonPurchase()`, qui elle est pure DB.
 *
 * Idempotent par slug : relancer ne duplique jamais "Mode Élégance".
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { randomUUID } from "node:crypto";
import { getSupabaseServiceClient } from "../src/infrastructure/supabase/server-client";
import { createProduct, updateProduct } from "../src/application/services/catalog-service";
import { createService } from "../src/application/services/service-service";
import { findOrCreateOpenLead, updateLeadStatus } from "../src/application/services/lead-service";
import { createRevenue, createExpense, seedDefaultExpenseCategories } from "../src/application/services/finance-service";
import { updateLandingConfig } from "../src/application/services/landing-config-service";
import { createTestimonial } from "../src/application/services/landing-config-service";
import { confirmAddonPurchase } from "../src/application/services/addons-service";
import { LANDING_PRESETS } from "../src/application/config/landing-presets";

const DEMO_SLUG = "mode-elegance";
const DEMO_OWNER_EMAIL = "owner@mode-elegance.demo";
// Mot de passe de démo UNIQUEMENT — jamais réutilisé pour un compte réel,
// affiché volontairement en clair ici pour que le porteur du projet
// puisse se connecter et faire la démo (section 93 : "démontrable en
// quelques minutes").
const DEMO_OWNER_PASSWORD = "ModeElegance-Demo-2026!";

// Images de démonstration (placeholders publics, déterministes par seed
// — jamais le vrai Storage Provider tenant, hors de propos pour un seed).
const placeholderImage = (seed: string) => `https://picsum.photos/seed/${seed}/800/600`;

async function main() {
  const supabase = getSupabaseServiceClient();

  // -------------------------------------------------------------------
  // 1. Organisation "Mode Élégance" + compte owner (exception #1 ci-dessus)
  // -------------------------------------------------------------------
  const { data: existingOrg } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", DEMO_SLUG)
    .maybeSingle();

  let organizationId: string;
  if (existingOrg) {
    organizationId = existingOrg.id;
    console.log(`[seed] "Mode Élégance" existe déjà (${organizationId}) — pas de duplication, on continue.`);
  } else {
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .insert({
        name: "Mode Élégance",
        slug: DEMO_SLUG,
        industry: "retail",
        currency: "XAF",
        onboarding_step: 5,
        onboarding_completed_at: new Date().toISOString(),
        // Informations business (section 25 — pas de table dédiée,
        // colonnes directes sur organizations, voir business-info-resolver.ts).
        phone: "+237690000001",
        whatsapp_number: "+237690000001",
        email: "contact@mode-elegance.demo",
        address: "Avenue Kennedy, Yaoundé",
        opening_hours: "Lun-Sam 9h-19h",
      })
      .select("id")
      .single();
    if (orgError || !org) throw new Error(`Création organisation échouée: ${orgError?.message}`);
    organizationId = org.id;

    let ownerId: string;
    const { data: existingUser } = await supabase.auth.admin.listUsers();
    const alreadyCreated = existingUser?.users.find((u) => u.email === DEMO_OWNER_EMAIL);
    if (alreadyCreated) {
      ownerId = alreadyCreated.id;
    } else {
      const { data: userData, error: userError } = await supabase.auth.admin.createUser({
        email: DEMO_OWNER_EMAIL,
        password: DEMO_OWNER_PASSWORD,
        email_confirm: true,
      });
      if (userError || !userData.user) throw new Error(`Création owner échouée: ${userError?.message}`);
      ownerId = userData.user.id;
    }

    const { error: membershipError } = await supabase
      .from("memberships")
      .insert({ organization_id: organizationId, user_id: ownerId, role: "owner" });
    if (membershipError) throw new Error(`Création membership échouée: ${membershipError.message}`);

    console.log(`[seed] Organisation créée (${organizationId}). Connexion démo : ${DEMO_OWNER_EMAIL} / ${DEMO_OWNER_PASSWORD}`);
  }

  // -------------------------------------------------------------------
  // 2. Produits (8-10, au moins une image, quelques-uns avec SEO)
  // -------------------------------------------------------------------
  const { count: existingProductCount } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  const productIds: string[] = [];
  if (!existingProductCount) {
    const productDefs = [
      { name: "Robe wax imprimée", price: 25000, category: "Robes", seo: true },
      { name: "Ensemble tailleur bogolan", price: 42000, category: "Tailleurs", seo: true },
      { name: "Chemise en lin homme", price: 18000, category: "Chemises", seo: false },
      { name: "Sac à main brodé", price: 15000, category: "Accessoires", seo: true },
      { name: "Sandales en cuir", price: 12000, category: "Chaussures", seo: false },
      { name: "Boubou brodé grand modèle", price: 35000, category: "Robes", seo: false },
      { name: "Foulard en soie imprimé", price: 8000, category: "Accessoires", seo: false },
      { name: "Pantalon large en wax", price: 20000, category: "Pantalons", seo: false },
      { name: "Veste en bazin riche", price: 38000, compareAt: 45000, category: "Tailleurs", seo: true },
      { name: "Collier de perles artisanal", price: 6000, category: "Accessoires", seo: false },
    ];

    for (const [i, p] of productDefs.entries()) {
      const { productId } = await createProduct({
        organizationId,
        name: p.name,
        unitPrice: p.price,
        compareAtPrice: "compareAt" in p ? p.compareAt : undefined,
        categoryName: p.category,
        description: `${p.name} — pièce de la collection Mode Élégance.`,
        currentStock: 10 + i,
        status: "active",
        imageUrl: placeholderImage(`mode-elegance-produit-${i}`),
      });
      productIds.push(productId);

      // `createProduct` ne porte pas les champs SEO (seul `updateProduct`
      // les expose, voir catalog-service.ts) — appel de complément pour
      // les quelques produits du seed qui doivent en avoir (section 12).
      if (p.seo) {
        await updateProduct(productId, organizationId, {
          name: p.name,
          unitPrice: p.price,
          categoryName: p.category,
          seoTitle: `${p.name} — Mode Élégance à Yaoundé`,
          seoDescription: `Découvrez ${p.name.toLowerCase()} chez Mode Élégance, prêt-à-porter à Yaoundé.`,
        });
      }
    }
    console.log(`[seed] ${productDefs.length} produits créés.`);
  } else {
    const { data: existing } = await supabase.from("products").select("id").eq("organization_id", organizationId).limit(10);
    productIds.push(...(existing ?? []).map((p) => p.id as string));
    console.log(`[seed] Produits déjà présents (${existingProductCount}) — pas de duplication.`);
  }

  // -------------------------------------------------------------------
  // 3. Services (3-5)
  // -------------------------------------------------------------------
  const { count: existingServiceCount } = await supabase
    .from("services")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (!existingServiceCount) {
    const serviceDefs = [
      { name: "Retouche sur mesure", price: 5000, duration: 30 },
      { name: "Conseil en image", price: 15000, duration: 60 },
      { name: "Confection sur mesure", price: 50000, duration: 120 },
      { name: "Livraison à domicile (Yaoundé)", price: 2000, duration: 30 },
    ];
    for (const s of serviceDefs) {
      await createService({
        organizationId,
        name: s.name,
        price: s.price,
        durationMinutes: s.duration,
        description: `${s.name} par l'équipe Mode Élégance.`,
        status: "active",
      });
    }
    console.log(`[seed] ${serviceDefs.length} services créés.`);
  } else {
    console.log(`[seed] Services déjà présents (${existingServiceCount}) — pas de duplication.`);
  }

  // -------------------------------------------------------------------
  // 4. FAQ (3-5) + infos business — pas de service dédié (aucune UI de
  // gestion n'existe encore pour ces deux tables, voir COMPARAISON_MASTER_PROMPT.md) :
  // insertion directe, seule option possible aujourd'hui.
  // -------------------------------------------------------------------
  const { count: existingFaqCount } = await supabase
    .from("faqs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (!existingFaqCount) {
    await supabase.from("faqs").insert([
      {
        organization_id: organizationId,
        question: "Quels sont vos horaires ?",
        answer: "Nous sommes ouverts du lundi au samedi, de 9h à 19h.",
        keywords: ["horaires", "ouvert", "heure"],
      },
      {
        organization_id: organizationId,
        question: "Livrez-vous à domicile ?",
        answer: "Oui, la livraison à Yaoundé est disponible (voir nos services).",
        keywords: ["livraison", "domicile"],
      },
      {
        organization_id: organizationId,
        question: "Puis-je faire retoucher un vêtement acheté ailleurs ?",
        answer: "Oui, notre service de retouche sur mesure est ouvert à tous.",
        keywords: ["retouche", "couture"],
      },
      {
        organization_id: organizationId,
        question: "Acceptez-vous les paiements Mobile Money ?",
        answer: "Oui, MTN Mobile Money et Orange Money sont acceptés en boutique.",
        keywords: ["paiement", "mobile money"],
      },
    ]);
    console.log("[seed] 4 FAQ créées.");
  } else {
    console.log(`[seed] FAQ déjà présentes (${existingFaqCount}) — pas de duplication.`);
  }

  // -------------------------------------------------------------------
  // 5. Contacts/leads à différentes étapes du pipeline
  // -------------------------------------------------------------------
  const leadStages: { name: string; phone: string; status: "lead" | "qualified" | "opportunity" | "customer" | "lost" }[] = [
    { name: "Aïcha Ndongo", phone: "+237691000001", status: "lead" },
    { name: "Paul Etoundi", phone: "+237691000002", status: "qualified" },
    { name: "Fatima Bello", phone: "+237691000003", status: "opportunity" },
    { name: "Jean Mballa", phone: "+237691000004", status: "customer" },
    { name: "Clarisse Fotso", phone: "+237691000005", status: "lost" },
  ];

  for (const lead of leadStages) {
    const { data: existingContact } = await supabase
      .from("contacts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("phone_e164", lead.phone)
      .maybeSingle();

    let contactId: string;
    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const { data: contact, error: contactError } = await supabase
        .from("contacts")
        .insert({ organization_id: organizationId, full_name: lead.name, phone_e164: lead.phone, source_channel: "whatsapp" })
        .select("id")
        .single();
      if (contactError || !contact) throw new Error(`Création contact échouée: ${contactError?.message}`);
      contactId = contact.id;

      const { id: leadId } = await findOrCreateOpenLead(organizationId, contactId, "whatsapp");
      if (lead.status !== "lead") {
        await updateLeadStatus(organizationId, leadId, lead.status);
      }
    }
  }
  console.log(`[seed] ${leadStages.length} contacts/leads (pipeline complet) prêts.`);

  // -------------------------------------------------------------------
  // 6. Conversations avec messages, dont une escaladée humain — pas de
  // service de création dédié hors du routeur IA (Lot 3, non touché ici) :
  // insertion directe, aucun appel externe nécessaire.
  // -------------------------------------------------------------------
  const { data: demoContact } = await supabase
    .from("contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("phone_e164", "+237691000001")
    .single();

  const { count: existingConversationCount } = await supabase
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (!existingConversationCount && demoContact) {
    const conversationsDefs: { handoff: "ai" | "pending_human"; messages: { direction: "inbound" | "outbound"; sender: "contact" | "ai" | "human"; content: string }[] }[] = [
      {
        handoff: "ai",
        messages: [
          { direction: "inbound", sender: "contact", content: "Bonjour, avez-vous des robes wax ?" },
          { direction: "outbound", sender: "ai", content: "Bonjour ! Oui, nous avons plusieurs modèles de robes wax à partir de 25 000 FCFA." },
        ],
      },
      {
        handoff: "pending_human",
        messages: [
          { direction: "inbound", sender: "contact", content: "Je voudrais un devis pour une confection sur mesure pour un mariage." },
          { direction: "outbound", sender: "ai", content: "Pour une demande sur mesure aussi précise, je transmets à notre équipe qui revient vers vous rapidement." },
        ],
      },
    ];

    for (const conv of conversationsDefs) {
      const { data: conversation, error: convError } = await supabase
        .from("conversations")
        .insert({
          organization_id: organizationId,
          contact_id: demoContact.id,
          channel: "whatsapp",
          handoff_status: conv.handoff,
          handoff_reason: conv.handoff === "pending_human" ? "Demande sur mesure — nécessite un devis humain." : null,
          last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (convError || !conversation) throw new Error(`Création conversation échouée: ${convError?.message}`);

      await supabase.from("messages").insert(
        conv.messages.map((m) => ({
          organization_id: organizationId,
          conversation_id: conversation.id,
          direction: m.direction,
          sender: m.sender,
          content: m.content,
        })),
      );
    }
    console.log(`[seed] ${conversationsDefs.length} conversations créées, dont une escaladée humain.`);
  } else {
    console.log("[seed] Conversations déjà présentes — pas de duplication.");
  }

  // -------------------------------------------------------------------
  // 7. Groupes WhatsApp — un "activé", un "en attente" (exception #2)
  // -------------------------------------------------------------------
  const { count: existingGroupCount } = await supabase
    .from("whatsapp_groups")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (!existingGroupCount) {
    await supabase.from("whatsapp_groups").insert([
      {
        organization_id: organizationId,
        external_id: "demo-group-activated",
        name: "Clientes VIP Mode Élégance",
        status: "connected",
        // Donnée de DÉMO — jamais un vrai identifiant Zernio (le seed ne
        // passe par aucun vrai appel Zernio, voir en-tête de fichier).
        zernio_conversation_id: "demo-conversation-id-activated",
      },
      {
        organization_id: organizationId,
        external_id: "demo-group-pending",
        name: "Promotions du mois",
        status: "connected",
        zernio_conversation_id: null, // en attente : jamais contacté, pas encore diffusable (Lot M)
      },
    ]);
    console.log("[seed] 2 groupes WhatsApp créés (1 activé, 1 en attente).");
  } else {
    console.log("[seed] Groupes WhatsApp déjà présents — pas de duplication.");
  }

  // -------------------------------------------------------------------
  // 8. Publications sociales à statuts variés — pas de service de
  // création qui évite un vrai appel Zernio (createCampaignFromProducts
  // publie réellement) : insertion directe, statuts variés pour montrer
  // les différents états à l'écran (section 43).
  // -------------------------------------------------------------------
  const { count: existingPostCount } = await supabase
    .from("social_posts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (!existingPostCount && productIds.length > 0) {
    await supabase.from("social_posts").insert([
      { organization_id: organizationId, product_id: productIds[0], content: "Nouvelle collection wax disponible !", status: "published" },
      { organization_id: organizationId, product_id: productIds[1], content: "Ensemble tailleur bogolan, élégance garantie.", status: "scheduled", scheduled_for: new Date(Date.now() + 86_400_000).toISOString() },
      { organization_id: organizationId, product_id: productIds[2], content: "Chemise en lin, parfaite pour la saison.", status: "failed", error_message: "Compte Facebook déconnecté — reconnectez-le depuis Publications." },
    ]);
    console.log("[seed] 3 publications sociales créées (statuts variés).");
  } else {
    console.log("[seed] Publications déjà présentes — pas de duplication.");
  }

  // -------------------------------------------------------------------
  // 9. Finance
  // -------------------------------------------------------------------
  await seedDefaultExpenseCategories(organizationId);
  const { count: existingRevenueCount } = await supabase
    .from("revenues")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (!existingRevenueCount) {
    await createRevenue({ organizationId, amount: 45000, category: "Ventes boutique", source: "manual", note: "Vente du jour" });
    await createRevenue({ organizationId, amount: 20000, category: "Ventes boutique", source: "manual" });
    await createExpense({ organizationId, amount: 15000, categoryName: "Fournitures", description: "Tissu et fournitures couture" });
    console.log("[seed] Lignes finance créées.");
  } else {
    console.log("[seed] Finance déjà présente — pas de duplication.");
  }

  // -------------------------------------------------------------------
  // 10. Abonnement business actif + add-on (exception #3)
  // -------------------------------------------------------------------
  const { data: existingSub } = await supabase
    .from("organization_subscriptions")
    .select("plan_key")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!existingSub || existingSub.plan_key !== "business") {
    await supabase.from("organization_subscriptions").upsert(
      {
        organization_id: organizationId,
        plan_key: "business",
        status: "active",
        trial_start: new Date().toISOString(),
        trial_end: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    );

    const { data: anyAddon } = await supabase.from("addons").select("key").eq("active", true).limit(1).maybeSingle();
    if (anyAddon) {
      const paymentId = randomUUID();
      await supabase.from("subscription_payments").insert({
        id: paymentId,
        organization_id: organizationId,
        payment_type: "addon",
        addon_key: anyAddon.key,
        addon_quantity: 1,
        amount_fcfa: 0,
        provider: "manual",
        provider_reference: `demo-seed-${paymentId}`,
        status: "completed",
      });
      await confirmAddonPurchase({ id: paymentId, organizationId, addonKey: anyAddon.key, addonQuantity: 1 });
      console.log(`[seed] Abonnement "business" actif + add-on "${anyAddon.key}" activé.`);
    } else {
      console.log('[seed] Abonnement "business" actif (aucun add-on actif trouvé à activer).');
    }
  } else {
    console.log("[seed] Abonnement business déjà actif — pas de duplication.");
  }

  // -------------------------------------------------------------------
  // 11. Landing configurée avec le preset "boutique" (Lot K) + témoignages
  // -------------------------------------------------------------------
  const { data: existingLanding } = await supabase
    .from("organization_landing_config")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!existingLanding) {
    await updateLandingConfig(organizationId, {
      sections: LANDING_PRESETS.boutique.map((type, order) => ({ type, enabled: true, order, config: {} })),
      brandColorPrimary: "#8B5E3C",
      brandColorSecondary: "#F5E6D3",
      fontChoice: "classic",
    });

    await createTestimonial({ organizationId, authorName: "Sandrine A.", content: "Un service impeccable et des tenues magnifiques !", rating: 5 });
    await createTestimonial({ organizationId, authorName: "Michel T.", content: "La retouche sur mesure a été parfaite, je recommande.", rating: 5 });
    console.log('[seed] Landing configurée (preset "boutique") + témoignages.');
  } else {
    console.log("[seed] Landing déjà configurée — pas de duplication.");
  }

  console.log("\n[seed] Terminé. Organisation de démo :");
  console.log(`  - Slug         : ${DEMO_SLUG}`);
  console.log(`  - Connexion    : ${DEMO_OWNER_EMAIL} / ${DEMO_OWNER_PASSWORD}`);
  console.log(`  - Site public  : http://${DEMO_SLUG}.localhost:3000 (ou sous-domaine configuré)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] Échec :", err);
    process.exit(1);
  });
