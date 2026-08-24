import Redis from 'ioredis';

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL not set');
  const redis = new Redis(redisUrl);

  const keys = await redis.keys('runLock:*');
  console.log('Lock keys found:', keys);
  for (const key of keys) {
    const val = await redis.get(key);
    const ttl = await redis.ttl(key);
    console.log(`${key} -> value=${val}, ttl=${ttl}s`);
  }

  await redis.quit();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
