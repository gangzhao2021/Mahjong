/** Log of every manual coin adjustment (PRD §30). */
import { fmt, fmtTime, get } from '../api';
import { useLoad } from '../hooks';

interface Adjustment {
  id: number;
  playerId: string;
  nickname: string | null;
  previousBalance: number | null;
  amount: number;
  newBalance: number;
  reason: string;
  createdAt: string;
}

export function CoinLog() {
  const { data, error } = useLoad<{ adjustments: Adjustment[] }>(() => get('/coin-adjustments'), []);
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>玩家</th>
            <th className="num">调整前</th>
            <th className="num">调整</th>
            <th className="num">调整后</th>
            <th>原因</th>
          </tr>
        </thead>
        <tbody>
          {data?.adjustments.map((a) => (
            <tr key={a.id}>
              <td>{fmtTime(a.createdAt)}</td>
              <td>
                {a.nickname ?? '（已注销）'} <span className="muted">{a.playerId}</span>
              </td>
              <td className="num">{a.previousBalance === null ? '—' : fmt(a.previousBalance)}</td>
              <td className="num">
                {a.amount > 0 ? '+' : ''}
                {fmt(a.amount)}
              </td>
              <td className="num">{fmt(a.newBalance)}</td>
              <td>{a.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && !data.adjustments.length && <p className="muted">还没有调整记录</p>}
    </div>
  );
}
