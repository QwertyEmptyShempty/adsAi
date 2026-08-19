import { fbGet } from '../facebook';

const CANDIDATES: Record<string, string[]> = {
  Norwegian: ['Norsk', 'Norsk (bokmål)', 'Norwegian Bokmal', 'Norwegian bokmal', 'no_NO', 'Bokmål'],
  'Traditional Chinese (Taiwan)': ['繁體中文(台灣)', '繁體中文', '中文(台灣)', 'zh_Hant_TW', 'Chinese (Traditional)', 'Mandarin'],
};

async function main() {
  console.log('Testing locale resolution variants (no campaigns created, safe to run repeatedly)...');
  for (const [lang, variants] of Object.entries(CANDIDATES)) {
    for (const q of variants) {
      const res = await fbGet<{ data?: { key: number; name: string }[] }>('/search', { type: 'adlocale', q });
      console.log(`[${lang}] q="${q}" ->`, JSON.stringify(res.body));
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
