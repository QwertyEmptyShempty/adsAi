import { getActiveAccounts } from '../config';
import { fbGet } from '../facebook';

interface AdInsightsRow {
  spend?: string;
  actions?: { action_type: string; value: string }[];
}

interface CreativeInfo {
  object_story_spec?: { video_data?: any };
  asset_feed_spec?: { ad_formats?: string[]; videos?: any[] };
}

interface AdRow {
  id: string;
  name: string;
  campaign_id?: string;
  creative?: CreativeInfo;
  insights?: { data?: AdInsightsRow[] };
}

interface Result {
  accountLabel: string;
  ad_id: string;
  ad_name: string;
  spend: number;
  subscribeCount: number;
  subscribeCost: number | null; // null means 0 subscriptions (effectively worst)
}

function isVideoAd(row: AdRow): boolean {
  const spec = row.creative?.object_story_spec || {};
  const feedSpec = row.creative?.asset_feed_spec || {};
  const isLegacyVideo = !!spec.video_data;
  const isDynamicVideo =
    (feedSpec.ad_formats || []).some(f => String(f).toUpperCase().includes('VIDEO')) ||
    (Array.isArray(feedSpec.videos) && feedSpec.videos.length > 0);
  return isLegacyVideo || isDynamicVideo;
}

async function fetchAccountVideoAds(accountId: string, label: string): Promise<Result[]> {
  const res = await fbGet<{ data?: AdRow[]; error?: any }>(`/act_${accountId}/ads`, {
    fields: 'id,name,campaign_id,creative{id,object_story_spec,asset_feed_spec{ad_formats,videos}},insights.date_preset(maximum){spend,actions}',
    filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'DISAPPROVED', 'WITH_ISSUES'] }]),
    limit: '500',
  });
  if (!res.ok || res.body.error) {
    console.error(`[${label}] fetch failed:`, JSON.stringify(res.body.error));
    return [];
  }
  const ads = res.body.data || [];
  const results: Result[] = [];
  for (const ad of ads) {
    if (!isVideoAd(ad)) continue;
    const insightsRow = ad.insights?.data?.[0] || {};
    const spend = parseFloat(insightsRow.spend || '0');
    if (spend === 0) continue; // no data to judge
    const actions = insightsRow.actions || [];
    const subscribeAction = actions.find(a => a.action_type === 'subscribe_website');
    const subscribeCount = subscribeAction ? parseFloat(subscribeAction.value) : 0;
    const subscribeCost = subscribeCount > 0 ? spend / subscribeCount : null;
    results.push({ accountLabel: label, ad_id: ad.id, ad_name: ad.name, spend, subscribeCount, subscribeCost });
  }
  return results;
}

async function main() {
  const accounts = getActiveAccounts();
  console.log(`Analyzing video ads across ${accounts.length} active accounts (lifetime data)...`);
  let all: Result[] = [];
  for (const acc of accounts) {
    try {
      const results = await fetchAccountVideoAds(acc.accountId, acc.label);
      all = all.concat(results);
      console.log(`[${acc.label}] ${results.length} video ads with spend data.`);
    } catch (err) {
      console.error(`[${acc.label}] error:`, err);
    }
  }

  // Sort: ads with 0 subscriptions (subscribeCost === null) are "worst" -- sort by spend desc among those first,
  // then ads with a real subscribeCost, sorted descending (highest cost = worst).
  const zeroSubs = all.filter(r => r.subscribeCost === null).sort((a, b) => b.spend - a.spend);
  const withSubs = all.filter(r => r.subscribeCost !== null).sort((a, b) => (b.subscribeCost as number) - (a.subscribeCost as number));

  console.log('\n=== WORST VIDEO ADS (0 subscriptions, sorted by spend wasted) ===');
  for (const r of zeroSubs.slice(0, 10)) {
    console.log(`[${r.accountLabel}] "${r.ad_name}" (${r.ad_id}) -- spend $${r.spend.toFixed(2)}, 0 subscriptions`);
  }

  console.log('\n=== WORST VIDEO ADS (highest cost per subscription) ===');
  for (const r of withSubs.slice(0, 10)) {
    console.log(`[${r.accountLabel}] "${r.ad_name}" (${r.ad_id}) -- $${(r.subscribeCost as number).toFixed(2)}/sub, spend $${r.spend.toFixed(2)}, ${r.subscribeCount} subs`);
  }

  console.log('\nAnalysis complete.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
