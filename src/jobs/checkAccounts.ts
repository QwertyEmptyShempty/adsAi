import { fbGet } from '../facebook';

const ACCOUNT_IDS = ['1017176071306940', '1078383794753243'];

async function main() {
  for (const id of ACCOUNT_IDS) {
    const res = await fbGet<{ id?: string; name?: string; account_status?: number; error?: any }>(`/act_${id}`, {
      fields: 'id,name,account_status',
    });
    console.log(`[${id}] ->`, JSON.stringify(res.body));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
