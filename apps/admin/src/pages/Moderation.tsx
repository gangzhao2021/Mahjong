/** Basic review queue: blocked player messages, reported lines and chat-suspended players (Appendix D.5). */
import { useState } from 'react';
import { fmtTime, get, post } from '../api';
import { useLoad } from '../hooks';

interface Event {
  id: number;
  kind: 'blockedPlayerMessage' | 'reportedAiLine' | 'reportedPlayerLine';
  playerId: string | null;
  nickname: string | null;
  characterId: string | null;
  text: string;
  reason: string | null;
  status: 'open' | 'resolved';
  createdAt: string;
}

const KINDS = { blockedPlayerMessage: '被拦截的玩家消息', reportedAiLine: '被举报的 AI 台词', reportedPlayerLine: '被举报的玩家发言（好友房）' };
const REASONS: Record<string, string> = { blocklist: '敏感词', contactInfo: '联系方式', link: '链接', tooLong: '过长', vendor: '审核服务' };

function ChatSuspensions() {
  const { data, error, reload } = useLoad<{ players: { playerId: string; nickname: string; until: string }[] }>(() => get('/chat-suspensions'), []);
  if (error) return <p className="error">{error}</p>;
  if (!data?.players.length) return null;
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <h3>聊天暂停中的玩家</h3>
      <table>
        <thead>
          <tr>
            <th>玩家</th>
            <th>暂停到</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.players.map((p) => (
            <tr key={p.playerId}>
              <td>{p.nickname}</td>
              <td>{fmtTime(p.until)}</td>
              <td>
                <button onClick={() => post(`/players/${p.playerId}/chat-suspension/lift`).then(reload)}>解除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Moderation() {
  const [status, setStatus] = useState('open');
  const { data, error, reload } = useLoad<{ events: Event[] }>(() => get(`/moderation?status=${status}`), [status]);
  return (
    <>
      <ChatSuspensions />
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
                <td>{e.reason ? (e.reason.startsWith('reportedBy:') ? `举报人 ${e.reason.slice('reportedBy:'.length)}` : (REASONS[e.reason] ?? e.reason)) : '—'}</td>
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
