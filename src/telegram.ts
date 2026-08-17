import fetch from 'node-fetch';

const DEFAULT_CHAT_ID = '8064453537';

export async function sendTelegramMessage(text: string, chatId: string = DEFAULT_CHAT_ID): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN not set, skipping notification. Message was:', text);
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (err) {
    console.error('Failed to send Telegram message:', err);
  }
}
