import fetch from 'node-fetch';

const GRAPH_VERSION = 'v25.0';
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

function getToken(): string {
  const token = process.env.FB_ACCESS_TOKEN;
  if (!token) {
    throw new Error('FB_ACCESS_TOKEN environment variable is not set');
  }
  return token;
}

export interface FbResult<T = any> {
  ok: boolean;
  status: number;
  body: T;
}

async function request<T = any>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  query: Record<string, string> = {}
): Promise<FbResult<T>> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }
  if (!query.access_token) {
    url.searchParams.set('access_token', getToken());
  }

  const res = await fetch(url.toString(), { method });
  const body = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, body };
}

export function fbGet<T = any>(path: string, query: Record<string, string> = {}) {
  return request<T>('GET', path, query);
}

export function fbPost<T = any>(path: string, query: Record<string, string> = {}) {
  return request<T>('POST', path, query);
}

export function fbDelete<T = any>(path: string) {
  return request<T>('DELETE', path);
}

// ---- Domain-specific helpers ----

export interface AdInsightsRow {
  spend?: string;
  actions?: { action_type: string; value: string }[];
  cost_per_action_type?: { action_type: string; value: string }[];
}

export interface AdRow {
  id: string;
  name: string;
  campaign_id?: string;
  created_time?: string;
  effective_status?: string;
  issues_info?: any[];
  insights?: { data?: AdInsightsRow[] };
}

export async function fetchAccountAds(accountId: string): Promise<AdRow[]> {
  const result = await fbGet<{ data?: AdRow[]; error?: any }>(`/act_${accountId}/ads`, {
    fields: 'id,name,campaign_id,created_time,effective_status,issues_info,insights.date_preset(maximum){spend,actions,cost_per_action_type}',
    filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'DISAPPROVED', 'WITH_ISSUES'] }]),
    limit: '200',
  });
  if (!result.ok || result.body.error) {
    console.error(`fetchAccountAds(${accountId}) failed:`, result.body.error || result.status);
    return [];
  }
  return result.body.data || [];
}

export async function pauseAd(adId: string): Promise<FbResult> {
  return fbPost(`/${adId}`, { status: 'PAUSED' });
}

export async function deleteAd(adId: string): Promise<FbResult> {
  return fbDelete(`/${adId}`);
}

export async function deleteCampaign(campaignId: string): Promise<FbResult> {
  return fbDelete(`/${campaignId}`);
}

export interface CampaignRow {
  id: string;
  name: string;
  daily_budget?: string;
  effective_status?: string;
  insights?: { data?: AdInsightsRow[] };
}

export async function fetchAccountCampaigns(accountId: string): Promise<CampaignRow[]> {
  const result = await fbGet<{ data?: CampaignRow[]; error?: any }>(`/act_${accountId}/campaigns`, {
    fields: 'id,name,daily_budget,effective_status,insights.date_preset(maximum){spend,actions}',
    filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
    limit: '200',
  });
  if (!result.ok || result.body.error) {
    console.error(`fetchAccountCampaigns(${accountId}) failed:`, result.body.error || result.status);
    return [];
  }
  return result.body.data || [];
}

export async function updateCampaignBudget(campaignId: string, dailyBudgetMinorUnits: number): Promise<FbResult> {
  return fbPost(`/${campaignId}`, { daily_budget: String(Math.round(dailyBudgetMinorUnits)) });
}
