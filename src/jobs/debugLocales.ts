import { resolveAdLocaleIds } from '../facebookCampaigns';

const LANGUAGES = ['Armenian', 'Malay', 'Filipino', 'German', 'Esperanto', 'Norwegian', 'Persian', 'Traditional Chinese (Taiwan)', 'Turkish'];

async function main() {
  console.log('Testing locale resolution (no campaigns created, safe to run repeatedly)...');
  const results = await resolveAdLocaleIds(LANGUAGES);
  console.log('Final results:', JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
