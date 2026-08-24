import { getActiveAccounts, RULES, AUTO_DELETE_DISAPPROVED_ADS } from '../config';
import { fetchAccountAds, pauseAd, deleteAd, deleteCampaign, AdRow } from '../facebook';
import { sendTelegramMessage } from '../telegram';

interface Evaluated {
  ad_id: string;
  ad_name: string;
  campaign_id: string | null;
  shouldPause: boolean;
  shouldDelete: boolean;
  reason: string | null;
  lpvCost: number | null;
  spend: number;
  ageDays: number;
  hasSubscription: boolean;
  subscribeCount: number;
  subscribeCost: number | null;
}

function evaluateAd(row: AdRow): Evaluated {
  const effectiveStatus = row.effective_status || null;
  const issues = row.issues_info || [];
  const shouldDeleteModeration = AUTO_DELETE_DISAPPROVED_ADS && (effectiveStatus === 'DISAPPROVED' || issues.length > 0);

  if (shouldDeleteModeration) {
    return {
      ad_id: row.id,
      ad_name: row.name,
      campaign_id: row.campaign_id || null,
      shouldPause: false,
      shouldDelete: true,
      reason: effectiveStatus === 'DISAPPROVED' ? 'disapproved' : 'has_issues',
      lpvCost: null,
      spend: 0,
      ageDays: 0,
      hasSubscription: false,
      subscribeCount: 0,
      subscribeCost: null,
    };
  }

  const insightsRow = row.insights?.data?.[0] || {};
  const actions = insightsRow.actions || [];
  const costs = insightsRow.cost_per_action_type || [];
  const spend = parseFloat(insightsRow.spend || '0');
  const subscribeAction = actions.find(a => a.action_type === 'subscribe_website');
  const lpvCostEntry = costs.find(c => c.action_type === 'landing_page_view');
  const lpvCost = lpvCostEntry ? parseFloat(lpvCostEntry.value) : null;
  const subscribeCount = subscribeAction ? parseFloat(subscribeAction.value) : 0;
  const hasSubscription = subscribeCount > 0;

  const createdTime = row.created_time ? new Date(row.created_time).getTime() : null;
  const ageDays = createdTime ? (Date.now() - createdTime) / (1000 * 60 * 60 * 24) : 0;
  const graceElapsed = ageDays >= RULES.graceAgeDays && spend >= RULES.graceMinSpend;

  const hardKill = lpvCost !== null && lpvCost > RULES.hardKillLpvCost && !hasSubscription;
  const softKill = graceElapsed && lpvCost !== null && lpvCost > RULES.softKillLpvCost && !hasSubscription;
  const subscribeCost = hasSubscription ? spend / subscribeCount : null;
  const subscribeCostKill = graceElapsed && hasSubscription && subscribeCost !== null && subscribeCost > RULES.softKillSubscribeCost;
  // Immediate kill: lifetime spend > $10 with zero subscriptions ever -- no age wait needed.
  const zeroSubsKill = spend > 10 && !hasSubscription;

  const shouldPause = hardKill || softKill || subscribeCostKill || zeroSubsKill;
  let reason: string | null = null;
  if (hardKill) reason = 'hard_kill_lpv';
  else if (softKill) reason = 'soft_kill_lpv_after_grace';
  else if (subscribeCostKill) reason = 'soft_kill_subscribe_cost_after_grace';
  else if (zeroSubsKill) reason = 'zero_subscriptions_spend_over_10';

  return {
    ad_id: row.id,
    ad_name: row.name,
    campaign_id: row.campaign_id || null,
    shouldPause,
    shouldDelete: false,
    reason,
    lpvCost,
    spend,
    ageDays: Math.round(ageDays * 10) / 10,
    hasSubscription,
    subscribeCount,
    subscribeCost: subscribeCost !== null ? Math.round(subscribeCost * 100) / 100 : null,
  };
}

async function processAccount(accountId: string, label: string) {
  const ads = await fetchAccountAds(accountId);
  if (ads.length === 0) return;

  const evaluated = ads.map(evaluateAd);

  // Group by campaign to check for full-campaign deletion (only relevant if AUTO_DELETE_DISAPPROVED_ADS is on)
  const byCampaign: Record<string, Evaluated[]> = {};
  for (const e of evaluated) {
    if (!e.campaign_id) continue;
    (byCampaign[e.campaign_id] ||= []).push(e);
  }
  const fullyBadCampaigns = new Set(
    Object.entries(byCampaign)
      .filter(([, group]) => group.length > 0 && group.every(a => a.shouldDelete))
      .map(([cid]) => cid)
  );

  for (const e of evaluated) {
    try {
      if (e.shouldDelete) {
        const res = await deleteAd(e.ad_id);
        if (res.ok) {
          console.log(`[${label}] Deleted disapproved ad ${e.ad_id} (${e.ad_name}) -- ${e.reason}`);
        } else {
          console.warn(`[${label}] Failed to delete ad ${e.ad_id}:`, res.body?.error?.message || res.status);
        }
        continue;
      }
      if (e.shouldPause) {
        const res = await pauseAd(e.ad_id);
        if (res.ok) {
          console.log(`[${label}] Paused ad ${e.ad_id} (${e.ad_name}) -- ${e.reason} (LPV $${e.lpvCost}, sub cost $${e.subscribeCost})`);
          await sendTelegramMessage(
            `⏸ <b>${label}</b>\nОбъявление выключено: ${e.ad_name}\nПричина: ${e.reason}\nЦена ПДП: $${e.lpvCost ?? '-'}  Цена подписки: $${e.subscribeCost ?? '-'}`
          );
        } else {
          console.warn(`[${label}] Failed to pause ad ${e.ad_id}:`, res.body?.error?.message || res.status);
        }
      }
    } catch (err) {
      console.error(`[${label}] Error processing ad ${e.ad_id}:`, err);
    }
  }

  if (AUTO_DELETE_DISAPPROVED_ADS) {
    for (const cid of fullyBadCampaigns) {
      try {
        const res = await deleteCampaign(cid);
        console.log(`[${label}] Deleted fully-bad campaign ${cid}: ${res.ok ? 'ok' : res.body?.error?.message}`);
      } catch (err) {
        console.error(`[${label}] Error deleting campaign ${cid}:`, err);
      }
    }
  }
}

async function main() {
  const accounts = getActiveAccounts();
  console.log(`Starting auto-pause run for ${accounts.length} active accounts...`);
  for (const acc of accounts) {
    try {
      await processAccount(acc.accountId, acc.label);
    } catch (err) {
      console.error(`Account ${acc.label} (${acc.accountId}) failed entirely:`, err);
    }
  }
  console.log('Auto-pause run complete.');
}

main().catch(err => {
  console.error('Fatal error in auto-pause job:', err);
  process.exit(1);
});
