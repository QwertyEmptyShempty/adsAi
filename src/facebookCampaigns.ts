import fetch from 'node-fetch';
import FormData from 'form-data';
import { fbGet, fbPost, fbDelete, FbResult } from './facebook';

// ---- Pixel / page resolution (port of JS_ApplyPixel) ----

const DEFAULT_PIXEL = '1001158549411532';

export interface PixelPageResolution {
  pixelId: string;
  pixelWarning: string | null;
  pageId: string | null;
  pageWarning: string | null;
  destinationUrl: string;
}

export async function resolvePixelAndPage(
  accountId: string,
  preferredPixelId: string | null,
  preferredPageId: string | null,
  destinationUrlTemplate: string
): Promise<PixelPageResolution> {
  const result = await fbGet<{ adspixels?: { data?: { id: string; name: string }[] }; promote_pages?: { data?: { id: string; name: string }[] } }>(
    `/act_${accountId}`,
    { fields: 'adspixels.limit(50){id,name},promote_pages.limit(50){id,name}' }
  );
  const pixels = result.body.adspixels?.data || [];
  const pages = result.body.promote_pages?.data || [];

  let pixelId = DEFAULT_PIXEL;
  let pixelWarning: string | null = null;
  if (preferredPixelId) {
    const found = pixels.find(p => p.id === preferredPixelId);
    if (found) {
      pixelId = found.id;
    } else {
      pixelId = pixels.length > 0 ? pixels[0].id : DEFAULT_PIXEL;
      pixelWarning = `preferredPixelId ${preferredPixelId} not found in account ${accountId}, used ${pixelId} instead`;
    }
  } else if (pixels.length > 0) {
    pixelId = pixels[0].id;
  } else {
    pixelWarning = `No pixel found in account ${accountId}, used default ${DEFAULT_PIXEL}`;
  }

  let pageId: string | null = null;
  let pageWarning: string | null = null;
  if (preferredPageId) {
    pageId = preferredPageId; // trust it directly, same as n8n version -- promote_pages doesn't always reflect Business Portfolio access
    if (!pages.find(p => p.id === preferredPageId)) {
      pageWarning = `preferredPageId ${preferredPageId} not in promote_pages list for account ${accountId} (used directly anyway)`;
    }
  } else if (pages.length > 0) {
    pageId = pages[0].id;
  } else {
    pageWarning = `No preferredPageId set and no promote_pages found for account ${accountId}`;
  }

  const destinationUrl = destinationUrlTemplate.replace('__PIXEL_ID__', pixelId);

  return { pixelId, pixelWarning, pageId, pageWarning, destinationUrl };
}

// ---- Campaign / Adset / Ad creation ----

export async function createCampaign(accountId: string, name: string, dailyBudgetMinorUnits: number): Promise<FbResult<{ id: string; error?: any }>> {
  return fbPost(`/act_${accountId}/campaigns`, {
    name,
    objective: 'OUTCOME_LEADS',
    status: 'ACTIVE',
    special_ad_categories: JSON.stringify(['FINANCIAL_PRODUCTS_SERVICES']),
    special_ad_category_country: JSON.stringify(['TR']),
    daily_budget: String(dailyBudgetMinorUnits),
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  });
}

export async function createAdset(
  accountId: string,
  campaignId: string,
  name: string,
  pixelId: string
): Promise<FbResult<{ id: string; error?: any }>> {
  return fbPost(`/act_${accountId}/adsets`, {
    name,
    campaign_id: campaignId,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'OFFSITE_CONVERSIONS',
    status: 'ACTIVE',
    promoted_object: JSON.stringify({ pixel_id: pixelId, custom_event_type: 'SUBSCRIBE' }),
    targeting: JSON.stringify({
      geo_locations: { countries: ['TR'] },
      age_min: 18,
      age_max: 65,
      targeting_relaxation_types: { lookalike: 0, custom_audience: 0 },
      targeting_automation: { advantage_audience: 1 },
    }),
  });
}

export async function createAd(
  accountId: string,
  name: string,
  adsetId: string,
  creativeId: string
): Promise<FbResult<{ id: string; error?: any }>> {
  return fbPost(`/act_${accountId}/ads`, {
    name,
    adset_id: adsetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status: 'ACTIVE',
  });
}

// ---- Media upload ----

export async function uploadImage(accountId: string, fileBuffer: Buffer, filename: string): Promise<{ hash: string | null; error?: any }> {
  const token = process.env.FB_ACCESS_TOKEN;
  const form = new FormData();
  form.append('filename', fileBuffer, filename);
  form.append('access_token', token || '');

  const res = await fetch(`https://graph.facebook.com/v19.0/act_${accountId}/adimages`, {
    method: 'POST',
    body: form as any,
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body.error) return { hash: null, error: body.error };
  const images = body.images || {};
  const firstKey = Object.keys(images)[0];
  return { hash: firstKey ? images[firstKey].hash : null };
}

export async function uploadVideoByUrl(accountId: string, fileUrl: string, name: string): Promise<{ id: string | null; error?: any }> {
  const res = await fbPost<{ id: string; error?: any }>(`/act_${accountId}/advideos`, { file_url: fileUrl, name });
  if (!res.ok || res.body.error) return { id: null, error: res.body.error };
  return { id: res.body.id };
}

export async function waitForVideoReady(videoId: string, maxWaitMs = 240000, intervalMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fbGet<{ status?: { video_status?: string } }>(`/${videoId}`, { fields: 'status' });
    const status = res.body.status?.video_status;
    if (status === 'ready') return true;
    if (status === 'error') return false;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

export async function getVideoThumbnail(videoId: string): Promise<string | null> {
  const res = await fbGet<{ picture?: string }>(`/${videoId}`, { fields: 'picture' });
  return res.body.picture || null;
}

// ---- Creative bodies (port of JS_Creative / JS_Creative_Image) ----

export function buildVideoCreativeBody(pageId: string, videoId: string, thumbUrl: string, destinationUrl: string, name: string) {
  return {
    name,
    object_story_spec: {
      page_id: pageId,
      video_data: {
        video_id: videoId,
        message: 'Merhaba',
        image_url: thumbUrl,
        call_to_action: { type: 'SUBSCRIBE', value: { link: destinationUrl } },
      },
    },
  };
}

export function buildImageCreativeBody(pageId: string, imageHash: string, destinationUrl: string, name: string) {
  return {
    name,
    object_story_spec: {
      page_id: pageId,
      link_data: {
        image_hash: imageHash,
        message: 'Merhaba',
        link: destinationUrl,
        call_to_action: { type: 'SUBSCRIBE', value: { link: destinationUrl } },
      },
    },
  };
}

// Verified via live Graph API /search?type=adlocale testing on 19.08 -- Facebook stores locale
// display names in the NATIVE language, so English names mostly fail to match. These numeric
// IDs are confirmed stable and correct.
const VERIFIED_LOCALE_IDS: Record<string, number> = {
  Armenian: 68,
  Malay: 41,
  Filipino: 26,
  German: 5,
  Esperanto: 57,
  Norwegian: 13,
  Persian: 60,
  'Traditional Chinese (Taiwan)': 22,
  Turkish: 19,
};

export async function resolveAdLocaleId(languageName: string): Promise<number | null> {
  if (languageName in VERIFIED_LOCALE_IDS) {
    return VERIFIED_LOCALE_IDS[languageName];
  }
  // Fallback: live search for any language not in the verified table above.
  const res = await fbGet<{ data?: { key: number; name: string }[]; error?: any }>('/search', {
    type: 'adlocale',
    q: languageName,
  });
  const match = res.body.data?.[0];
  return match ? match.key : null;
}

export async function resolveAdLocaleIds(languageNames: string[]): Promise<{ name: string; id: number | null }[]> {
  const results: { name: string; id: number | null }[] = [];
  for (const name of languageNames) {
    const id = await resolveAdLocaleId(name);
    results.push({ name, id });
  }
  return results;
}

export function buildMultiLanguageVideoCreativeBody(
  pageId: string,
  videoId: string,
  thumbUrl: string,
  destinationUrl: string,
  title: string,
  body: string,
  localeIds: number[],
  name: string
) {
  return {
    name,
    object_story_spec: { page_id: pageId },
    asset_feed_spec: {
      titles: [{ text: title, adlabels: [{ name: 'default' }] }],
      bodies: [{ text: body, adlabels: [{ name: 'default' }] }],
      videos: [{ video_id: videoId, thumbnail_url: thumbUrl, adlabels: [{ name: 'default' }] }],
      link_urls: [{ website_url: destinationUrl, adlabels: [{ name: 'default' }] }],
      ad_formats: ['SINGLE_VIDEO'],
      call_to_action_types: ['SUBSCRIBE'],
      asset_customization_rules: localeIds.map(localeId => ({
        customization_spec: { locales: [localeId] },
        title_label: { name: 'default' },
        body_label: { name: 'default' },
        video_label: { name: 'default' },
        link_url_label: { name: 'default' },
      })),
    },
  };
}

export function buildTwoTierMultiLanguageVideoCreativeBody(
  pageId: string,
  primaryVideo: { id: string; thumb: string },
  primaryLocaleIds: number[],
  secondaryVideo: { id: string; thumb: string },
  secondaryLocaleIds: number[],
  destinationUrl: string,
  title: string,
  body: string,
  name: string
) {
  const rules = [
    ...primaryLocaleIds.map(localeId => ({
      customization_spec: { locales: [localeId] },
      title_label: { name: 'default' },
      body_label: { name: 'default' },
      video_label: { name: 'primary' },
      link_url_label: { name: 'default' },
    })),
    ...secondaryLocaleIds.map(localeId => ({
      customization_spec: { locales: [localeId] },
      title_label: { name: 'default' },
      body_label: { name: 'default' },
      video_label: { name: 'secondary' },
      link_url_label: { name: 'default' },
    })),
  ];

  return {
    name,
    object_story_spec: { page_id: pageId },
    asset_feed_spec: {
      titles: [{ text: title, adlabels: [{ name: 'default' }] }],
      bodies: [{ text: body, adlabels: [{ name: 'default' }] }],
      videos: [
        { video_id: primaryVideo.id, thumbnail_url: primaryVideo.thumb, adlabels: [{ name: 'primary' }] },
        { video_id: secondaryVideo.id, thumbnail_url: secondaryVideo.thumb, adlabels: [{ name: 'secondary' }] },
      ],
      link_urls: [{ website_url: destinationUrl, adlabels: [{ name: 'default' }] }],
      ad_formats: ['SINGLE_VIDEO'],
      call_to_action_types: ['SUBSCRIBE'],
      asset_customization_rules: rules,
    },
  };
}

export async function createAdCreative(accountId: string, body: object): Promise<FbResult<{ id: string; error?: any }>> {
  const token = process.env.FB_ACCESS_TOKEN;
  const res = await fetch(`https://graph.facebook.com/v19.0/act_${accountId}/adcreatives?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const respBody: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: respBody };
}
