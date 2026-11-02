/** China build (PRD §35, Appendix D.2–D.3): minor play windows, holiday calendar, guest trial. */
import { useEffect, useState } from 'react';
import { get, put } from '../api';
import { useLoad, useSave } from '../hooks';

interface Span {
  start: string;
  end: string;
}

interface ChinaConfig {
  utcOffsetHours: number;
  minorWindows: ({ days: number[] } & Span)[];
  holidayWindow: Span;
  holidays: string[];
  guestTrialMinutes: number;
  guestTrialPeriodDays: number;
}

const DAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function ChinaRules() {
  const { data, error } = useLoad<{ china: ChinaConfig }>(() => get('/config'), []);
  const [form, setForm] = useState<ChinaConfig | null>(null);
  const [holidays, setHolidays] = useState('');
  const save = useSave();
  useEffect(() => {
    if (!data) return;
    setForm(data.china);
    setHolidays(data.china.holidays.join('\n'));
  }, [data]);
  if (error) return <p className="error">{error}</p>;
  if (!form) return null;

  const dates = holidays.split(/[\s,，]+/).filter(Boolean);
  const year = String(new Date().getFullYear());
  const setWindow = (i: number, patch: Partial<ChinaConfig['minorWindows'][number]>) =>
    setForm({ ...form, minorWindows: form.minorWindows.map((w, j) => (j === i ? { ...w, ...patch } : w)) });

  return (
    <>
      <p className="notice">保存后立即生效。时段和节假日请以监管部门的现行通知为准；上线前和每年更新时请与发行方或法务确认。</p>
      {!dates.some((d) => d.startsWith(year)) && <p className="error">节假日里没有 {year} 年的日期：未成年人现在只能在每周时段游戏。</p>}

      <div className="card">
        <h3>未成年人每周可玩时段</h3>
        {form.minorWindows.map((w, i) => (
          <div className="row" key={i} style={{ marginBottom: 8 }}>
            {DAYS.map((label, day) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={w.days.includes(day)}
                  onChange={(e) => setWindow(i, { days: e.target.checked ? [...w.days, day] : w.days.filter((d) => d !== day) })}
                />
                周{label}
              </label>
            ))}
            <input aria-label="开始时间" type="time" value={w.start} onChange={(e) => setWindow(i, { start: e.target.value })} />
            <input aria-label="结束时间" type="time" value={w.end} onChange={(e) => setWindow(i, { end: e.target.value })} />
            <button onClick={() => setForm({ ...form, minorWindows: form.minorWindows.filter((_, j) => j !== i) })}>删除</button>
          </div>
        ))}
        <button onClick={() => setForm({ ...form, minorWindows: [...form.minorWindows, { days: [5, 6, 0], start: '20:00', end: '21:00' }] })}>添加时段</button>
      </div>

      <div className="card">
        <h3>法定节假日</h3>
        <div className="row" style={{ marginBottom: 8 }}>
          <span>节假日可玩时段</span>
          <input aria-label="节假日开始时间" type="time" value={form.holidayWindow.start} onChange={(e) => setForm({ ...form, holidayWindow: { ...form.holidayWindow, start: e.target.value } })} />
          <input aria-label="节假日结束时间" type="time" value={form.holidayWindow.end} onChange={(e) => setForm({ ...form, holidayWindow: { ...form.holidayWindow, end: e.target.value } })} />
        </div>
        <label htmlFor="holidays">放假日期（每行或每个空格一个，格式 2027-01-01；不含调休上班日），共 {dates.length} 天</label>
        <textarea id="holidays" rows={10} style={{ width: '100%' }} value={holidays} onChange={(e) => setHolidays(e.target.value)} />
      </div>

      <div className="card">
        <h3>游客试玩</h3>
        <div className="grid-form">
          <label htmlFor="trial">每台设备可玩（分钟，0 表示关闭）</label>
          <input id="trial" type="number" min={0} value={form.guestTrialMinutes} onChange={(e) => setForm({ ...form, guestTrialMinutes: Number(e.target.value) })} />
          <label htmlFor="period">周期（天）</label>
          <input id="period" type="number" min={1} value={form.guestTrialPeriodDays} onChange={(e) => setForm({ ...form, guestTrialPeriodDays: Number(e.target.value) })} />
        </div>
      </div>

      <div className="row">
        <button className="primary" disabled={save.busy} onClick={() => save.run(() => put('/config/china', { ...form, holidays: [...new Set(dates)].sort() }), '已保存，立即生效')}>
          保存
        </button>
        {save.message && <span className={save.message.ok ? 'ok' : 'error'}>{save.message.text}</span>}
      </div>
    </>
  );
}
