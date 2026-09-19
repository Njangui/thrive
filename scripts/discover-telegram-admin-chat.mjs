const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Configurez TELEGRAM_BOT_TOKEN.");
  process.exit(1);
}

const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=50&allowed_updates=message`);
const payload = await response.json();
if (!payload.ok) {
  console.error(`Telegram a refusé getUpdates: ${payload.description ?? "erreur inconnue"}`);
  process.exit(1);
}

const chats = new Map();
for (const update of payload.result ?? []) {
  const message = update.message;
  if (!message?.chat) continue;
  chats.set(String(message.chat.id), {
    id: message.chat.id,
    type: message.chat.type,
    title: message.chat.title ?? null,
    username: message.chat.username ?? null,
    from: message.from?.username ?? message.from?.first_name ?? null,
  });
}

if (!chats.size) {
  console.log("Aucun chat trouvé. Envoyez /start au bot (ou un message dans le groupe), puis relancez ce script.");
  process.exit(0);
}

console.table([...chats.values()]);
console.log("Copiez l'id du chat voulu dans TELEGRAM_ADMIN_CHAT_ID.");
