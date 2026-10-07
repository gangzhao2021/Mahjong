/** Client crash reports grouped by fingerprint (PRD §50 Phase 6). */
import { useState } from 'react';
import { fmt, fmtTime, get } from '../api';
import { useLoad } from '../hooks';

interface Group {
  fingerprint: string;
  message: string;
  count: number;
  players: number;
  lastSeen: string;
  platforms: string[];
  versions: string[];
  stack: string | null;
}

export function Crashes() {
  const [days, setDays] = useState(7);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error } = useLoad<{ groups: Group[] }>(() => get(`/crashes?days=${days}`), [days]);
  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        {[1, 7, 30].map((d) => (
          <button key={d} className={days === d ? 'primary' : ''} onClick={() => setDays(d)}>
            {d === 1 ? '24 小时' : `${d} 天`}
          </button>
        ))}
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        {error && <p className="error">{error}</p>}
        {data && data.groups.length === 0 && <p className="muted">这段时间没有崩溃报告。</p>}
        {data && data.groups.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>错误</th>
                <th>次数</th>
                <th>玩家数</th>
                <th>平台</th>
                <th>版本</th>
                <th>最近一次</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) => (
                <tr key={g.fingerprint}>
                  <td style={{ maxWidth: 520, wordBreak: 'break-all' }}>
                    <button className="link" onClick={() => setOpen(open === g.fingerprint ? null : g.fingerprint)} aria-expanded={open === g.fingerprint}>
                      {g.message}
                    </button>
                    {open === g.fingerprint && <pre className="stack">{g.stack ?? '（无堆栈）'}</pre>}
                  </td>
                  <td>{fmt(g.count)}</td>
                  <td>{fmt(g.players)}</td>
                  <td>{g.platforms.join(', ') || '—'}</td>
                  <td>{g.versions.join(', ') || '—'}</td>
                  <td>{fmtTime(g.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
