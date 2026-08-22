import Redis from 'ioredis';

let client: Redis | null = null;

function getClient(): Redis {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL environment variable is not set');
  }
  client = new Redis(url);
  return client;
}

const KEY_PREFIX = 'lastMediaType:';

export async function getLastMediaType(accountId: string): Promise<'photo' | 'video' | null> {
  const redis = getClient();
  const val = await redis.get(KEY_PREFIX + accountId);
  return val === 'photo' || val === 'video' ? val : null;
}

export async function setLastMediaType(accountId: string, type: 'photo' | 'video'): Promise<void> {
  const redis = getClient();
  await redis.set(KEY_PREFIX + accountId, type);
}

// Returns the type to use THIS run, and records it for next time.
export async function nextMediaType(accountId: string): Promise<'photo' | 'video'> {
  const last = await getLastMediaType(accountId);
  const next: 'photo' | 'video' = last === 'video' ? 'photo' : 'video';
  await setLastMediaType(accountId, next);
  return next;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

// Cache ANY uploaded video's Facebook video_id + thumbnail per account+file, so we don't
// re-upload the exact same file on every run (avoids redundant uploads and processing-queue congestion).
// Videos already uploaded stay in the ad account's video library on Facebook's side --
// we just need to remember the video_id ourselves to reuse it instead of uploading a fresh copy.
const VIDEO_CACHE_PREFIX = 'videoCache:';

export async function getCachedVideo(accountId: string, fileId: string): Promise<{ id: string; thumb: string } | null> {
  const redis = getClient();
  const raw = await redis.get(`${VIDEO_CACHE_PREFIX}${accountId}:${fileId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setCachedVideo(accountId: string, fileId: string, video: { id: string; thumb: string }): Promise<void> {
  const redis = getClient();
  // Expire after 45 days -- Facebook video IDs can eventually become invalid/removed; force a re-upload periodically.
  await redis.set(`${VIDEO_CACHE_PREFIX}${accountId}:${fileId}`, JSON.stringify(video), 'EX', 45 * 24 * 60 * 60);
}

// Backwards-compatible aliases (macbook is just one specific video like any other now)
export const getCachedMacbookVideo = getCachedVideo;
export const setCachedMacbookVideo = setCachedVideo;

// Distributed lock: prevents two overlapping runs of the same job (e.g. a manual Trigger Run
// firing while the scheduled run is still in progress) from hammering Facebook's video upload
// pipeline simultaneously with the same token, which causes processing timeouts for everyone.
export async function acquireRunLock(lockName: string, ttlSeconds = 1800): Promise<boolean> {
  const redis = getClient();
  const result = await redis.set(`runLock:${lockName}`, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

export async function releaseRunLock(lockName: string): Promise<void> {
  const redis = getClient();
  await redis.del(`runLock:${lockName}`);
}

// Alternates the video campaign structure per account: 1-5-1 (5 separate adsets, 1 ad each)
// vs 1-1-5 (1 shared adset, 5 ads). Same alternation pattern as photo/video media type.
const SCHEME_KEY_PREFIX = 'lastScheme:';

export async function getLastScheme(accountId: string): Promise<'1-5-1' | '1-1-5' | null> {
  const redis = getClient();
  const val = await redis.get(SCHEME_KEY_PREFIX + accountId);
  return val === '1-5-1' || val === '1-1-5' ? val : null;
}

export async function nextScheme(accountId: string): Promise<'1-5-1' | '1-1-5'> {
  const last = await getLastScheme(accountId);
  const next: '1-5-1' | '1-1-5' = last === '1-5-1' ? '1-1-5' : '1-5-1';
  const redis = getClient();
  await redis.set(SCHEME_KEY_PREFIX + accountId, next);
  return next;
}
