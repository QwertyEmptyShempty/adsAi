import Redis from 'ioredis';

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL not set');
  const redis = new Redis(redisUrl);

  const keys = await redis.keys('runLock:*');
  console.log('Clearing lock keys:', keys);
  for (const key of keys) {
    await redis.del(key);
  }
  console.log('Done.');
  await redis.quit();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
