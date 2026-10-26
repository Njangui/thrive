/**
 * C3 — contraintes et RLS réelles de 0144_c3_comment_assistant.sql contre une vraie instance
 * Supabase. Mêmes garde-fous que tenant-isolation.test.ts : projet de TEST dédié, jamais
 * production ; sans les 3 variables SUPABASE_TEST_*, tout est sauté.
 *
 * Vérifie ce que les tests unitaires (qui simulent la base) ne peuvent pas :
 *  - valeurs par défaut : seuls « produit de la publication » et « invitation en message privé »
 *    sont actifs d'office ; lead, masquage, accusé aux plaintes, remerciements sont désactivés ;
 *  - état de modération borné ; liens produit / lead qui se détachent (SET NULL) sans supprimer le commentaire ;
 *  - index unique des contacts issus des réseaux (un commentateur = une fiche par entreprise) ;
 *  - RLS : un client anonyme ne voit rien ; cascade avec l'organisation.
 * Les politiques « propriétaire/administrateur » nécessitent des sessions par rôle.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL_ = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SERVICE = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const hasCredentials = Boolean(URL_ && ANON && SERVICE);
const pointsAtAppEnv = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.NEXT_PUBLIC_SUPABASE_URL === URL_;
const canRun = hasCredentials && !pointsAtAppEnv;
if (hasCredentials && pointsAtAppEnv) {
  console.error("c3-comment-assistant.test.ts : SUPABASE_TEST_URL == NEXT_PUBLIC_SUPABASE_URL — suite SAUTÉE par sécurité (utilise un projet de test dédié).");
}

describe.skipIf(!canRun)("Assistant des commentaires (Supabase réel)", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let orgA = "";
  let orgB = "";
  let postId = "";
  let productId = "";
  let commentId = "";

  async function newOrg(label: string): Promise<string> {
    const { data, error } = await service.from("organizations").insert({ name: `C3 comments ${label}`, slug: `c3-comments-${label.toLowerCase()}-${Date.now()}`, is_demo: true }).select("id").single();
    if (error || !data) throw new Error(`Setup org ${label}: ${error?.message}`);
    return data.id as string;
  }

  beforeAll(async () => {
    service = createClient(URL_!, SERVICE!);
    anon = createClient(URL_!, ANON!);
    orgA = await newOrg("A");
    orgB = await newOrg("B");

    const { data: product, error: productError } = await service.from("products").insert({ organization_id: orgA, name: "Sac cuir", slug: `sac-${Date.now()}`, unit_price: 15000, status: "active" }).select("id").single();
    if (productError || !product) throw new Error(`Setup produit: ${productError?.message}`);
    productId = product.id as string;
    const { data: post, error: postError } = await service.from("social_posts").insert({ organization_id: orgA, product_id: productId, content: "Nouveau sac", provider_post_id: `post-${Date.now()}` }).select("id").single();
    if (postError || !post) throw new Error(`Setup publication: ${postError?.message}`);
    postId = post.id as string;
    const { data: comment, error: commentError } = await service
      .from("social_comments")
      .insert({ organization_id: orgA, social_post_id: postId, platform: "facebook", provider_account_id: "acc-1", external_comment_id: `ext-${Date.now()}`, content: "Quel est le prix ?" })
      .select("id")
      .single();
    if (commentError || !comment) throw new Error(`Setup commentaire: ${commentError?.message}`);
    commentId = comment.id as string;
  });

  afterAll(async () => {
    if (orgA) await service.from("organizations").delete().eq("id", orgA);
    if (orgB) await service.from("organizations").delete().eq("id", orgB);
  });

  it("réglages par défaut : utiles d'office, rien qui engage le commerçant ou crée une donnée personnelle", async () => {
    await service.from("comment_assistant_settings").insert({ organization_id: orgA });
    const { data } = await service.from("comment_assistant_settings").select("use_post_product, invite_to_dm, create_leads, hide_spam, complaint_public_ack, reply_to_praise").eq("organization_id", orgA).single();
    expect(data).toEqual({ use_post_product: true, invite_to_dm: true, create_leads: false, hide_spam: false, complaint_public_ack: false, reply_to_praise: false });
  });

  it("commentaire : modération « clean » par défaut, valeurs bornées", async () => {
    const { data } = await service.from("social_comments").select("moderation_status, product_id, lead_id").eq("id", commentId).single();
    expect(data).toEqual({ moderation_status: "clean", product_id: null, lead_id: null });
    expect((await service.from("social_comments").update({ moderation_status: "pirate" }).eq("id", commentId)).error).not.toBeNull();
    for (const status of ["spam_suspected", "spam", "spam_hidden"]) {
      expect((await service.from("social_comments").update({ moderation_status: status }).eq("id", commentId)).error).toBeNull();
    }
  });

  it("supprimer le produit ou le prospect détache le lien SANS supprimer le commentaire", async () => {
    const { data: contact } = await service.from("contacts").insert({ organization_id: orgA, full_name: "Awa" }).select("id").single();
    const { data: lead } = await service.from("leads").insert({ organization_id: orgA, contact_id: contact!.id, source: "comment_facebook" }).select("id").single();
    await service.from("social_comments").update({ product_id: productId, lead_id: lead!.id }).eq("id", commentId);

    await service.from("leads").delete().eq("id", lead!.id);
    await service.from("products").delete().eq("id", productId);
    const { data } = await service.from("social_comments").select("product_id, lead_id").eq("id", commentId).single();
    expect(data).toEqual({ product_id: null, lead_id: null });
  });

  it("contacts réseaux sociaux : une seule fiche par commentateur et par entreprise", async () => {
    const row = (org: string, key: string) => ({ organization_id: org, full_name: "Awa", source_channel: "facebook_comment", metadata: { social_key: key } });
    expect((await service.from("contacts").insert(row(orgA, "facebook:acc-1:user-9"))).error).toBeNull();
    expect((await service.from("contacts").insert(row(orgA, "facebook:acc-1:user-9"))).error).not.toBeNull(); // doublon
    expect((await service.from("contacts").insert(row(orgB, "facebook:acc-1:user-9"))).error).toBeNull(); // autre entreprise : autorisé
    expect((await service.from("contacts").insert(row(orgA, "facebook:acc-1:user-10"))).error).toBeNull(); // autre commentateur : autorisé
  });

  it("les contacts sans clé sociale (saisie manuelle, WhatsApp) ne sont pas concernés par l'index", async () => {
    const a = await service.from("contacts").insert({ organization_id: orgA, full_name: "Manuel 1", metadata: {} });
    const b = await service.from("contacts").insert({ organization_id: orgA, full_name: "Manuel 2", metadata: {} });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
  });

  it("RLS : un client anonyme ne voit aucun réglage de commentaires", async () => {
    const { data } = await anon.from("comment_assistant_settings").select("*").eq("organization_id", orgA);
    expect(data ?? []).toEqual([]);
  });

  it("supprimer l'organisation supprime ses réglages (cascade)", async () => {
    const tmp = await newOrg("tmp");
    await service.from("comment_assistant_settings").insert({ organization_id: tmp });
    await service.from("organizations").delete().eq("id", tmp);
    expect((await service.from("comment_assistant_settings").select("organization_id").eq("organization_id", tmp)).data).toEqual([]);
  });
});
