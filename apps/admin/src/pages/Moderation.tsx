/** Basic review queue: blocked player messages and reported AI lines (Appendix D.5). */
import { useState } from 'react';
import { fmtTime, get, post } from '../api';
import { useLoad } from '../hooks';

interface Event {
  id: number;
  kind: 'blockedPlayerMessage' | 'reportedAiLine';
  playerId: string | null;
  nickname: string | null;
  characterId: string | null;
  text: string;
  reason: string | null;
  status: 'open' | 'resolved';
  createdAt: string;
}

const KINDS = { blockedPlayerMessage: '被拦截的玩家消息', reportedAiLine: '被举报的 AI 台词' };
const REASONS: Record<string, string> = { blocklist: '敏感词', contactInfo: '联系方式', link: '链接', tooLong: '过长', vendor: '审核服务' };

export function Moderation() {
  const [status, setStatus] = useState('open');
  const { data, error, reload } = useLoad<{ events: Event[] }>(() => get(`/moderation?status=${status}`), [status]);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className={status === 'open' ? 'primary' : ''} onClick={() => setStatus('open')}>
          待处理
        </button>
        <button className={status === 'all' ? 'primary' : ''} onClick={() => setStatus('all')}>
          全部
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>玩家</th>
              <th>角色</th>
              <th>内容</th>
              <th>原因</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.events.map((e) => (
              <tr key={e.id}>
                <td>{fmtTime(e.createdAt)}</td>
                <td>{KINDS[e.kind] ?? e.kind}</td>
                <td>{e.nickname ?? e.playerId}</td>
                <td>{e.characterId ?? '—'}</td>
                <td>{e.text}</td>
                <td>{e.reason ? (REASONS[e.reason] ?? e.reason) : '—'}</td>
                <td>{e.status === 'open' ? <button onClick={() => post(`/moderation/${e.id}/resolve`).then(reload)}>标记已处理</button> : <span className="muted">已处理</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.events.length && <p className="muted">没有需要处理的内容</p>}
      </div>
    </>
  );
}
