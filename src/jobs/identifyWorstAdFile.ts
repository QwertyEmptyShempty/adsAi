import Redis from 'ioredis';
import { fbGet } from '../facebook';

// Worst-performing ads found by analyze-worst-video (account label + ad id)
const TARGETS = [
  { accountId: '1765035847822404', accountLabel: 'Moon_T218', adId: '120254175880890271' }, // Новое объявление с целью "Лиды" -- $84.49
  { accountId: '1765035847822404', accountLabel: 'Moon_T218', adId: '120254229443970271' }, // $42.01
  { accountId: '1765035847822404', accountLabel: 'Moon_T218', adId: '120254233476770271' }, // $35.88
  { accountId: '1479558950603581', accountLabel: 'ADAP 11', adId: '120248988712110719' }, // $34.62
  { accountId: '1051176780789750', accountLabel: '01473 Luna-26', adId: '52602308973616' }, // $13.44
];

async function getVideoIdFromAd(adId: string): Promise<string | null> {
  const res = await fbGet<{ creative?: { asset_feed_spec?: { videos?: { video_id: string }[] }; object_story_spec?: { video_data?: { video_id: string } } }; error?: any }>(
    `/${adId}`,
    { fields: 'creative{asset_feed_spec{videos},object_story_spec{video_data}}' }
  );
  if (!res.ok || res.body.error) {
    console.error(`Failed to fetch ad ${adId}:`, JSON.stringify(res.body.error));
    return null;
  }
  const feedVideos = res.body.creative?.asset_feed_spec?.videos;
  if (feedVideos && feedVideos.length > 0) return feedVideos[0].video_id;
  const legacyVideo = res.body.creative?.object_story_spec?.video_data?.video_id;
  return legacyVideo || null;
}

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL not set');
  const redis = new Redis(redisUrl);

  for (const t of TARGETS) {
    console.log(`\n--- [${t.accountLabel}] ad ${t.adId} ---`);
    const videoId = await getVideoIdFromAd(t.adId);
    if (!videoId) {
      console.log('Could not resolve video_id for this ad.');
      continue;
    }
    console.log(`video_id on Facebook: ${videoId}`);

    // Scan our Redis video cache for this account to find which Drive fileId maps to this video_id
    const keys = await redis.keys(`videoCache:${t.accountId}:*`);
    let found = false;
    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.id === videoId) {
          const fileId = key.split(':').slice(2).join(':');
          console.log(`MATCH -- Drive fileId: ${fileId}`);
          found = true;
        }
      } catch {}
    }
    if (!found) {
      console.log('No matching cache entry found (video may predate caching, or account ID mismatch).');
    }
  }

  await redis.quit();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
