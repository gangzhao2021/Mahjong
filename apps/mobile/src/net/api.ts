/** HTTP API client for accounts and economy. */
import type { AccountSummary, BanterLevel, CharacterRelation, HandHistoryEntry, HandReplay, LoginMethod, PlayerStats, ServerInfo, AchievementsStatus } from '@mahjong/protocol';
import { SERVER_HTTP } from '../config';
import { getLocale } from '../strings';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_HTTP}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) throw new ApiError(res.status, String(json.error ?? 'serverError'), json);
  return json as T;
}

export interface LedgerEntry {
  id: number;
  type: 'startingCoins' | 'handSettlement' | 'loginReward' | 'taskReward' | 'achievementReward' | 'adminAdjustment';
  amount: number;
  balanceAfter: number;
  createdAt: string;
}

type Session = { token: string; account: AccountSummary };
type AccountOnly = { account: AccountSummary };

export const api = {
  config: () => request<ServerInfo>('GET', '/config'),
  login: (method: LoginMethod, credentials: Record<string, unknown>) => request<Session>('POST', `/auth/${method}`, { ...credentials, locale: getLocale() }),
  sendSmsCode: (phone: string) => request<{ ok: true }>('POST', '/auth/sms/send', { phone }),
  account: (token: string) => request<AccountOnly>('GET', '/account', undefined, token),
  updateProfile: (token: string, patch: { nickname?: string; avatar?: string; banterLevel?: BanterLevel }) =>
    request<AccountOnly>('PATCH', '/account', patch, token),
  link: (token: string, method: LoginMethod, credentials: Record<string, unknown>) =>
    request<AccountOnly>('POST', `/account/link/${method}`, credentials, token),
  realName: (token: string, name: string, idNumber: string) => request<AccountOnly>('POST', '/account/real-name', { name, idNumber }, token),
  claimReward: (token: string) => request<{ amount: number; account: AccountSummary }>('POST', '/rewards/claim', {}, token),
  ledger: (token: string) => request<{ entries: LedgerEntry[] }>('GET', '/ledger?limit=50', undefined, token),
  history: (token: string) => request<{ hands: HandHistoryEntry[] }>('GET', '/history', undefined, token),
  replay: (token: string, gameId: string, handIndex: number) => request<HandReplay>('GET', `/history/${encodeURIComponent(gameId)}/${handIndex}`, undefined, token),
  relationships: (token: string) => request<{ relations: CharacterRelation[] }>('GET', '/relationships', undefined, token),
  achievements: (token: string) => request<AchievementsStatus>('GET', '/achievements', undefined, token),
  claimAchievement: (token: string, id: string) =>
    request<{ amount: number; achievements: AchievementsStatus; account: AccountSummary }>('POST', '/achievements/claim', { id }, token),
  stats: (token: string) => request<PlayerStats>('GET', '/stats', undefined, token),
  deleteAccount: (token: string) => request<Record<string, never>>('DELETE', '/account', undefined, token),
};
