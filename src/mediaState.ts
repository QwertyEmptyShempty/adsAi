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

// Cache the shared MacBook video's Facebook video_id + thumbnail per account, so we don't
// re-upload the exact same file on every run (avoids redundant uploads and processing-queue congestion).
const MACBOOK_CACHE_PREFIX = 'macbookVideo:';

export async function getCachedMacbookVideo(accountId: string, fileId: string): Promise<{ id: string; thumb: string } | null> {
  const redis = getClient();
  const raw = await redis.get(`${MACBOOK_CACHE_PREFIX}${accountId}:${fileId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setCachedMacbookVideo(accountId: string, fileId: string, video: { id: string; thumb: string }): Promise<void> {
  const redis = getClient();
  // Expire after 45 days -- Facebook video IDs can eventually become invalid/removed; force a re-upload periodically.
  await redis.set(`${MACBOOK_CACHE_PREFIX}${accountId}:${fileId}`, JSON.stringify(video), 'EX', 45 * 24 * 60 * 60);
}
