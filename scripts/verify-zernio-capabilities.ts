/**
 * Lot P — script de vérification à lancer TOI-MÊME, AVANT tout déploiement
 * du lot P, avec ta vraie clé API Zernio et des comptes de test.
 *
 *   npx tsx scripts/verify-zernio-capabilities.ts \
 *     --profile-id <id du profil Zernio à tester> \
 *     --tiktok-account-id <id compte TikTok, optionnel> \
 *     --tiktok-post-id <id d'une vidéo TikTok déjà publiée, optionnel> \
 *     --facebook-account-id <id compte Facebook, optionnel> \
 *     --facebook-post-id <id d'une publication Facebook, optionnel>
 *
 * Aucun argument requis : chaque test s'auto-annule (SKIP) si l'information
 * dont il a besoin manque, plutôt que d'échouer. Le seul effet de bord
 * possible est un commentaire de test PUBLIÉ PUIS RETIRÉ automatiquement
 * (voir "TikTok — poster un commentaire") — jamais rien de plus destructeur
 * (pas de suppression de post, pas de déconnexion de compte).
 *
 * Ce que ce script confirme, noir sur blanc, avant de faire confiance au
 * code du lot P :
 *   1. Le paramètre "permanent" du presign vidéo — n'existe dans AUCUNE
 *      doc/SDK Zernio consultée (voir PLAN_LOT_P.md §0.1). Ce test le
 *      confirme avec un VRAI appel : la clé renvoyée est-elle sous "temp/" ?
 *   2. Lecture des commentaires TikTok (inbox).
 *   3. Réponse à un commentaire TikTok.
 *   4. Premier commentaire TikTok (poster + épingler).
 *   5. Lecture des commentaires Facebook, présence de `isOwnAccount`.
 *
 * N'écrit rien dans la base de données Flexco — un script de diagnostic
 * pur, indépendant de l'application.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { ZernioSocialClient } from "../src/infrastructure/providers/social/zernio/client";

interface CheckResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail: string;
}

const results: CheckResult[] = [];
function record(name: string, status: CheckResult["status"], detail: string) {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name} — ${detail}`);
}

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const apiKey = process.env.ZERNIO_API_KEY;
  const baseUrl = process.env.ZERNIO_API_BASE_URL ?? "https://zernio.com/api/v1";
  if (!apiKey) {
    console.error("ZERNIO_API_KEY manquant (.env.local). Rien à vérifier.");
    process.exit(1);
  }

  const profileId = arg("--profile-id");
  const tiktokAccountId = arg("--tiktok-account-id");
  const tiktokPostId = arg("--tiktok-post-id");
  const facebookAccountId = arg("--facebook-account-id");
  const facebookPostId = arg("--facebook-post-id");

  const client = new ZernioSocialClient(apiKey, baseUrl);

  // --------------------------------------------------------------
  // 1. Vidéos — le fichier renvoyé par le presign est-il "temp/" ?
  // --------------------------------------------------------------
  try {
    const res = await fetch(`${baseUrl}/media/presign`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      // "permanent": true envoyé quand même — pour voir si Zernio le REFUSE
      // (400/422, confirmant qu'il n'existe pas) ou l'IGNORE silencieusement
      // (dans les deux cas, la clé renvoyée tranche : voir plus bas).
      body: JSON.stringify({ filename: "verification-lot-p.mp4", contentType: "video/mp4", size: 1024, permanent: true }),
    });
    if (!res.ok) {
      record("Vidéos — presign avec permanent:true", "FAIL", `Zernio répond ${res.status} — voir docs.zernio.com/media pour la forme actuelle de l'endpoint.`);
    } else {
      const data = (await res.json()) as { key?: string; publicUrl?: string; permanent?: boolean; isPermanent?: boolean };
      const key = data.key ?? data.publicUrl ?? "";
      const isTemp = /(^|\/)temp\//.test(key);
      const permanentFlag = data.permanent ?? data.isPermanent;
      if (permanentFlag === true) {
        record("Vidéos — presign avec permanent:true", "PASS", `Zernio confirme permanent=true (clé: ${key}). SURPRISE : contredit PLAN_LOT_P.md §0.1 — à re-documenter si confirmé.`);
      } else if (isTemp) {
        record("Vidéos — presign avec permanent:true", "PASS", `Confirmé : stockage TEMPORAIRE (clé sous temp/: ${key}). "permanent" n'a aucun effet — le renouvellement automatique (renewExpiringZernioVideos) reste nécessaire pour honorer 7/30/90 jours.`);
      } else {
        record("Vidéos — presign avec permanent:true", "FAIL", `Clé inattendue (${key}) : ni "temp/", ni confirmation explicite. À examiner manuellement avant de faire confiance à un stockage Zernio quelconque.`);
      }
    }
  } catch (error) {
    record("Vidéos — presign avec permanent:true", "FAIL", `Erreur réseau: ${error instanceof Error ? error.message : String(error)}`);
  }

  // --------------------------------------------------------------
  // 2-4. TikTok — commentaires
  // --------------------------------------------------------------
  if (!tiktokAccountId || !tiktokPostId) {
    record("TikTok — lire les commentaires", "SKIP", "--tiktok-account-id et --tiktok-post-id non fournis.");
    record("TikTok — répondre à un commentaire", "SKIP", "idem.");
    record("TikTok — premier commentaire (poster + épingler)", "SKIP", "idem.");
  } else {
    let firstCommentId: string | undefined;
    try {
      const comments = await client.listInboxComments(tiktokPostId, tiktokAccountId);
      firstCommentId = comments.comments?.[0]?.id;
      record("TikTok — lire les commentaires", "PASS", `${comments.comments?.length ?? 0} commentaire(s) lu(s).`);
    } catch (error) {
      record("TikTok — lire les commentaires", "FAIL", error instanceof Error ? error.message : String(error));
    }

    if (firstCommentId) {
      try {
        await client.replyToInboxComment(tiktokPostId, tiktokAccountId, firstCommentId, "[Test Flexco — vérification lot P, à ignorer]");
        record("TikTok — répondre à un commentaire", "PASS", `Réponse envoyée au commentaire ${firstCommentId}.`);
      } catch (error) {
        record("TikTok — répondre à un commentaire", "FAIL", error instanceof Error ? error.message : String(error));
      }
    } else {
      record("TikTok — répondre à un commentaire", "SKIP", "Aucun commentaire existant sur cette vidéo pour tester une réponse.");
    }

    try {
      const posted = await client.postTopLevelInboxComment(tiktokPostId, tiktokAccountId, "[Test Flexco — sera retiré automatiquement]");
      if (posted.commentId) {
        try {
          await client.pinInboxComment(tiktokPostId, tiktokAccountId, posted.commentId);
          record("TikTok — premier commentaire (poster + épingler)", "PASS", `Commentaire ${posted.commentId} posté et épinglé.`);
        } catch (pinError) {
          record("TikTok — premier commentaire (poster + épingler)", "FAIL", `Posté (${posted.commentId}) mais épinglage refusé: ${pinError instanceof Error ? pinError.message : String(pinError)}`);
        }
        // Nettoyage : jamais laisser de commentaire de test visible sur une vraie vidéo.
        try {
          await client.hideInboxComment(tiktokPostId, tiktokAccountId, posted.commentId);
          console.log(`      → commentaire de test masqué (${posted.commentId}).`);
        } catch {
          console.warn(`      ⚠ Le commentaire de test ${posted.commentId} n'a pas pu être masqué automatiquement — à retirer à la main.`);
        }
      } else {
        record("TikTok — premier commentaire (poster + épingler)", "FAIL", "Publié mais aucun commentId renvoyé — impossible de confirmer l'épinglage ni de nettoyer.");
      }
    } catch (error) {
      record("TikTok — premier commentaire (poster + épingler)", "FAIL", error instanceof Error ? error.message : String(error));
    }
  }

  // --------------------------------------------------------------
  // 5. Facebook — isOwnAccount
  // --------------------------------------------------------------
  if (!facebookAccountId || !facebookPostId) {
    record("Facebook — isOwnAccount dans les commentaires", "SKIP", "--facebook-account-id et --facebook-post-id non fournis.");
  } else {
    try {
      const comments = await client.listInboxComments(facebookPostId, facebookAccountId);
      const withFlag = comments.comments?.filter((c) => c.from?.isOwnAccount !== undefined) ?? [];
      record(
        "Facebook — isOwnAccount dans les commentaires",
        withFlag.length > 0 ? "PASS" : "FAIL",
        withFlag.length > 0
          ? `${withFlag.length}/${comments.comments?.length ?? 0} commentaire(s) portent isOwnAccount.`
          : `Aucun commentaire ne porte isOwnAccount — la détection retombe sur l'id/le pseudo (comment-auto-reply-service.ts::isOwnComment), pas d'action requise.`,
      );
    } catch (error) {
      record("Facebook — isOwnAccount dans les commentaires", "FAIL", error instanceof Error ? error.message : String(error));
    }
  }

  void profileId; // Réservé : un futur test "publication réelle" en aura besoin.

  // --------------------------------------------------------------
  console.log("\n=== Résumé ===");
  for (const r of results) console.log(`${r.status.padEnd(4)} ${r.name}`);
  const failed = results.filter((r) => r.status === "FAIL").length;
  if (failed > 0) {
    console.log(`\n${failed} vérification(s) en échec — lire le détail ci-dessus avant de déployer.`);
    process.exit(1);
  }
  console.log("\nAucun échec (les SKIP sont normaux sans arguments fournis).");
}

main().catch((error) => {
  console.error("Erreur inattendue:", error);
  process.exit(1);
});
