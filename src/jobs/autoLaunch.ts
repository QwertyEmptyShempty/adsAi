import { getActiveAccounts, AccountConfig } from '../config';
import { nextMediaType, nextScheme, getCachedVideo, setCachedVideo, getCachedImage, setCachedImage, acquireRunLock, releaseRunLock } from '../mediaState';
import {
  findCandidateFolders,
  pickLatestFolder,
  listFilesInFolder,
  downloadFileBuffer,
  getMacbookVideoFile,
  getMacbookPhotoFile,
  DriveFile,
} from '../googleDrive';
import {
  resolvePixelAndPage,
  getOrCreatePageBackedInstagramAccount,
  createCampaign,
  createAdset,
  createAd,
  uploadImage,
  uploadVideoByBuffer,
  waitForVideoReady,
  getVideoThumbnail,
  buildTwoTierMultiLanguageImageCreativeBody,
  buildTwoTierMultiLanguageVideoCreativeBody,
  resolveAdLocaleIds,
  createAdCreative,
} from '../facebookCampaigns';
import { sendTelegramMessage } from '../telegram';

// Languages used in the successful "18.07_TR запускЧерезЯзыкиИФинансы" campaign (video)
const AD_LANGUAGES = ['Armenian', 'Malay', 'Filipino', 'German', 'Esperanto', 'Norwegian', 'Persian', 'Traditional Chinese (Taiwan)'];
const TURKISH_LANGUAGE = 'Turkish';
const AD_TITLE = 'MacBook Air с чипом M5';
const AD_BODY = 'Чип M5 — это не просто обновление. Это другой уровень скорости: повседневные задачи, монтаж, работа с ИИ — всё летает. До 18 часов автономной работы, чтобы вы закрывали крышку только когда сами захотите.\nНевероятно тонкий и лёгкий алюминиевый корпус. Яркий Liquid Retina дисплей. Камера Center Stage, которая всегда держит вас в кадре. 16 ГБ унифицированной памяти и 512 ГБ накопителя уже в базовой комплектации.';

// Languages used in the "21.07_TR ЗапускФотокСЯзыкамиИФинансами" campaign (photo)
// Note: native-name candidates below (not yet fully verified via /search?type=adlocale like the video set was) --
// resolveAdLocaleId gracefully returns null for anything that doesn't match, so an unresolved language is
// just silently dropped from the ad rather than breaking the launch. Verify with ads-debug-locales before relying on all 9.
const PHOTO_AD_LANGUAGES = ['Gaeilge', 'नेपाली', 'Esperanto', 'Bahasa Melayu', 'Čeština', 'Kiswahili', 'Српски', 'Hrvatski', 'मराठी'];
const PHOTO_TURKISH_LANGUAGE = 'Türkçe';
const PHOTO_AD_TITLE = 'Продаю свой MacBook';
const PHOTO_AD_BODY = 'Брал для учёбы и работы, пользовался аккуратно, всё работает отлично. Никаких падений, царапин серьёзных нет, батарея держит нормально.\nПродаю, потому что перешёл на другой ноут, этот просто лежит без дела. Жалко, но пусть лучше кому-то пригодится.\nЦена адекватная, торг небольшой возможен.\nПишите в личку, если интересно — расскажу подробнее, скину фото и видео.';
const PHOTO_TURKISH_TITLE = 'Merhaba Dostum';
const PHOTO_TURKISH_BODY = 'Merhaba Meryem';

const MIN_PHOTO_CREATIVES = 2;
const MAX_PHOTO_CREATIVES = 10;
const BROKEN_FILES = ['13111.mp4'];

function buildCampaignName(scheme: string, label: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }).replace('/', '.');
  const timeStr = now.toTimeString().slice(0, 5);
  return `${dateStr} Авто ${scheme} ${timeStr} — ${label}`;
}

// Runs `worker` over `items` with at most `concurrency` running at once, instead of one at a time.
async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  async function runNext(): Promise<void> {
    const i = nextIndex++;
    if (i >= items.length) return;
    await worker(items[i], i);
    await runNext();
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runNext());
  await Promise.all(runners);
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

  const scheme = await nextScheme(acc.accountId);
  const campaignName = buildCampaignName(scheme, label);
  console.log(`[${label}] video, folder="${folder.name}", ${usableFiles.length} creatives (all used), scheme=${scheme}`);

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

  const instagramUserId = await getOrCreatePageBackedInstagramAccount(pageId);
  if (!instagramUserId) {
    console.warn(`[${label}] No Instagram (page-backed) account available.`);
  }

  const campaignRes = await createCampaign(acc.accountId, campaignName, acc.dailyBudgetMinorUnits);
  if (!campaignRes.ok || campaignRes.body.error) {
    console.error(`[${label}] Campaign creation failed:`, campaignRes.body.error || campaignRes.status);
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nОшибка создания кампании: ${campaignRes.body.error?.message || campaignRes.status}`);
    return;
  }
  const campaignId = campaignRes.body.id;

  // Upload the MacBook (shared) video once per account -- reuse cached video_id if we've
  // already uploaded this exact file for this account before (avoids redundant uploads).
  let macbookUpload = await getCachedVideo(acc.accountId, macbookFile.id);
  if (macbookUpload) {
    console.log(`[${label}] Reusing cached MacBook video (${macbookUpload.id}).`);
  } else {
    macbookUpload = await uploadVideoAndWait(acc.accountId, macbookFile, label, 'macbook (shared)');
    if (!macbookUpload) {
      await sendTelegramMessage(`⚠️ <b>${label}</b>\nНе удалось загрузить видео MacBook.`);
      return;
    }
    await setCachedVideo(acc.accountId, macbookFile.id, macbookUpload);
  }

  // 1-1-5: one shared adset for all 5 ads. 1-5-1: each file gets its own adset (created inside the loop below).
  let sharedAdsetId: string | null = null;
  if (scheme === '1-1-5') {
    const adsetRes = await createAdset(acc.accountId, campaignId, `${campaignName} — Adset`, pixelId);
    if (!adsetRes.ok || adsetRes.body.error) {
      console.error(`[${label}] Shared adset creation failed:`, adsetRes.body.error?.message);
      await sendTelegramMessage(`⚠️ <b>${label}</b>\nОшибка создания адсета: ${adsetRes.body.error?.message}`);
      return;
    }
    sharedAdsetId = adsetRes.body.id;
  }

  let successCount = 0;

  await runWithConcurrency(usableFiles, 3, async (file, i) => {
    try {
      let adsetId: string;
      if (scheme === '1-1-5') {
        adsetId = sharedAdsetId!;
      } else {
        const adsetRes = await createAdset(acc.accountId, campaignId, `${campaignName} — Adset ${i + 1}`, pixelId);
        if (!adsetRes.ok || adsetRes.body.error) {
          console.error(`[${label}] Adset ${i + 1} creation failed:`, adsetRes.body.error?.message);
          return;
        }
        adsetId = adsetRes.body.id;
      }

      let turkishUpload = await getCachedVideo(acc.accountId, file.id);
      if (turkishUpload) {
        console.log(`[${label}] Reusing cached video for ${file.name} (${turkishUpload.id}).`);
      } else {
        turkishUpload = await uploadVideoAndWait(acc.accountId, file, label, `turkish ${i + 1}`);
        if (!turkishUpload) return;
        await setCachedVideo(acc.accountId, file.id, turkishUpload);
      }

      const creativeBody = buildTwoTierMultiLanguageVideoCreativeBody(
        pageId,
        macbookUpload!,
        otherLocaleIds,
        turkishUpload,
        turkishLocaleId !== null ? [turkishLocaleId] : [],
        destinationUrl,
        AD_TITLE,
        AD_BODY,
        `${campaignName} — Creative ${i + 1}`,
        instagramUserId
      );

      const creativeRes = await createAdCreative(acc.accountId, creativeBody);
      if (!creativeRes.ok || creativeRes.body.error) {
        console.error(`[${label}] Creative creation failed for ${file.name}:`, JSON.stringify(creativeRes.body.error));
        return;
      }

      const adRes = await createAd(acc.accountId, `${campaignName} — Ad ${i + 1}`, adsetId, creativeRes.body.id);
      if (!adRes.ok || adRes.body.error) {
        console.error(`[${label}] Ad creation failed for ${file.name}:`, JSON.stringify(adRes.body.error));
        return;
      }

      successCount++;
    } catch (err) {
      console.error(`[${label}] Unexpected error on creative ${i + 1}:`, err);
    }
  });

  console.log(`[${label}] Done: ${successCount}/${usableFiles.length} ads created in campaign "${campaignName}" (scheme ${scheme})`);
  await sendTelegramMessage(
    `✅ <b>${campaignName}</b>\nАккаунт: ${label}\nСхема: ${scheme}\nУспешно: ${successCount} из ${usableFiles.length} (MacBook + свой турецкий креатив в каждом)`
  );
}

// Photo path: unchanged, simple single-language image ads, random 2-7 creatives.
async function processPhotoAccount(acc: AccountConfig, photoOtherLocaleIds: number[], photoTurkishLocaleId: number | null) {
  const label = acc.label;

  const macbookPhotoFile = await getMacbookPhotoFile();
  if (!macbookPhotoFile) {
    console.error(`[${label}] No MacBook filler photo found, skipping.`);
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nНе найдено фото MacBook в папке-филлере.`);
    return;
  }

  const { photoFolders } = await findCandidateFolders();
  const folder = pickLatestFolder(photoFolders);
  if (!folder) {
    console.log(`[${label}] No photo folder found, skipping.`);
    return;
  }
  const files = await listFilesInFolder(folder.id);
  const usableFiles = files.filter(f => !BROKEN_FILES.includes(f.name));
  if (usableFiles.length === 0) {
    console.log(`[${label}] Photo folder "${folder.name}" has no usable files, skipping.`);
    return;
  }

  // Random count (2-10) and random scheme each run, per user request -- not alternating like video.
  const count = Math.min(usableFiles.length, MIN_PHOTO_CREATIVES + Math.floor(Math.random() * (MAX_PHOTO_CREATIVES - MIN_PHOTO_CREATIVES + 1)));
  const shuffled = [...usableFiles].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, count);
  const scheme = Math.random() < 0.5 ? `1-${count}-1` : `1-1-${count}`;
  const isSharedAdsetScheme = scheme.startsWith('1-1-');
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

  const instagramUserId = await getOrCreatePageBackedInstagramAccount(pageId);
  if (!instagramUserId) {
    console.warn(`[${label}] No Instagram (page-backed) account available.`);
  }

  const campaignRes = await createCampaign(acc.accountId, campaignName, acc.dailyBudgetMinorUnits);
  if (!campaignRes.ok || campaignRes.body.error) {
    console.error(`[${label}] Campaign creation failed:`, campaignRes.body.error || campaignRes.status);
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nОшибка создания кампании: ${campaignRes.body.error?.message || campaignRes.status}`);
    return;
  }
  const campaignId = campaignRes.body.id;

  // Upload the MacBook (shared) photo once per account -- reuse cached image hash if we've
  // already uploaded this exact file for this account before.
  let macbookImageHash = await getCachedImage(acc.accountId, macbookPhotoFile.id);
  if (macbookImageHash) {
    console.log(`[${label}] Reusing cached MacBook photo (${macbookImageHash}).`);
  } else {
    const buffer = await downloadFileBuffer(macbookPhotoFile.id);
    const imgRes = await uploadImage(acc.accountId, buffer, macbookPhotoFile.name);
    if (!imgRes.hash) {
      console.error(`[${label}] MacBook photo upload failed:`, imgRes.error?.message);
      await sendTelegramMessage(`⚠️ <b>${label}</b>\nНе удалось загрузить фото MacBook.`);
      return;
    }
    macbookImageHash = imgRes.hash;
    await setCachedImage(acc.accountId, macbookPhotoFile.id, macbookImageHash);
  }

  let sharedAdsetId: string | null = null;
  if (isSharedAdsetScheme) {
    const adsetRes = await createAdset(acc.accountId, campaignId, `${campaignName} — Adset`, pixelId);
    if (!adsetRes.ok || adsetRes.body.error) {
      console.error(`[${label}] Shared adset creation failed:`, adsetRes.body.error?.message);
      await sendTelegramMessage(`⚠️ <b>${label}</b>\nОшибка создания адсета: ${adsetRes.body.error?.message}`);
      return;
    }
    sharedAdsetId = adsetRes.body.id;
  }

  let successCount = 0;

  await runWithConcurrency(picked, 3, async (file, i) => {
    try {
      let adsetId: string;
      if (isSharedAdsetScheme) {
        adsetId = sharedAdsetId!;
      } else {
        const adsetRes = await createAdset(acc.accountId, campaignId, `${campaignName} — Adset ${i + 1}`, pixelId);
        if (!adsetRes.ok || adsetRes.body.error) {
          console.error(`[${label}] Adset ${i + 1} creation failed:`, adsetRes.body.error?.message);
          return;
        }
        adsetId = adsetRes.body.id;
      }

      let dailyImageHash = await getCachedImage(acc.accountId, file.id);
      if (dailyImageHash) {
        console.log(`[${label}] Reusing cached photo for ${file.name} (${dailyImageHash}).`);
      } else {
        const buffer = await downloadFileBuffer(file.id);
        const imgRes = await uploadImage(acc.accountId, buffer, file.name);
        if (!imgRes.hash) {
          console.error(`[${label}] Image upload failed for ${file.name}:`, imgRes.error?.message);
          return;
        }
        dailyImageHash = imgRes.hash;
        await setCachedImage(acc.accountId, file.id, dailyImageHash);
      }

      const creativeBody = buildTwoTierMultiLanguageImageCreativeBody(
        pageId,
        macbookImageHash!,
        photoOtherLocaleIds,
        dailyImageHash,
        photoTurkishLocaleId !== null ? [photoTurkishLocaleId] : [],
        destinationUrl,
        PHOTO_AD_TITLE,
        PHOTO_AD_BODY,
        PHOTO_TURKISH_TITLE,
        PHOTO_TURKISH_BODY,
        `${campaignName} — Creative ${i + 1}`,
        instagramUserId
      );

      const creativeRes = await createAdCreative(acc.accountId, creativeBody);
      if (!creativeRes.ok || creativeRes.body.error) {
        console.error(`[${label}] Creative creation failed for ${file.name}:`, JSON.stringify(creativeRes.body.error));
        return;
      }

      const adRes = await createAd(acc.accountId, `${campaignName} — Ad ${i + 1}`, adsetId, creativeRes.body.id);
      if (!adRes.ok || adRes.body.error) {
        console.error(`[${label}] Ad creation failed for ${file.name}:`, JSON.stringify(adRes.body.error));
        return;
      }

      successCount++;
    } catch (err) {
      console.error(`[${label}] Unexpected error on creative ${i + 1}:`, err);
    }
  });

  console.log(`[${label}] Done: ${successCount}/${picked.length} ads created in campaign "${campaignName}" (scheme ${scheme})`);
  await sendTelegramMessage(
    `✅ <b>${campaignName}</b>\nАккаунт: ${label}\nСхема: ${scheme}\nУспешно: ${successCount} из ${picked.length} (MacBook + своё дневное фото на турецкий в каждом)`
  );
}

async function processAccount(
  acc: AccountConfig,
  otherLocaleIds: number[],
  turkishLocaleId: number | null,
  photoOtherLocaleIds: number[],
  photoTurkishLocaleId: number | null
) {
  let mediaType: 'photo' | 'video';
  if (process.env.FORCE_VIDEO === 'true') {
    mediaType = 'video';
  } else if (process.env.FORCE_PHOTO === 'true') {
    mediaType = 'photo';
  } else {
    mediaType = await nextMediaType(acc.accountId);
  }
  if (mediaType === 'video') {
    await processVideoAccount(acc, otherLocaleIds, turkishLocaleId);
  } else {
    await processPhotoAccount(acc, photoOtherLocaleIds, photoTurkishLocaleId);
  }
}

async function main() {
  if (process.env.AUTO_LAUNCH_DISABLED === 'true') {
    console.log('AUTO_LAUNCH_DISABLED is set — skipping this run.');
    return;
  }

  const gotLock = await acquireRunLock('auto-launch', 1800); // 30 min TTL, safety net if the process crashes
  if (!gotLock) {
    console.log('Another auto-launch run is already in progress — skipping this run to avoid overlap.');
    return;
  }

  try {
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

    console.log('Resolving photo ad locale IDs...');
    const resolvedPhotoOthers = await resolveAdLocaleIds(PHOTO_AD_LANGUAGES);
    const resolvedPhotoTurkish = await resolveAdLocaleIds([PHOTO_TURKISH_LANGUAGE]);
    const missingPhoto = resolvedPhotoOthers.filter(r => r.id === null).map(r => r.name);
    if (missingPhoto.length > 0) {
      console.warn('Could not resolve photo locale IDs for:', missingPhoto.join(', '));
    }
    const photoOtherLocaleIds = resolvedPhotoOthers.filter(r => r.id !== null).map(r => r.id as number);
    const photoTurkishLocaleId = resolvedPhotoTurkish[0]?.id ?? null;
    console.log(`Resolved ${photoOtherLocaleIds.length}/${PHOTO_AD_LANGUAGES.length} photo locale IDs, Turkish=${photoTurkishLocaleId}.`);

    const accounts = getActiveAccounts();
    let testAccounts = accounts;
    if (process.env.TEST_ACCOUNT_ID) {
      testAccounts = accounts.filter(a => a.accountId === process.env.TEST_ACCOUNT_ID);
    } else if (process.env.TEST_SINGLE_ACCOUNT === 'true') {
      testAccounts = accounts.slice(0, 1);
    }
    console.log(`Starting auto-launch run for ${testAccounts.length} active accounts...`);
    await runWithConcurrency(testAccounts, 3, async (acc) => {
      try {
        await processAccount(acc, otherLocaleIds, turkishLocaleId, photoOtherLocaleIds, photoTurkishLocaleId);
      } catch (err) {
        console.error(`Account ${acc.label} (${acc.accountId}) failed entirely:`, err);
        await sendTelegramMessage(`⚠️ <b>${acc.label}</b>\nЗапуск полностью упал: ${err}`);
      }
    });
    console.log('Auto-launch run complete.');
  } finally {
    await releaseRunLock('auto-launch');
  }
}

main().catch(err => {
  console.error('Fatal error in auto-launch job:', err);
  process.exit(1);
});
