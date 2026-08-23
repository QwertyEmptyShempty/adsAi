import { fbGet } from '../facebook';

const CANDIDATES: Record<string, string[]> = {
  Irish: ['Irish', 'Gaeilge', 'ga_IE'],
  Nepali: ['Nepali', 'नेपाली', 'ne_NP'],
  Czech: ['Czech', 'Čeština', 'cs_CZ'],
  Swahili: ['Swahili', 'Kiswahili', 'sw_KE'],
  Serbian: ['Serbian', 'Српски', 'Srpski', 'sr_RS'],
  Croatian: ['Croatian', 'Hrvatski', 'hr_HR'],
  Marathi: ['Marathi', 'मराठी', 'mr_IN'],
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
