import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentReceivedEvent, ExternalPostTrackedEvent } from "@/domain/events/domain-events";

/**
 * social-post-tracking-service.ts n'avait AUCUN test avant ce lot, alors que c'est le module qui
 * ferme la demande « synchronisation automatique des commentaires + notification push et in-app » :
 * `trackExternalPost` (détection d'un post publié hors flexco ) et surtout `handleIncomingComment`
 * (stockage + `notifyOrgAdmins`, qui couvre in-app ET push — voir notification-service.test.ts /
 * push-service.test.ts pour ce canal lui-même). Ici on verrouille le CÂBLAGE : que la notification
 * parte bien à chaque nouveau commentaire, jamais deux fois pour le même, et jamais pour le
 * commerçant lui-même.
 */

const state = vi.hoisted(() => ({
  posts: new Map<string, { id: string }>(), // clé "org:providerPostId"
  targets: new Map<string, { platform: string }>(), // clé "postId:providerAccountId"
  commentKeys: new Set<string>(), // clé "postId:providerAccountId:externalCommentId" déjà connue
  nextPostId: 1,
  nextCommentId: 1,
  insertPostErrorOnce: null as { code: string; message: string } | null,
  insertTargetError: null as { message: string } | null,
  upsertCommentError: null as { message: string } | null,
  insertedComments: [] as Array<Record<string, unknown>>,
  notify: vi.fn(),
  ownAccount: null as { accountId: string; username: string | null } | null,
  isOwnResult: false,
}));

function reset() {
  state.posts.clear();
  state.targets.clear();
  state.commentKeys.clear();
  state.nextPostId = 1;
  state.nextCommentId = 1;
  state.insertPostErrorOnce = null;
  state.insertTargetError = null;
  state.upsertCommentError = null;
  state.insertedComments = [];
  state.ownAccount = null;
  state.isOwnResult = false;
  state.notify.mockReset();
  state.notify.mockResolvedValue(undefined);
}

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        insert: (row: Record<string, unknown>) => {
          if (table === "social_posts") {
            if (state.insertPostErrorOnce) {
              const err = state.insertPostErrorOnce;
              state.insertPostErrorOnce = null;
              // Simule la course : au moment où NOTRE insertion échoue (23505), celle du worker concurrent a déjà
              // été validée — la ligne existe donc désormais pour la relecture qui suit (voir le code source).
              state.posts.set(`${row.organization_id}:${row.provider_post_id}`, { id: "post-du-concurrent" });
              return { select: () => ({ single: () => Promise.resolve({ data: null, error: err }) }) };
            }
            const id = `post-${state.nextPostId++}`;
            state.posts.set(`${row.organization_id}:${row.provider_post_id}`, { id });
            return { select: () => ({ single: () => Promise.resolve({ data: { id }, error: null }) }) };
          }
          if (table === "social_post_targets") {
            if (state.insertTargetError) return Promise.resolve({ error: state.insertTargetError });
            state.targets.set(`${row.post_id}:${row.provider_account_id}`, { platform: row.platform as string });
            return Promise.resolve({ error: null });
          }
          throw new Error(`insert non mocké pour la table ${table}`);
        },
        upsert: (row: Record<string, unknown>) => {
          const key = `${row.social_post_id}:${row.provider_account_id}:${row.external_comment_id}`;
          const term = {
            maybeSingle: () => {
              if (state.upsertCommentError) return Promise.resolve({ data: null, error: state.upsertCommentError });
              if (state.commentKeys.has(key)) return Promise.resolve({ data: null, error: null }); // conflit ignoré, aucune ligne renvoyée
              state.commentKeys.add(key);
              state.insertedComments.push(row);
              const id = `comment-${state.nextCommentId++}`;
              return Promise.resolve({ data: { id }, error: null });
            },
          };
          return { select: () => term };
        },
        maybeSingle: () => {
          if (table === "social_posts") {
            return Promise.resolve({ data: state.posts.get(`${filters.organization_id}:${filters.provider_post_id}`) ?? null, error: null });
          }
          if (table === "social_post_targets") {
            return Promise.resolve({ data: state.targets.get(`${filters.post_id}:${filters.provider_account_id}`) ?? null, error: null });
          }
          throw new Error(`select non mocké pour la table ${table}`);
        },
      };
      return builder;
    },
  }),
}));
vi.mock("./notification-service", () => ({ notifyOrgAdmins: state.notify }));
vi.mock("./comment-auto-reply-service", () => ({ isOwnComment: () => state.isOwnResult }));
vi.mock("./social-account-registry-service", () => ({ getSocialAccountByAccountId: async () => state.ownAccount }));

import { handleIncomingComment, trackExternalPost } from "./social-post-tracking-service";

beforeEach(reset);

function commentEvent(overrides: Partial<CommentReceivedEvent["payload"]> = {}): CommentReceivedEvent {
  return {
    type: "COMMENT_RECEIVED",
    organizationId: "org-1",
    occurredAt: "2026-09-21T10:00:00.000Z",
    externalEventId: "evt-1",
    sourceProvider: "zernio",
    payload: {
      providerPostId: "post-ext-1",
      providerAccountId: "acc-1",
      platform: "instagram",
      externalCommentId: "cmt-1",
      authorName: "Awa Ndiaye",
      authorExternalId: "user-999",
      content: "Vous avez encore ce modèle en stock ?",
      ...overrides,
    },
  };
}
function externalPostEvent(overrides: Partial<ExternalPostTrackedEvent["payload"]> = {}): ExternalPostTrackedEvent {
  return {
    type: "EXTERNAL_POST_TRACKED",
    organizationId: "org-1",
    occurredAt: "2026-09-21T10:00:00.000Z",
    externalEventId: "evt-post-1",
    sourceProvider: "zernio",
    payload: { providerPostId: "post-ext-1", providerAccountId: "acc-1", platform: "instagram", deleted: false, ...overrides },
  };
}

describe("trackExternalPost — détection d'un post publié hors flexco ", () => {
  it("post jamais vu : crée la ligne social_posts (source=external) ET sa cible", async () => {
    await trackExternalPost(externalPostEvent());

    expect(state.posts.has("org-1:post-ext-1")).toBe(true);
    const postId = state.posts.get("org-1:post-ext-1")!.id;
    expect(state.targets.get(`${postId}:acc-1`)).toEqual({ platform: "instagram" });
  });

  it("post déjà tracké : idempotent, aucune nouvelle écriture", async () => {
    await trackExternalPost(externalPostEvent());
    const before = state.nextPostId;

    await trackExternalPost(externalPostEvent());

    expect(state.nextPostId).toBe(before); // aucune 2e insertion
  });

  it("post.external.deleted=true : la ligne locale n'est PAS effacée (jamais de suppression d'un post tracké)", async () => {
    await trackExternalPost(externalPostEvent({ deleted: true }));

    expect(state.posts.size).toBe(0); // rien créé non plus : deleted court-circuite avant tout accès DB
  });

  it("course concurrente (23505 à l'insertion) : relit la ligne créée entre-temps plutôt que d'abandonner le commentaire", async () => {
    state.insertPostErrorOnce = { code: "23505", message: "duplicate key" };

    await trackExternalPost(externalPostEvent());

    // La ligne "concurrente" (pas la nôtre) a bien été retrouvée par la relecture, et porte la cible.
    expect(state.posts.get("org-1:post-ext-1")).toEqual({ id: "post-du-concurrent" });
    expect(state.targets.get("post-du-concurrent:acc-1")).toEqual({ platform: "instagram" });
  });
});

describe("handleIncomingComment — synchronisation automatique + notification (in-app ET push)", () => {
  it("nouveau commentaire : stocké, PUIS notifyOrgAdmins appelé (in-app + push, voir notification-service.ts)", async () => {
    const result = await handleIncomingComment(commentEvent());

    expect(result).toEqual({ commentId: "comment-1" });
    expect(state.insertedComments).toHaveLength(1);
    expect(state.insertedComments[0]).toMatchObject({ author_name: "Awa Ndiaye", content: "Vous avez encore ce modèle en stock ?", is_own: false });
    expect(state.notify).toHaveBeenCalledTimes(1);
    expect(state.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        title: "Nouveau commentaire reçu.",
        body: 'Awa Ndiaye a commenté votre publication : « Vous avez encore ce modèle en stock ? »',
        relatedEntityType: "social_comment",
      }),
    );
    // Aucune priorité fixée ici -> notifyOrgAdmins retombe sur son défaut "important" (push urgence "high"),
    // jamais "normal" : un nouveau commentaire client ne doit pas être un push muet.
    expect(state.notify.mock.calls[0]?.[0]).not.toHaveProperty("priority");
  });

  it("sans nom d'auteur : le corps de la notification reste correct, sans « undefined »", async () => {
    await handleIncomingComment(commentEvent({ authorName: undefined }));

    expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({ body: 'Nouveau commentaire : « Vous avez encore ce modèle en stock ? »' }));
  });

  it("contenu long : tronqué à 120 caractères avec une ellipse, dans le corps de la notification", async () => {
    const long = "a".repeat(150);
    await handleIncomingComment(commentEvent({ content: long }));

    const body = (state.notify.mock.calls[0]?.[0] as { body: string } | undefined)?.body ?? "";
    expect(body).toContain(`${"a".repeat(120)}…`);
    expect(body).not.toContain("a".repeat(121));
  });

  it("post introuvable/non-créable (plateforme inconnue pour un post jamais vu) : commentaire ignoré, AUCUNE notification", async () => {
    const result = await handleIncomingComment(commentEvent({ platform: undefined, providerPostId: "post-inconnu" }));

    expect(result).toBeNull();
    expect(state.notify).not.toHaveBeenCalled();
  });

  it("commentaire déjà connu (webhook relivré) : ignoré silencieusement, JAMAIS notifié deux fois", async () => {
    const first = await handleIncomingComment(commentEvent());
    state.notify.mockClear();

    const second = await handleIncomingComment(commentEvent());

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(state.notify).not.toHaveBeenCalled();
    expect(state.insertedComments).toHaveLength(1);
  });

  it("échec d'écriture du commentaire (DB) : ne lève pas, aucune notification envoyée pour une ligne qui n'existe pas", async () => {
    state.upsertCommentError = { message: "connexion DB perdue" };

    const result = await handleIncomingComment(commentEvent());

    expect(result).toBeNull();
    expect(state.notify).not.toHaveBeenCalled();
  });

  describe("commentaire du commerçant lui-même (sa propre réponse relivrée par la plateforme)", () => {
    beforeEach(() => {
      state.ownAccount = { accountId: "acc-1", username: "ma_boutique" };
      state.isOwnResult = true;
    });

    it("stocké avec is_own=true, pour garder le fil cohérent, mais SANS notification (ni push ni in-app)", async () => {
      const result = await handleIncomingComment(commentEvent({ authorExternalId: "acc-1", authorName: "Ma Boutique" }));

      expect(result).toEqual({ commentId: "comment-1" });
      expect(state.insertedComments[0]).toMatchObject({ is_own: true });
      expect(state.notify).not.toHaveBeenCalled();
    });

    it("échoue à résoudre le compte (DB indisponible) : par défaut PAS \"own\" — on notifie plutôt que de risquer de faire taire un vrai client", async () => {
      state.ownAccount = null; // getSocialAccountByAccountId renvoie null

      await handleIncomingComment(commentEvent());

      expect(state.insertedComments[0]).toMatchObject({ is_own: false });
      expect(state.notify).toHaveBeenCalledTimes(1);
    });
  });

  it("notifyOrgAdmins échoue : n'est jamais propagé (best-effort, voir aussi notification-service.ts)", async () => {
    state.notify.mockRejectedValueOnce(new Error("réseau push indisponible"));

    await expect(handleIncomingComment(commentEvent({ externalCommentId: "cmt-echec" }))).resolves.toEqual({ commentId: "comment-1" });
  });
});
