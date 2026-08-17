import { getActiveAccounts, AccountConfig } from '../config';
import { nextMediaType } from '../mediaState';
import {
  findCandidateFolders,
  pickLatestFolder,
  listFilesInFolder,
  isVideoFile,
  directDownloadUrl,
  downloadFileBuffer,
  DriveFile,
} from '../googleDrive';
import {
  resolvePixelAndPage,
  createCampaign,
  createAdset,
  createAd,
  uploadImage,
  uploadVideoByUrl,
  waitForVideoReady,
  getVideoThumbnail,
  buildVideoCreativeBody,
  buildImageCreativeBody,
  createAdCreative,
} from '../facebookCampaigns';
import { sendTelegramMessage } from '../telegram';

const MIN_CREATIVES = 2;
const MAX_CREATIVES = 7;
const BROKEN_FILES = ['13111.mp4'];

function pickRandomFiles(files: DriveFile[]): DriveFile[] {
  const usableFiles = files.filter(f => !BROKEN_FILES.includes(f.name));
  const count = Math.min(usableFiles.length, MIN_CREATIVES + Math.floor(Math.random() * (MAX_CREATIVES - MIN_CREATIVES + 1)));
  const shuffled = [...usableFiles].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function buildCampaignName(scheme: 'scheme_1N1' | 'scheme_11N', label: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }).replace('/', '.');
  const timeStr = now.toTimeString().slice(0, 5);
  const schemeLabel = scheme === 'scheme_1N1' ? '1-N-1' : '1-1-N';
  return `${dateStr} Авто ${schemeLabel} ${timeStr} — ${label}`;
}

async function processAccount(acc: AccountConfig) {
  const label = acc.label;

  // 1. Decide photo or video for this account (persisted, alternates over time)
  const mediaType = await nextMediaType(acc.accountId);

  // 2. Find and pick the latest matching folder
  const { videoFolders, photoFolders } = await findCandidateFolders();
  const pool = mediaType === 'video' ? videoFolders : photoFolders;
  const folder = pickLatestFolder(pool.length > 0 ? pool : [...videoFolders, ...photoFolders]);
  if (!folder) {
    console.log(`[${label}] No creative folder found, skipping.`);
    return;
  }

  // 3. List and randomly pick 2-7 files
  const files = await listFilesInFolder(folder.id);
  if (files.length === 0) {
    console.log(`[${label}] Folder "${folder.name}" has no files, skipping.`);
    return;
  }
  const picked = pickRandomFiles(files);
  const scheme: 'scheme_1N1' | 'scheme_11N' = Math.random() < 0.5 ? 'scheme_1N1' : 'scheme_11N';
  const campaignName = buildCampaignName(scheme, label);

  console.log(`[${label}] ${mediaType}, folder="${folder.name}", ${picked.length} creatives, scheme=${scheme}`);

  // 4. Resolve pixel & page
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

  // 5. Create campaign
  const campaignRes = await createCampaign(acc.accountId, campaignName, acc.dailyBudgetMinorUnits);
  if (!campaignRes.ok || campaignRes.body.error) {
    console.error(`[${label}] Campaign creation failed:`, campaignRes.body.error || campaignRes.status);
    await sendTelegramMessage(`⚠️ <b>${label}</b>\nОшибка создания кампании: ${campaignRes.body.error?.message || campaignRes.status}`);
    return;
  }
  const campaignId = campaignRes.body.id;

  // 6. Create ads (adset(s) depend on scheme)
  let sharedAdsetId: string | null = null;
  let successCount = 0;

  for (let i = 0; i < picked.length; i++) {
    const file = picked[i];
    try {
      let adsetId: string;
      if (scheme === 'scheme_1N1' || !sharedAdsetId) {
        const adsetRes = await createAdset(acc.accountId, campaignId, `${campaignName} — Adset ${i + 1}`, pixelId);
        if (!adsetRes.ok || adsetRes.body.error) {
          console.error(`[${label}] Adset ${i + 1} creation failed:`, adsetRes.body.error?.message);
          continue;
        }
        adsetId = adsetRes.body.id;
        if (scheme === 'scheme_11N') sharedAdsetId = adsetId;
      } else {
        adsetId = sharedAdsetId;
      }

      const isVideo = isVideoFile(file.name);
      let creativeBody: object;

      if (isVideo) {
        const fileUrl = directDownloadUrl(file.id);
        const videoRes = await uploadVideoByUrl(acc.accountId, fileUrl, `${campaignName} — video ${i + 1}`);
        if (!videoRes.id) {
          console.error(`[${label}] Video upload failed for ${file.name}:`, videoRes.error?.message);
          continue;
        }
        const ready = await waitForVideoReady(videoRes.id);
        if (!ready) {
          console.error(`[${label}] Video ${videoRes.id} did not finish processing in time, skipping.`);
          continue;
        }
        const thumb = (await getVideoThumbnail(videoRes.id)) || '';
        creativeBody = buildVideoCreativeBody(pageId, videoRes.id, thumb, destinationUrl, `${campaignName} — Creative ${i + 1}`);
      } else {
        const buffer = await downloadFileBuffer(file.id);
        const imgRes = await uploadImage(acc.accountId, buffer, file.name);
        if (!imgRes.hash) {
          console.error(`[${label}] Image upload failed for ${file.name}:`, imgRes.error?.message);
          continue;
        }
        creativeBody = buildImageCreativeBody(pageId, imgRes.hash, destinationUrl, `${campaignName} — Creative ${i + 1}`);
      }

      const creativeRes = await createAdCreative(acc.accountId, creativeBody);
      if (!creativeRes.ok || creativeRes.body.error) {
        console.error(`[${label}] Creative creation failed for ${file.name}:`, creativeRes.body.error?.message);
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

async function main() {
  const accounts = getActiveAccounts();
  console.log(`Starting auto-launch run for ${accounts.length} active accounts...`);
  for (const acc of accounts) {
    try {
      await processAccount(acc);
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
