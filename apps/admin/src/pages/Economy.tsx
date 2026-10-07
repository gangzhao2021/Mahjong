/** Economy configuration (PRD §34): starting coins, reward cycle, tables, private rooms. */
import { useEffect, useState } from 'react';
import { get, put } from '../api';
import { useLoad, useSave } from '../hooks';

interface Table {
  id: string;
  name: string;
  baseScore: number;
  minCoins: number;
  multiplier: number;
}

interface Economy {
  startingCoins: number;
  loginRewards: number[];
  rewardResetHour: number;
  rewardUtcOffsetHours: number;
  tables: Table[];
  privateRoom: { maxBaseRatio: number; maxBase: number; maxHands: number };
}

const num = (v: string) => (v === '' ? 0 : Number(v));

export function Economy() {
  const { data, error } = useLoad<{ economy: Economy }>(() => get('/config'), []);
  const [form, setForm] = useState<Economy | null>(null);
  const save = useSave();
  useEffect(() => {
    if (data) setForm(data.economy);
  }, [data]);
  if (error) return <p className="error">{error}</p>;
  if (!form) return null;

  const setTable = (i: number, patch: Partial<Table>) => setForm({ ...form, tables: form.tables.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

  return (
    <>
      <p className="notice">保存后立即对新开的牌局和新的领取生效；进行中的牌局保持开局时的设置。</p>
      <div className="card">
        <h3>新玩家与每日奖励</h3>
        <div className="grid-form">
          <label htmlFor="start">新玩家金币</label>
          <input id="start" value={form.startingCoins} onChange={(e) => setForm({ ...form, startingCoins: num(e.target.value) })} inputMode="numeric" />
          <span>奖励循环（每天金额）</span>
          <div className="row">
            {form.loginRewards.map((r, i) => (
              <input
                key={i}
                value={r}
                style={{ width: 80 }}
                aria-label={`第 ${i + 1} 天`}
                onChange={(e) => setForm({ ...form, loginRewards: form.loginRewards.map((x, j) => (j === i ? num(e.target.value) : x)) })}
              />
            ))}
            <button onClick={() => setForm({ ...form, loginRewards: [...form.loginRewards, 1000] })}>加一天</button>
            <button disabled={form.loginRewards.length <= 1} onClick={() => setForm({ ...form, loginRewards: form.loginRewards.slice(0, -1) })}>
              减一天
            </button>
          </div>
          <span />
          <span className="muted">只填一天就是固定的每日奖励。错过的天数不清零，领完一轮重新开始。</span>
          <label htmlFor="reset">每日刷新时间（点）</label>
          <input id="reset" value={form.rewardResetHour} onChange={(e) => setForm({ ...form, rewardResetHour: num(e.target.value) })} />
          <label htmlFor="tz">时区（UTC 偏移小时）</label>
          <input id="tz" value={form.rewardUtcOffsetHours} onChange={(e) => setForm({ ...form, rewardUtcOffsetHours: Number(e.target.value) || 0 })} />
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h3>公共场次</h3>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>名称</th>
              <th className="num">底分</th>
              <th className="num">准入金币</th>
              <th className="num">结算倍率</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {form.tables.map((t, i) => (
              <tr key={i}>
                <td>
                  <input value={t.id} onChange={(e) => setTable(i, { id: e.target.value })} style={{ width: 90 }} aria-label="场次 ID" />
                </td>
                <td>
                  <input value={t.name} onChange={(e) => setTable(i, { name: e.target.value })} style={{ width: 100 }} aria-label="名称" />
                </td>
                <td className="num">
                  <input value={t.baseScore} onChange={(e) => setTable(i, { baseScore: num(e.target.value) })} style={{ width: 80 }} aria-label="底分" />
                </td>
                <td className="num">
                  <input value={t.minCoins} onChange={(e) => setTable(i, { minCoins: num(e.target.value) })} style={{ width: 100 }} aria-label="准入金币" />
                </td>
                <td className="num">
                  <input value={t.multiplier} onChange={(e) => setTable(i, { multiplier: Number(e.target.value) || 0 })} style={{ width: 60 }} aria-label="倍率" />
                </td>
                <td>
                  <button onClick={() => setForm({ ...form, tables: form.tables.filter((_, j) => j !== i) })}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button style={{ marginTop: 8 }} onClick={() => setForm({ ...form, tables: [...form.tables, { id: 'new', name: '新场次', baseScore: 10, minCoins: 1000, multiplier: 1 }] })}>
          添加场次
        </button>
        <p className="muted">必须保留一个底分 0、准入 0 的练习场（不结算金币）。</p>
      </div>

      <div className="card">
        <h3>私人房</h3>
        <div className="grid-form">
          <label htmlFor="ratio">底分上限（余额比例）</label>
          <input id="ratio" value={form.privateRoom.maxBaseRatio} onChange={(e) => setForm({ ...form, privateRoom: { ...form.privateRoom, maxBaseRatio: Number(e.target.value) || 0 } })} />
          <label htmlFor="maxbase">底分绝对上限</label>
          <input id="maxbase" value={form.privateRoom.maxBase} onChange={(e) => setForm({ ...form, privateRoom: { ...form.privateRoom, maxBase: num(e.target.value) } })} />
          <label htmlFor="maxhands">最多局数</label>
          <input id="maxhands" value={form.privateRoom.maxHands} onChange={(e) => setForm({ ...form, privateRoom: { ...form.privateRoom, maxHands: num(e.target.value) } })} />
        </div>
      </div>

      <div className="row">
        <button className="primary" disabled={save.busy} onClick={() => save.run(() => put('/config/economy', form))}>
          保存经济设置
        </button>
        {save.message && <span className={save.message.ok ? 'ok' : 'error'}>{save.message.text}</span>}
      </div>
    </>
  );
}
