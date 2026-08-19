import { getActiveAccounts, AccountConfig } from '../config';
import { nextMediaType } from '../mediaState';
import {
  findCandidateFolders,
  pickLatestFolder,
  listFilesInFolder,
  downloadFileBuffer,
  getMacbookVideoFile,
  DriveFile,
} from '../googleDrive';
import {
  resolvePixelAndPage,
  createCampaign,
  createAdset,
  createAd,
  uploadImage,
  uploadVideoByBuffer,
  waitForVideoReady,
  getVideoThumbnail,
  buildImageCreativeBody,
  buildTwoTierMultiLanguageVideoCreativeBody,
  resolveAdLocaleIds,
  createAdCreative,
} from '../facebookCampaigns';
import { sendTelegramMessage } from '../telegram';

// Languages used in the successful "18.07_TR запускЧерезЯзыкиИФинансы" campaign
const AD_LANGUAGES = ['Armenian', 'Malay', 'Filipino', 'German', 'Esperanto', 'Norwegian', 'Persian', 'Traditional Chinese (Taiwan)'];
const TURKISH_LANGUAGE = 'Turkish';
const AD_TITLE = 'MacBook Air с чипом M5';
const AD_BODY = 'Чип M5 — это не просто обновление. Это другой уровень скорости: повседневные задачи, монтаж, работа с ИИ — всё летает. До 18 часов автономной работы, чтобы вы закрывали крышку только когда сами захотите.\nНевероятно тонкий и лёгкий алюминиевый корпус. Яркий Liquid Retina дисплей. Камера Center Stage, которая всегда держит вас в кадре. 16 ГБ унифицированной памяти и 512 ГБ накопителя уже в базовой комплектации.';

const MIN_CREATIVES = 2;
const MAX_CREATIVES = 7;
const BROKEN_FILES = ['13111.mp4'];

function pickRandomFiles(files: DriveFile[]): DriveFile[] {
  const usableFiles = files.filter(f => !BROKEN_FILES.includes(f.name));
  const count = Math.min(usableFiles.length, MIN_CREATIVES + Math.floor(Math.random() * (MAX_CREATIVES - MIN_CREATIVES + 1)));
  const shuffled = [...usableFiles].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function buildCampaignName(scheme: string, label: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }).replace('/', '.');
  const timeStr = now.toTimeString().slice(0, 5);
  return `${dateStr} Авто ${scheme} ${timeStr} — ${label}`;
}

async function uploadVideoAndWait(accountId: string, file: DriveFile, label: string, tag: string): Promise<{ id: string; thumb: string } | null> {
  console.log(`[${label}] Downloading ${file.name} (${tag}) from Drive...`);
  const buffer = await downloadFileBuffer(file.id);
  console.log(`[${label}] Downloaded ${buffer.length} bytes, uploading to Facebook...`);
  const videoRes = await uploadVideoByBuffer(accountId, buffer, file.name, `${label} — ${tag}`);
  if (!videoRes.id) {
    console.error(`[${label}] Video upload failed for ${file.name} (${tag}):`, videoRes.error?.message);
    return null;
  }
  const ready = await waitForVideoReady(videoRes.id);
  if (!ready) {
    console.error(`[${label}] Video ${videoRes.id} (${tag}) did not finish processing in time.`);
    return null;
  }
  const thumb = (await getVideoThumbnail(videoRes.id)) || '';
  return { id: videoRes.id, thumb };
}

// Video path: fixed 1-5-1 structure. Every adset = MacBook video for 8 languages + that adset's own
// creative for Turkish. Uses ALL usable files found in the video folder (expected: 5).
async function processVideoAccount(
  acc: AccountConfig,
  otherLocaleIds: number[],
  turkishLocaleId: number | null
) {
  const label = acc.label;

  const macbookFile = await getMacbookVideoFile();
  if (!macbookFile) {
    console.error(`[${label}] No MacBook filler video found, skipping.`);
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nНе найдено видео MacBook в папке-филлере.`);
    return;
  }

  const { videoFolders } = await findCandidateFolders();
  const folder = pickLatestFolder(videoFolders);
  if (!folder) {
    console.log(`[${label}] No video folder found, skipping.`);
    return;
  }
  const files = await listFilesInFolder(folder.id);
  const usableFiles = files.filter(f => !BROKEN_FILES.includes(f.name));
  if (usableFiles.length === 0) {
    console.log(`[${label}] Video folder "${folder.name}" has no usable files, skipping.`);
    return;
  }

  const campaignName = buildCampaignName('1-5-1', label);
  console.log(`[${label}] video, folder="${folder.name}", ${usableFiles.length} creatives (all used), scheme=1-5-1`);

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
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nНе удалось запустить: не найдена Страница для рекламы.`);
    return;
  }

  const campaignRes = await createCampaign(acc.accountId, campaignName, acc.dailyBudgetMinorUnits);
  if (!campaignRes.ok || campaignRes.body.error) {
    console.error(`[${label}] Campaign creation failed:`, campaignRes.body.error || campaignRes.status);
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nОшибка создания кампании: ${campaignRes.body.error?.message || campaignRes.status}`);
    return;
  }
  const campaignId = campaignRes.body.id;

  // Upload the MacBook (shared) video once for this campaign
  const macbookUpload = await uploadVideoAndWait(acc.accountId, macbookFile, label, 'macbook (shared)');
  if (!macbookUpload) {
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nНе удалось загрузить видео MacBook.`);
    return;
  }

  let successCount = 0;

  for (let i = 0; i < usableFiles.length; i++) {
    const file = usableFiles[i];
    try {
      const adsetRes = await createAdset(acc.accountId, campaignId, `${campaignName} — Adset ${i + 1}`, pixelId);
      if (!adsetRes.ok || adsetRes.body.error) {
        console.error(`[${label}] Adset ${i + 1} creation failed:`, adsetRes.body.error?.message);
        continue;
      }
      const adsetId = adsetRes.body.id;

      const turkishUpload = await uploadVideoAndWait(acc.accountId, file, label, `turkish ${i + 1}`);
      if (!turkishUpload) continue;

      const creativeBody = buildTwoTierMultiLanguageVideoCreativeBody(
        pageId,
        macbookUpload,
        otherLocaleIds,
        turkishUpload,
        turkishLocaleId !== null ? [turkishLocaleId] : [],
        destinationUrl,
        AD_TITLE,
        AD_BODY,
        `${campaignName} — Creative ${i + 1}`
      );

      const creativeRes = await createAdCreative(acc.accountId, creativeBody);
      if (!creativeRes.ok || creativeRes.body.error) {
        console.error(`[${label}] Creative creation failed for ${file.name}:`, JSON.stringify(creativeRes.body.error));
        continue;
      }

      const adRes = await createAd(acc.accountId, `${campaignName} — Ad`, adsetId, creativeRes.body.id);
      if (!adRes.ok || adRes.body.error) {
        console.error(`[${label}] Ad creation failed for ${file.name}:`, adRes.body.error?.message);
        continue;
      }

      successCount++;
    } catch (err) {
      console.error(`[${label}] Unexpected error on creative ${i + 1}:`, err);
    }
  }

  console.log(`[${label}] Done: ${successCount}/${usableFiles.length} adsets created in campaign "${campaignName}"`);
  await sendTelegramMessage(
    `✅ <b>${campaignName}</b>\nАккаунт: ${label}\nУспешно: ${successCount} из ${usableFiles.length} (MacBook + свой турецкий креатив в каждом)`
  );
}

// Photo path: unchanged, simple single-language image ads, random 2-7 creatives.
async function processPhotoAccount(acc: AccountConfig) {
  const label = acc.label;

  const { photoFolders } = await findCandidateFolders();
  const folder = pickLatestFolder(photoFolders);
  if (!folder) {
    console.log(`[${label}] No photo folder found, skipping.`);
    return;
  }
  const files = await listFilesInFolder(folder.id);
  if (files.length === 0) {
    console.log(`[${label}] Folder "${folder.name}" has no files, skipping.`);
    return;
  }
  const picked = pickRandomFiles(files);
  const scheme = Math.random() < 0.5 ? '1-N-1' : '1-1-N';
  const campaignName = buildCampaignName(scheme, label);

  console.log(`[${label}] photo, folder="${folder.name}", ${picked.length} creatives, scheme=${scheme}`);

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
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nНе удалось запустить: не найдена Страница для рекламы.`);
    return;
  }

  const campaignRes = await createCampaign(acc.accountId, campaignName, acc.dailyBudgetMinorUnits);
  if (!campaignRes.ok || campaignRes.body.error) {
    console.error(`[${label}] Campaign creation failed:`, campaignRes.body.error || campaignRes.status);
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nОшибка создания кампании: ${campaignRes.body.error?.message || campaignRes.status}`);
    return;
  }
  const campaignId = campaignRes.body.id;

  let sharedAdsetId: string | null = null;
  let successCount = 0;

  for (let i = 0; i < picked.length; i++) {
    const file = picked[i];
    try {
      let adsetId: string;
      if (scheme === '1-N-1' || !sharedAdsetId) {
        const adsetRes = await createAdset(acc.accountId, campaignId, `${campaignName} — Adset ${i + 1}`, pixelId);
        if (!adsetRes.ok || adsetRes.body.error) {
          console.error(`[${label}] Adset ${i + 1} creation failed:`, adsetRes.body.error?.message);
          continue;
        }
        adsetId = adsetRes.body.id;
        if (scheme === '1-1-N') sharedAdsetId = adsetId;
      } else {
        adsetId = sharedAdsetId;
      }

      const buffer = await downloadFileBuffer(file.id);
      const imgRes = await uploadImage(acc.accountId, buffer, file.name);
      if (!imgRes.hash) {
        console.error(`[${label}] Image upload failed for ${file.name}:`, imgRes.error?.message);
        continue;
      }
      const creativeBody = buildImageCreativeBody(pageId, imgRes.hash, destinationUrl, `${campaignName} — Creative ${i + 1}`);

      const creativeRes = await createAdCreative(acc.accountId, creativeBody);
      if (!creativeRes.ok || creativeRes.body.error) {
        console.error(`[${label}] Creative creation failed for ${file.name}:`, JSON.stringify(creativeRes.body.error));
        continue;
      }

      const adRes = await createAd(acc.accountId, `${campaignName} — Ad`, adsetId, creativeRes.body.id);
      if (!adRes.ok || adRes.body.error) {
        console.error(`[${label}] Ad creation failed for ${file.name}:`, adRes.body.error?.message);
        continue;
      }

      successCount++;
    } catch (err) {
      console.error(`[${label}] Unexpected error on creative ${i + 1}:`, err);
    }
  }

  console.log(`[${label}] Done: ${successCount}/${picked.length} ads created in campaign "${campaignName}"`);
  await sendTelegramMessage(
    `✅ <b>${campaignName}</b>\nАккаунт: ${label}\nУспешно: ${successCount} из ${picked.length}`
  );
}

async function processAccount(acc: AccountConfig, otherLocaleIds: number[], turkishLocaleId: number | null) {
  const mediaType = await nextMediaType(acc.accountId);
  if (mediaType === 'video') {
    await processVideoAccount(acc, otherLocaleIds, turkishLocaleId);
  } else {
    await processPhotoAccount(acc);
  }
}

async function main() {
  if (process.env.AUTO_LAUNCH_DISABLED === 'true') {
    console.log('AUTO_LAUNCH_DISABLED is set — skipping this run.');
    return;
  }

  console.log('Resolving ad locale IDs for multi-language ads...');
  const resolvedOthers = await resolveAdLocaleIds(AD_LANGUAGES);
  const resolvedTurkish = await resolveAdLocaleIds([TURKISH_LANGUAGE]);

  const missing = resolvedOthers.filter(r => r.id === null).map(r => r.name);
  if (missing.length > 0) {
    console.warn('Could not resolve locale IDs for:', missing.join(', '));
    await sendTelegramMessage(`⚠️ Не удалось найти ID локали для: ${missing.join(', ')}`);
  }
  const otherLocaleIds = resolvedOthers.filter(r => r.id !== null).map(r => r.id as number);
  const turkishLocaleId = resolvedTurkish[0]?.id ?? null;
  if (turkishLocaleId === null) {
    console.warn('Could not resolve Turkish locale ID!');
    await sendTelegramMessage('⚠️ Не удалось найти ID турецкой локали.');
  }
  console.log(`Resolved ${otherLocaleIds.length}/${AD_LANGUAGES.length} other locale IDs, Turkish=${turkishLocaleId}.`);

  const accounts = getActiveAccounts();
  const testAccounts = process.env.TEST_SINGLE_ACCOUNT === 'true' ? accounts.slice(0, 1) : accounts;
  console.log(`Starting auto-launch run for ${testAccounts.length} active accounts...`);
  for (const acc of testAccounts) {
    try {
      await processAccount(acc, otherLocaleIds, turkishLocaleId);
    } catch (err) {
      console.error(`Account ${acc.label} (${acc.accountId}) failed entirely:`, err);
      await sendTelegramMessage(`⚠️ <b>${acc.label}</b>\nЗапуск полностью упал: ${err}`);
    }
  }
  console.log('Auto-launch run complete.');
}

main().catch(err => {
  console.error('Fatal error in auto-launch job:', err);
  process.exit(1);
});
