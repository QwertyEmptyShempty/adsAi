import Redis from 'ioredis';
import { fbGet } from '../facebook';
import { getActiveAccounts, accounts as allAccounts } from '../config';

// Worst-performing ads found by analyze-worst-video (our own automated ones only, by naming pattern)
const TARGETS: { accountLabel: string; adId: string; spend: string }[] = [
  { accountLabel: 'Moon_T218', adId: '120254229443970271', spend: '$42.01' },
  { accountLabel: 'Moon_T218', adId: '120254233476770271', spend: '$35.88' },
  { accountLabel: 'ADAP 11', adId: '120248988712110719', spend: '$34.62' },
  { accountLabel: 'Moon_T218', adId: '120254192268320271', spend: '$24.90' },
  { accountLabel: 'Moon_T218', adId: '120254192250290271', spend: '$16.92' },
  { accountLabel: '01473 Luna-25', adId: '120252084114180220', spend: '$16.74' },
  { accountLabel: '01473 Luna-26', adId: '52602308973616', spend: '$13.44' },
  { accountLabel: 'Стрылец 17 (L3)', adId: '120254834112620210', spend: '$12.92' },
];

function findAccountId(label: string): string | null {
  const acc = allAccounts.find(a => a.label === label);
  return acc ? acc.accountId : null;
}

async function reverseLookupFilename(redis: Redis, accountId: string, videoId: string): Promise<string | null> {
  const stream = redis.scanStream({ match: `videoCache:${accountId}:*` });
  for await (const keys of stream) {
    for (const key of keys as string[]) {
      const raw = await redis.get(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.id === videoId) {
          // key format: videoCache:{accountId}:{fileId} -- fileId itself isn't the filename,
          // but we log filename->id mappings elsewhere; return the fileId here as identifier.
          return key.split(':').slice(2).join(':');
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error('REDIS_URL not set');
    process.exit(1);
  }
  const redis = new Redis(redisUrl);

  for (const target of TARGETS) {
    const accountId = findAccountId(target.accountLabel);
    if (!accountId) {
      console.log(`[${target.accountLabel}] account not found in config, skipping.`);
      continue;
    }

    const res = await fbGet<{ creative?: { id?: string; object_story_spec?: any; asset_feed_spec?: any }; error?: any }>(`/${target.adId}`, {
      fields: 'creative{id,object_story_spec,asset_feed_spec{videos}}',
    });
    if (!res.ok || res.body.error) {
      console.log(`[${target.accountLabel}] ad ${target.adId} fetch failed:`, JSON.stringify(res.body.error));
      continue;
    }

    const feedSpec = res.body.creative?.asset_feed_spec;
    const videoDataId = res.body.creative?.object_story_spec?.video_data?.video_id;
    const videoIds: string[] = [];
    if (videoDataId) videoIds.push(videoDataId);
    if (feedSpec?.videos) {
      for (const v of feedSpec.videos) {
        if (v.video_id) videoIds.push(v.video_id);
      }
    }

    console.log(`\n[${target.accountLabel}] Ad ${target.adId} (spend ${target.spend}) uses video IDs: ${videoIds.join(', ') || 'none found'}`);

    for (const videoId of videoIds) {
      const fileId = await reverseLookupFilename(redis, accountId, videoId);
      if (fileId) {
        console.log(`  -> matched Drive file_id: ${fileId} (video_id ${videoId})`);
      } else {
        console.log(`  -> no cache match for video_id ${videoId} (may predate caching, or macbook filler video)`);
      }
    }
  }

  await redis.quit();
  console.log('\nTrace complete.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
