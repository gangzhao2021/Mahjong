/** Product metrics with 7 / 30 / custom day ranges (PRD §33). */
import { useState } from 'react';
import { fmt, get } from '../api';
import { LineChart, StatTile } from '../components/LineChart';
import { useLoad } from '../hooks';

interface Day {
  day: string;
  dau: number;
  newPlayers: number;
  coinsIssued: number;
  coinsConsumed: number;
  privateRoomIssued: number;
  avgSessionMinutes: number;
  sessions: number;
}

interface Report {
  from: string;
  to: string;
  series: Day[];
  totals: { players: number; coinsInCirculation: number };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function Analytics() {
  const [range, setRange] = useState<{ preset: '7' | '30' | 'custom'; from: string; to: string }>({ preset: '7', from: '', to: '' });
  const query =
    range.preset === 'custom' && range.from && range.to
      ? `?from=${range.from}&to=${range.to}`
      : range.preset === '30'
        ? `?from=${shift(today(), -29)}&to=${today()}`
        : '';
  const { data, error, loading } = useLoad<Report>(() => get(`/analytics${query}`), [query]);

  const s = data?.series ?? [];
  const days = s.map((d) => d.day);
  const sessions = sum(s.map((d) => d.sessions));
  const avgMinutes = sessions ? sum(s.map((d) => d.avgSessionMinutes * d.sessions)) / sessions : 0;

  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        <button className={range.preset === '7' ? 'primary' : ''} onClick={() => setRange({ ...range, preset: '7' })}>
          最近 7 天
        </button>
        <button className={range.preset === '30' ? 'primary' : ''} onClick={() => setRange({ ...range, preset: '30' })}>
          最近 30 天
        </button>
        <button className={range.preset === 'custom' ? 'primary' : ''} onClick={() => setRange({ ...range, preset: 'custom' })}>
          自定义
        </button>
        {range.preset === 'custom' && (
          <>
            <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="开始日期" />
            <span>至</span>
            <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="结束日期" />
          </>
        )}
        {data && <span className="muted">{data.from} 至 {data.to}（UTC+8）</span>}
      </div>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <div className="tiles" style={{ opacity: loading ? 0.5 : 1 }}>
            <StatTile label="最近一天活跃玩家" value={fmt(s[s.length - 1]?.dau ?? 0)} sub={`区间日均 ${fmt(Math.round(sum(s.map((d) => d.dau)) / Math.max(1, s.length)))}`} />
            <StatTile label="新注册" value={fmt(sum(s.map((d) => d.newPlayers)))} sub={`累计玩家 ${fmt(data.totals.players)}`} />
            <StatTile label="金币发放" value={fmt(sum(s.map((d) => d.coinsIssued)))} sub={`私人房赢取 ${fmt(sum(s.map((d) => d.privateRoomIssued)))}`} />
            <StatTile label="金币消耗" value={fmt(sum(s.map((d) => d.coinsConsumed)))} sub={`流通总量 ${fmt(data.totals.coinsInCirculation)}`} />
            <StatTile label="平均在线时长" value={`${avgMinutes.toFixed(1)} 分钟`} sub={`共 ${fmt(sessions)} 次会话`} />
          </div>
          <div className="charts">
            <LineChart title="日活跃玩家" days={days} series={[{ name: '活跃玩家', color: 'var(--series-1)', values: s.map((d) => d.dau) }]} loading={loading} />
            <LineChart title="每日新注册" days={days} series={[{ name: '新注册', color: 'var(--series-1)', values: s.map((d) => d.newPlayers) }]} loading={loading} />
            <LineChart
              title="金币发放与消耗"
              days={days}
              series={[
                { name: '发放', color: 'var(--series-1)', values: s.map((d) => d.coinsIssued) },
                { name: '消耗', color: 'var(--series-2)', values: s.map((d) => d.coinsConsumed) },
              ]}
              loading={loading}
            />
            <LineChart
              title="平均在线时长（分钟）"
              days={days}
              series={[{ name: '平均时长', color: 'var(--series-1)', values: s.map((d) => d.avgSessionMinutes) }]}
              format={(n) => n.toFixed(1)}
              loading={loading}
            />
          </div>
        </>
      )}
    </>
  );
}

function today(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

function shift(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
