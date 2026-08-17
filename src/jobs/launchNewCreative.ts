import { getActiveAccounts, AccountConfig } from '../config';
import { findVideoFolder, listFilesInFolderSortedByNewest, directDownloadUrl } from '../googleDrive';
import {
  resolvePixelAndPage,
  createCampaign,
  createAdset,
  createAd,
  uploadVideoByUrl,
  waitForVideoReady,
  getVideoThumbnail,
  buildVideoCreativeBody,
  createAdCreative,
} from '../facebookCampaigns';
import { sendTelegramMessage } from '../telegram';

function buildCampaignName(label: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }).replace('/', '.');
  const timeStr = now.toTimeString().slice(0, 5);
  return `${dateStr} Новый крео ${timeStr} — ${label}`;
}

async function launchOnAccount(acc: AccountConfig, videoFileId: string, campaignNamePrefix: string) {
  const label = acc.label;
  const campaignName = buildCampaignName(label);

  const { pixelId, pixelWarning, pageId, pageWarning, destinationUrl } = await resolvePixelAndPage(
    acc.accountId,
    acc.preferredPixelId,
    acc.preferredPageId,
    acc.destinationUrl
  );
  if (pixelWarning) console.warn(`[${label}] ${pixelWarning}`);
  if (pageWarning) console.warn(`[${label}] ${pageWarning}`);
  if (!pageId) {
    console.error(`[${label}] No page available, aborting.`);
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nНе удалось запустить новый креатив: не найдена Страница.`);
    return false;
  }

  const campaignRes = await createCampaign(acc.accountId, campaignName, acc.dailyBudgetMinorUnits);
  if (!campaignRes.ok || campaignRes.body.error) {
    console.error(`[${label}] Campaign creation failed:`, campaignRes.body.error?.message || campaignRes.status);
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nОшибка создания кампании: ${campaignRes.body.error?.message || campaignRes.status}`);
    return false;
  }
  const campaignId = campaignRes.body.id;

  const adsetRes = await createAdset(acc.accountId, campaignId, `${campaignName} — Adset`, pixelId);
  if (!adsetRes.ok || adsetRes.body.error) {
    console.error(`[${label}] Adset creation failed:`, adsetRes.body.error?.message);
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nОшибка создания адсета: ${adsetRes.body.error?.message}`);
    return false;
  }
  const adsetId = adsetRes.body.id;

  const fileUrl = directDownloadUrl(videoFileId);
  const videoRes = await uploadVideoByUrl(acc.accountId, fileUrl, `${campaignName} — video`);
  if (!videoRes.id) {
    console.error(`[${label}] Video upload failed:`, videoRes.error?.message);
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nОшибка загрузки видео: ${videoRes.error?.message}`);
    return false;
  }
  const ready = await waitForVideoReady(videoRes.id);
  if (!ready) {
    console.error(`[${label}] Video ${videoRes.id} did not finish processing in time.`);
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nВидео не успело обработаться на стороне Facebook.`);
    return false;
  }
  const thumb = (await getVideoThumbnail(videoRes.id)) || '';
  const creativeBody = buildVideoCreativeBody(pageId, videoRes.id, thumb, destinationUrl, `${campaignName} — Creative`);

  const creativeRes = await createAdCreative(acc.accountId, creativeBody);
  if (!creativeRes.ok || creativeRes.body.error) {
    console.error(`[${label}] Creative creation failed:`, creativeRes.body.error?.message);
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nОшибка создания креатива: ${creativeRes.body.error?.message}`);
    return false;
  }

  const adRes = await createAd(acc.accountId, `${campaignName} — Ad`, adsetId, creativeRes.body.id);
  if (!adRes.ok || adRes.body.error) {
    console.error(`[${label}] Ad creation failed:`, adRes.body.error?.message);
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nОшибка создания объявления: ${adRes.body.error?.message}`);
    return false;
  }

  console.log(`[${label}] Success: campaign "${campaignName}" launched with new creative.`);
  return true;
}

async function main() {
  const folder = await findVideoFolder();
  if (!folder) {
    console.error('No video folder found.');
    await sendTelegramMessage('⚠️ Не найдена папка с видео.');
    return;
  }
  const files = await listFilesInFolderSortedByNewest(folder.id);
  if (files.length === 0) {
    console.error(`Video folder "${folder.name}" is empty.`);
    await sendTelegramMessage(`⚠️ Папка "${folder.name}" пуста.`);
    return;
  }
  const newest = files[0];
  console.log(`Launching newest creative "${newest.name}" (${newest.id}) on all active accounts...`);

  const accounts = getActiveAccounts();
  let successCount = 0;
  for (const acc of accounts) {
    try {
      const ok = await launchOnAccount(acc, newest.id, newest.name);
      if (ok) successCount++;
    } catch (err) {
      console.error(`[${acc.label}] Unexpected error:`, err);
      await sendTelegramMessage(`⚠️ <b>${acc.label}</b>\nНеожиданная ошибка: ${err}`);
    }
  }

  await sendTelegramMessage(
    `🆕 Новый креатив "${newest.name}" запущен на ${successCount} из ${accounts.length} активных аккаунтов.`
  );
  console.log(`Done: ${successCount}/${accounts.length} accounts launched.`);
}

main().catch(err => {
  console.error('Fatal error in launch-new-creative job:', err);
  process.exit(1);
});
