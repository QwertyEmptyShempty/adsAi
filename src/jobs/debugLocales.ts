import { fbGet } from '../facebook';

const CANDIDATES: Record<string, string[]> = {
  Armenian: ['Armenian', 'hy_AM', 'Հայերեն'],
  Malay: ['Malay', 'ms_MY', 'Bahasa Melayu'],
  German: ['German', 'de_DE', 'Deutsch'],
  Norwegian: ['Norwegian', 'nb_NO', 'Norwegian (Bokmal)', 'Norsk bokmål'],
  Persian: ['Persian', 'fa_IR', 'Farsi', 'فارسی'],
  'Traditional Chinese (Taiwan)': ['Traditional Chinese (Taiwan)', 'zh_TW', 'Chinese (Taiwan)', 'Chinese', 'Traditional Chinese'],
  Turkish: ['Turkish', 'tr_TR', 'Türkçe'],
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
