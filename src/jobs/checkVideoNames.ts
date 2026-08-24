import { fbGet } from '../facebook';

const VIDEO_IDS = ['1085371980708096', '1584249319961599', '1046808338064888', '992368500489585', '2481944878954783'];

async function main() {
  for (const id of VIDEO_IDS) {
    const res = await fbGet<{ id?: string; title?: string; created_time?: string; length?: number; error?: any }>(`/${id}`, {
      fields: 'id,title,created_time,length',
    });
    console.log(`[${id}] ->`, JSON.stringify(res.body));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
