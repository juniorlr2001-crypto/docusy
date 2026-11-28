import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';

async function resolveChatId(botToken: string, configuredChatId?: string): Promise<string | null> {
  if (configuredChatId && configuredChatId.trim()) {
    return configuredChatId.trim();
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=10`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const updates: any[] = Array.isArray(data?.result) ? data.result : [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i];
      const chatId =
        u?.message?.chat?.id ||
        u?.edited_message?.chat?.id ||
        u?.channel_post?.chat?.id ||
        u?.my_chat_member?.chat?.id;
      if (chatId) return String(chatId);
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Sends the clean, watermark-free 1080x1920 `short_9x16.mp4` + ready-to-paste TikTok/Reels copy
 * straight to the owner's private Telegram chat at $0 cost.
 */
export async function sendShortPackageToTelegram(params: {
  shortVideoPath: string;
  channelLabel: string;
  youtubeTitle: string;
  shortTitle: string;
  pinnedComment: string;
  hashtags: string[];
  youtubeDocuUrl?: string;
  youtubeShortUrl?: string;
}): Promise<boolean> {
  const botToken = CONFIG.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return false;
  }

  if (!fs.existsSync(params.shortVideoPath)) {
    console.warn('[Telegram] ⚠️ No se encontró short_9x16.mp4 para enviar a Telegram.');
    return false;
  }

  const chatId = await resolveChatId(botToken, CONFIG.TELEGRAM_CHAT_ID);
  if (!chatId) {
    console.warn(
      '[Telegram] ⚠️ Falta TELEGRAM_CHAT_ID y el bot aún no tiene mensajes recientes. Envía "hola" a tu bot en Telegram.'
    );
    return false;
  }

  try {
    const cleanSocialTitle = params.shortTitle
      .replace(/\s*#shorts\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const socialTags = Array.from(
      new Set([
        ...params.hashtags.filter(h => !/^#shorts$/i.test(h)),
        '#fyp',
        '#parati',
        '#reels',
      ])
    )
      .slice(0, 6)
      .join(' ');

    const lines = [
      `📲 ${params.channelLabel} — LISTO PARA TIKTOK / REELS`,
      '',
      '📝 TÍTULO COPIAR Y PEGAR:',
      `${cleanSocialTitle} ${socialTags}`,
      '',
      '💬 PRIMER COMENTARIO (DEBATE):',
      params.pinnedComment.slice(0, 280),
    ];

    if (params.youtubeDocuUrl) {
      lines.push('', `🎬 16:9 YT: ${params.youtubeDocuUrl}`);
    }
    if (params.youtubeShortUrl) {
      lines.push(`📱 Short YT: ${params.youtubeShortUrl}`);
    }

    const caption = lines.join('\n').slice(0, 1015);
    const videoBuf = fs.readFileSync(params.shortVideoPath);
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    form.append('supports_streaming', 'true');
    form.append(
      'video',
      new Blob([videoBuf], { type: 'video/mp4' }),
      `${path.basename(path.dirname(params.shortVideoPath))}_1080p.mp4`
    );

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendVideo`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      console.warn(`[Telegram] ⚠️ Error HTTP ${res.status}: ${errTxt.slice(0, 180)}`);
      return false;
    }

    console.log(`[Telegram] ✅ Short 1080p + textos para TikTok/Reels enviados a Telegram (chat ${chatId}).`);
    return true;
  } catch (err: any) {
    console.warn(`[Telegram] ⚠️ Falló envío a Telegram: ${err?.message || err}`);
    return false;
  }
}
