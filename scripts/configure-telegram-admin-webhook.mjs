const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_BOT_WEBHOOK_SECRET;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

if (!token || !secret || !appUrl) {
  console.error("Configurez TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_WEBHOOK_SECRET et NEXT_PUBLIC_APP_URL.");
  process.exit(1);
}

const url = `${appUrl.replace(/\/$/, "")}/api/webhooks/telegram`;
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret,
    allowed_updates: ["message"],
  }),
});

const payload = await response.json();
if (!payload.ok) {
  console.error(`Telegram a refusé le webhook: ${payload.description ?? "erreur inconnue"}`);
  process.exit(1);
}

console.log(`Webhook Telegram plateforme configuré sur ${url}`);
