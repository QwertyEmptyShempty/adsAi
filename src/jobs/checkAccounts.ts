import { fbGet } from '../facebook';

const ACCOUNT_IDS = ['1581600120211938', '1049537227666018', '2945518242465040', '1484179916801451'];

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
