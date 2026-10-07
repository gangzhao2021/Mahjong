/** Admin API client. The session is an HttpOnly cookie set by /admin/api/login. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly problems: string[] = [],
  ) {
    super(problems.length ? problems.join('；') : code);
  }
}

let onUnauthorized: () => void = () => undefined;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/admin/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (res.status === 401 && path !== '/login') onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, json.error ?? 'serverError', json.problems ?? []);
  return json as T;
}

export const get = <T = any>(path: string) => request<T>('GET', path);
export const post = <T = any>(path: string, body: unknown = {}) => request<T>('POST', path, body);
export const put = <T = any>(path: string, body: unknown) => request<T>('PUT', path, body);
export const del = <T = any>(path: string) => request<T>('DELETE', path);

export const ERROR_TEXT: Record<string, string> = {
  invalidCredentials: '用户名、密码或验证码错误',
  lockedOut: '失败次数过多，请 15 分钟后再试',
  ipNotAllowed: '当前 IP 不允许访问后台',
  adminNotConfigured: '后台未配置：请设置 ADMIN_USERNAME、ADMIN_PASSWORD_HASH、ADMIN_TOTP_SECRET',
  reasonRequired: '必须填写原因',
  invalidAmount: '金额必须是非零整数',
  invalidDuration: '时长无效',
  personalityInUse: '还有角色在使用这个性格，请先修改或删除这些角色',
  invalidRange: '日期范围无效（最长一年）',
  notFound: '找不到',
  serverError: '服务器出错了',
};

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.problems.length ? e.problems.join('；') : (ERROR_TEXT[e.code] ?? e.code);
  return '网络错误';
}

export const fmt = (n: number) => n.toLocaleString('zh-CN');
export const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—');
