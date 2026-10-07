/** Player list, search, filters and the player detail drawer (PRD §29–§31, §47). */
import { useState } from 'react';
import { fmt, fmtTime, get, post } from '../api';
import { useLoad, useSave } from '../hooks';

interface PlayerRow {
  id: string;
  nickname: string;
  avatar: string;
  balance: number;
  providers: string[];
  status: 'active' | 'suspended';
  suspendedUntil: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

const PROVIDER_NAMES: Record<string, string> = { guest: '游客', apple: 'Apple', google: 'Google', phone: '手机号', wechat: '微信' };

export function Players() {
  const [filters, setFilters] = useState({ q: '', status: '', provider: '', sort: 'created', page: 0 });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const query = new URLSearchParams({ ...filters, page: String(filters.page) }).toString();
  const { data, error, loading, reload } = useLoad<{ players: PlayerRow[]; total: number; page: number }>(() => get(`/players?${query}`), [query]);

  return (
    <>
      <form
        className="row"
        style={{ marginBottom: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...filters, q: search, page: 0 });
        }}
      >
        <input placeholder="搜索 ID 或昵称" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="primary">搜索</button>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 0 })} aria-label="账号状态">
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="suspended">已封禁</option>
        </select>
        <select value={filters.provider} onChange={(e) => setFilters({ ...filters, provider: e.target.value, page: 0 })} aria-label="登录方式">
          <option value="">全部登录方式</option>
          {Object.entries(PROVIDER_NAMES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })} aria-label="排序">
          <option value="created">按注册时间</option>
          <option value="lastLogin">按最近登录</option>
          <option value="balance">按金币</option>
        </select>
      </form>
      {error && <p className="error">{error}</p>}
      <div className="card" style={{ opacity: loading ? 0.5 : 1, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>玩家</th>
              <th>ID</th>
              <th className="num">金币</th>
              <th>登录方式</th>
              <th>注册时间</th>
              <th>最近登录</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {data?.players.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => setSelected(p.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelected(p.id)}>
                <td>
                  {p.avatar} {p.nickname}
                </td>
                <td className="muted">{p.id}</td>
                <td className="num">{fmt(p.balance)}</td>
                <td>{p.providers.map((x) => PROVIDER_NAMES[x] ?? x).join('、')}</td>
                <td>{fmtTime(p.createdAt)}</td>
                <td>{fmtTime(p.lastLoginAt)}</td>
                <td>{p.status === 'suspended' ? <span className="badge bad">封禁{p.suspendedUntil ? `至 ${fmtTime(p.suspendedUntil)}` : '（永久）'}</span> : <span className="badge">正常</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && (
          <div className="row" style={{ marginTop: 12 }}>
            <span className="muted">共 {fmt(data.total)} 人</span>
            <button disabled={filters.page === 0} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>
              上一页
            </button>
            <button disabled={(filters.page + 1) * 50 >= data.total} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>
              下一页
            </button>
          </div>
        )}
      </div>
      {selected && (
        <PlayerDrawer
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={reload}
        />
      )}
    </>
  );
}

interface Detail {
  player: PlayerRow & { suspensionReason: string | null; realNameVerified: boolean };
  ledger: { id: number; type: string; amount: number; balanceAfter: number; createdAt: string; meta: { reason?: string } | null }[];
  memory: {
    relationships: { character_id: string; games_together: number; dealt_in_by_player: number; dealt_in_to_player: number; rivalry: number; grudge_reason: string | null }[];
    events: { id: number; characterId: string | null; kind: string; summary: string }[];
    profile: { play_style: string | null; hands_played: number; games_played: number } | null;
  };
}

const LEDGER_TYPES: Record<string, string> = { startingCoins: '新手金币', handSettlement: '牌局结算', loginReward: '每日奖励', adminAdjustment: '后台调整' };

function PlayerDrawer({ id, onClose, onChanged }: { id: string; onClose(): void; onChanged(): void }) {
  const { data, error, reload } = useLoad<Detail>(() => get(`/players/${id}`), [id]);
  const roster = useLoad<{ characters: { id: string; name: string; avatar: string }[] }>(() => get('/roster'), []);
  const nameOf = (characterId: string | null) => {
    if (!characterId) return '所有角色';
    const c = roster.data?.characters.find((x) => x.id === characterId);
    return c ? `${c.avatar} ${c.name}` : characterId;
  };
  const save = useSave();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('1d');
  const [hours, setHours] = useState('48');
  const [banReason, setBanReason] = useState('');

  const refresh = () => {
    reload();
    onChanged();
  };

  return (
    <div className="drawer" role="dialog" aria-label="玩家详情">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{data ? `${data.player.avatar} ${data.player.nickname}` : '玩家详情'}</h2>
        <button onClick={onClose}>关闭</button>
      </div>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <div className="card">
            <div className="grid-form">
              <span className="secondary">ID</span>
              <span>{data.player.id}</span>
              <span className="secondary">金币</span>
              <strong>{fmt(data.player.balance)}</strong>
              <span className="secondary">登录方式</span>
              <span>{data.player.providers.map((x) => PROVIDER_NAMES[x] ?? x).join('、')}</span>
              <span className="secondary">实名认证</span>
              <span>{data.player.realNameVerified ? '已认证' : '未认证'}</span>
              <span className="secondary">注册 / 最近登录</span>
              <span>
                {fmtTime(data.player.createdAt)} / {fmtTime(data.player.lastLoginAt)}
              </span>
              <span className="secondary">状态</span>
              <span>
                {data.player.status === 'suspended' ? `封禁${data.player.suspendedUntil ? `至 ${fmtTime(data.player.suspendedUntil)}` : '（永久）'}` : '正常'}
                {data.player.suspensionReason ? `（${data.player.suspensionReason}）` : ''}
              </span>
            </div>
          </div>

          {save.message && <p className={save.message.ok ? 'ok' : 'error'}>{save.message.text}</p>}

          <div className="card">
            <h3>调整金币</h3>
            <div className="row">
              <input placeholder="金额（负数为扣除）" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, ''))} inputMode="numeric" />
              <input placeholder="原因（必填）" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1 }} />
              <button
                className="primary"
                disabled={save.busy || !reason.trim() || !Number(amount)}
                onClick={async () => {
                  if (await save.run(() => post(`/players/${id}/coins`, { amount: Number(amount), reason }), '金币已调整，已记入日志')) {
                    setAmount('');
                    setReason('');
                    refresh();
                  }
                }}
              >
                确认调整
              </button>
            </div>
            <p className="muted">扣除超过余额时只扣到 0。每次调整都会记录调整前后余额和原因。</p>
          </div>

          <div className="card">
            <h3>封禁</h3>
            {data.player.status === 'suspended' ? (
              <button onClick={() => save.run(() => post(`/players/${id}/unsuspend`), '已解封').then(refresh)}>解除封禁</button>
            ) : (
              <div className="row">
                <select value={duration} onChange={(e) => setDuration(e.target.value)} aria-label="封禁时长">
                  <option value="1d">1 天</option>
                  <option value="7d">7 天</option>
                  <option value="custom">自定义（小时）</option>
                  <option value="permanent">永久</option>
                </select>
                {duration === 'custom' && <input value={hours} onChange={(e) => setHours(e.target.value.replace(/\D/g, ''))} style={{ width: 80 }} aria-label="小时数" />}
                <input placeholder="原因（选填，玩家看不到）" value={banReason} onChange={(e) => setBanReason(e.target.value)} style={{ flex: 1 }} />
                <button
                  className="danger"
                  disabled={save.busy}
                  onClick={() =>
                    save
                      .run(
                        () => post(`/players/${id}/suspend`, { duration: duration === 'custom' ? 'custom' : duration, hours: Number(hours), reason: banReason }),
                        '已封禁，玩家已被踢下线',
                      )
                      .then(refresh)
                  }
                >
                  封禁
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <h3>AI 记忆</h3>
            {data.memory.profile && (
              <p className="secondary">
                打了 {data.memory.profile.hands_played} 手 / {data.memory.profile.games_played} 场
                {data.memory.profile.play_style ? `；画像：${data.memory.profile.play_style}` : ''}
              </p>
            )}
            <table>
              <thead>
                <tr>
                  <th>角色</th>
                  <th className="num">同桌场数</th>
                  <th className="num">玩家点炮</th>
                  <th className="num">点炮给玩家</th>
                  <th className="num">对手程度</th>
                  <th>记仇</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.memory.relationships.map((r) => (
                  <tr key={r.character_id}>
                    <td>{nameOf(r.character_id)}</td>
                    <td className="num">{r.games_together}</td>
                    <td className="num">{r.dealt_in_by_player}</td>
                    <td className="num">{r.dealt_in_to_player}</td>
                    <td className="num">{r.rivalry.toFixed(2)}</td>
                    <td>{r.grudge_reason ?? '—'}</td>
                    <td>
                      <button onClick={() => save.run(() => post(`/players/${id}/memory/reset`, { characterId: r.character_id }), '已清除').then(reload)}>清除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul>
              {data.memory.events.slice(-20).map((e) => (
                <li key={e.id}>
                  <span className="muted">{nameOf(e.characterId)}：</span>
                  {e.summary}
                </li>
              ))}
            </ul>
            <button className="danger" onClick={() => save.run(() => post(`/players/${id}/memory/reset`), '已清除该玩家的全部 AI 记忆').then(reload)}>
              清除全部 AI 记忆
            </button>
          </div>

          <div className="card">
            <h3>金币记录</h3>
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th className="num">变动</th>
                  <th className="num">余额</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {data.ledger.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtTime(e.createdAt)}</td>
                    <td>{LEDGER_TYPES[e.type] ?? e.type}</td>
                    <td className="num">
                      {e.amount > 0 ? '+' : ''}
                      {fmt(e.amount)}
                    </td>
                    <td className="num">{fmt(e.balanceAfter)}</td>
                    <td className="muted">{e.meta?.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
