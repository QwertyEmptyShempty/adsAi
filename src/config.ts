// Account configuration -- equivalent of the n8n "accounts_config" Data Table.
// Edit this list directly (via git) to add/remove/disable accounts.
// Secrets (FB token, Telegram token) come from environment variables, never from this file.

export interface AccountConfig {
  accountId: string;
  label: string;
  active: boolean;
  destinationUrl: string;
  preferredPixelId: string | null;
  preferredPageId: string | null;
  dailyBudgetMinorUnits: number;
  notes?: string;
}

export const FINANS_DUNYASI_PAGE_ID = '162691913591302';

export const accounts: AccountConfig[] = [
  { accountId: '1785894395737168', label: 'ADAP 6', active: true, destinationUrl: 'https://edgmete.top/l/7VVn65Eo/?b=6735&pixel=__PIXEL_ID__&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&campaign_name={{campaign.name}}&adset_name={{adset.name}}&ad_name={{ad.name}}&placement={{placement}}&site_source_name={{site_source_name}}', preferredPixelId: null, preferredPageId: FINANS_DUNYASI_PAGE_ID, dailyBudgetMinorUnits: 6000 },
  { accountId: '2107602803304105', label: '01473 Luna-03', active: false, destinationUrl: '', preferredPixelId: null, preferredPageId: null, dailyBudgetMinorUnits: 6000, notes: 'disabled account on Facebook' },
  { accountId: '1552629889693455', label: 'Стрылец 14 (L3)', active: true, destinationUrl: 'https://edgmete.top/l/7VVn65Eo/?b=6735&pixel=__PIXEL_ID__&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&campaign_name={{campaign.name}}&adset_name={{adset.name}}&ad_name={{ad.name}}&placement={{placement}}&site_source_name={{site_source_name}}', preferredPixelId: null, preferredPageId: FINANS_DUNYASI_PAGE_ID, dailyBudgetMinorUnits: 6000 },
  { accountId: '1570672514652984', label: 'ADAP 5', active: true, destinationUrl: 'https://edgmete.top/l/7VVn65Eo/?b=6735&pixel=__PIXEL_ID__&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&campaign_name={{campaign.name}}&adset_name={{adset.name}}&ad_name={{ad.name}}&placement={{placement}}&site_source_name={{site_source_name}}', preferredPixelId: null, preferredPageId: FINANS_DUNYASI_PAGE_ID, dailyBudgetMinorUnits: 6000 },
  { accountId: '2241757776677642', label: '01473 Luna-01', active: false, destinationUrl: '', preferredPixelId: null, preferredPageId: null, dailyBudgetMinorUnits: 6000, notes: 'disabled account on Facebook' },
  { accountId: '1048879194391618', label: 'TK ok_455475_2', active: false, destinationUrl: '', preferredPixelId: null, preferredPageId: null, dailyBudgetMinorUnits: 6000 },
  { accountId: '1193539559596579', label: 'Yaroslaf 1', active: false, destinationUrl: '', preferredPixelId: null, preferredPageId: null, dailyBudgetMinorUnits: 6000 },
  { accountId: '1462289552371336', label: 'TK ok_210658_3', active: false, destinationUrl: '', preferredPixelId: null, preferredPageId: null, dailyBudgetMinorUnits: 6000 },
  { accountId: '1825618255067356', label: '01473 Luna-02', active: true, destinationUrl: 'https://edgmete.top/l/7VVn65Eo/?b=6735&pixel=__PIXEL_ID__&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&campaign_name={{campaign.name}}&adset_name={{adset.name}}&ad_name={{ad.name}}&placement={{placement}}&site_source_name={{site_source_name}}', preferredPixelId: null, preferredPageId: FINANS_DUNYASI_PAGE_ID, dailyBudgetMinorUnits: 6000 },
  { accountId: '2830116280699672', label: 'ADAP 4', active: false, destinationUrl: '', preferredPixelId: null, preferredPageId: null, dailyBudgetMinorUnits: 6000, notes: 'disabled account on Facebook' },
  { accountId: '1224029273183477', label: 'Стрылец 15 (L3)', active: false, destinationUrl: '', preferredPixelId: null, preferredPageId: null, dailyBudgetMinorUnits: 6000, notes: 'Disabled by Facebook (account_status=2, ADS_INTEGRITY_POLICY)' },
  { accountId: '3228098154045162', label: '01473 Luna-09', active: false, destinationUrl: '', preferredPixelId: null, preferredPageId: null, dailyBudgetMinorUnits: 6000, notes: 'token access pending' },
  { accountId: '1058198873572693', label: '01473 Luna-10', active: true, destinationUrl: 'https://edgmete.top/l/7VVn65Eo/?b=6735&pixel=__PIXEL_ID__&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&campaign_name={{campaign.name}}&adset_name={{adset.name}}&ad_name={{ad.name}}&placement={{placement}}&site_source_name={{site_source_name}}', preferredPixelId: null, preferredPageId: FINANS_DUNYASI_PAGE_ID, dailyBudgetMinorUnits: 6000 },
  { accountId: '2287041015373080', label: '01473 Luna-13', active: true, destinationUrl: 'https://edgmete.top/l/7VVn65Eo/?b=6735&pixel=__PIXEL_ID__&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&campaign_name={{campaign.name}}&adset_name={{adset.name}}&ad_name={{ad.name}}&placement={{placement}}&site_source_name={{site_source_name}}', preferredPixelId: null, preferredPageId: FINANS_DUNYASI_PAGE_ID, dailyBudgetMinorUnits: 6000 },
];

export function getActiveAccounts(): AccountConfig[] {
  return accounts.filter(a => a.active);
}

// Auto-pause / auto-delete thresholds
export const RULES = {
  hardKillLpvCost: 13,          // pause immediately if cost per landing_page_view >= this, and no subscription
  softKillLpvCost: 5,           // pause after grace period if cost per LPV > this, and no subscription
  softKillSubscribeCost: 10,    // pause after grace period if cost per subscription > this
  graceAgeDays: 3,
  graceMinSpend: 45,
};

// AUTO_DELETE_DISAPPROVED_ADS: keep this false unless explicitly re-enabled (user turned it off 17.08).
export const AUTO_DELETE_DISAPPROVED_ADS = false;
