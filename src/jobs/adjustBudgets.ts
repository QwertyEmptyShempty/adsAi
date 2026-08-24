import { getActiveAccounts } from '../config';
import { fetchAccountCampaigns, updateCampaignBudget, CampaignRow } from '../facebook';
import { sendTelegramMessage } from '../telegram';

// Safety caps -- 10% every 4h could compound unboundedly over days/weeks without a ceiling/floor.
const MIN_BUDGET_MINOR_UNITS = 1000; // $10/day floor
const MAX_BUDGET_MINOR_UNITS = 30000; // $300/day ceiling
const INCREASE_THRESHOLD = 3; // subscribe cost < $3 -> increase budget 10%
const DECREASE_THRESHOLD = 7; // subscribe cost > $7 -> decrease budget 10%
const CHANGE_PCT = 0.10;

function evaluateCampaign(row: CampaignRow): { subscribeCost: number | null; spend: number; subscribeCount: number } {
  const insightsRow = row.insights?.data?.[0] || {};
  const actions = insightsRow.actions || [];
  const spend = parseFloat(insightsRow.spend || '0');
  const subscribeAction = actions.find(a => a.action_type === 'subscribe_website');
  const subscribeCount = subscribeAction ? parseFloat(subscribeAction.value) : 0;
  const subscribeCost = subscribeCount > 0 ? spend / subscribeCount : null;
  return { subscribeCost, spend, subscribeCount };
}

async function processAccount(accountId: string, label: string) {
  const campaigns = await fetchAccountCampaigns(accountId);
  if (campaigns.length === 0) return;

  for (const row of campaigns) {
    try {
      const { subscribeCost, spend, subscribeCount } = evaluateCampaign(row);
      if (subscribeCost === null) continue; // no subscriptions yet -- nothing to base a budget change on

      const currentBudget = row.daily_budget ? parseInt(row.daily_budget, 10) : null;
      if (currentBudget === null || isNaN(currentBudget)) continue;

      let direction: 'up' | 'down' | null = null;
      if (subscribeCost < INCREASE_THRESHOLD) direction = 'up';
      else if (subscribeCost > DECREASE_THRESHOLD) direction = 'down';
      if (!direction) continue;

      let newBudget = direction === 'up'
        ? currentBudget * (1 + CHANGE_PCT)
        : currentBudget * (1 - CHANGE_PCT);
      newBudget = Math.max(MIN_BUDGET_MINOR_UNITS, Math.min(MAX_BUDGET_MINOR_UNITS, newBudget));

      if (Math.round(newBudget) === currentBudget) continue; // already at a cap, nothing to do

      const res = await updateCampaignBudget(row.id, newBudget);
      if (res.ok) {
        console.log(`[${label}] Budget ${direction === 'up' ? 'increased' : 'decreased'} for "${row.name}": $${(currentBudget / 100).toFixed(2)} -> $${(newBudget / 100).toFixed(2)} (sub cost $${subscribeCost.toFixed(2)}, ${subscribeCount} subs, spend $${spend.toFixed(2)})`);
        await sendTelegramMessage(
          `${direction === 'up' ? '📈' : '📉'} <b>${label}</b>\n${row.name}\nЦена подписки: $${subscribeCost.toFixed(2)}\nБюджет: $${(currentBudget / 100).toFixed(2)} → $${(newBudget / 100).toFixed(2)}`
        );
      } else {
        console.warn(`[${label}] Failed to update budget for ${row.id}:`, JSON.stringify((res.body as any)?.error));
      }
    } catch (err) {
      console.error(`[${label}] Error processing campaign ${row.id}:`, err);
    }
  }
}

async function main() {
  const accounts = getActiveAccounts();
  console.log(`Starting budget-adjustment run for ${accounts.length} active accounts...`);
  for (const acc of accounts) {
    try {
      await processAccount(acc.accountId, acc.label);
    } catch (err) {
      console.error(`Account ${acc.label} (${acc.accountId}) failed entirely:`, err);
    }
  }
  console.log('Budget-adjustment run complete.');
}

main().catch(err => {
  console.error('Fatal error in adjust-budgets job:', err);
  process.exit(1);
});
