import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { errorText, get, post, setUnauthorizedHandler } from './api';
import { AiSettings } from './pages/AiSettings';
import { Analytics } from './pages/Analytics';
import { Audit } from './pages/Audit';
import { CoinLog } from './pages/CoinLog';
import { Crashes } from './pages/Crashes';
import { Economy } from './pages/Economy';
import { Libraries } from './pages/Libraries';
import { Moderation } from './pages/Moderation';
import { Players } from './pages/Players';
import { Roster } from './pages/Roster';
import './styles.css';

const PAGES = {
  analytics: { title: '数据概览', render: () => <Analytics /> },
  players: { title: '玩家管理', render: () => <Players /> },
  coins: { title: '金币调整记录', render: () => <CoinLog /> },
  economy: { title: '经济设置', render: () => <Economy /> },
  ai: { title: 'AI 设置', render: () => <AiSettings /> },
  roster: { title: '性格与角色', render: () => <Roster /> },
  libraries: { title: '名字与头像库', render: () => <Libraries /> },
  moderation: { title: '内容审核', render: () => <Moderation /> },
  crashes: { title: '崩溃报告', render: () => <Crashes /> },
  audit: { title: '操作日志', render: () => <Audit /> },
} as const;
type PageId = keyof typeof PAGES;

function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [page, setPage] = useState<PageId>(() => {
    const hash = location.hash.slice(1);
    return hash in PAGES ? (hash as PageId) : 'analytics';
  });

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    get('/me').then(
      () => setAuthed(true),
      () => setAuthed(false),
    );
  }, []);

  useEffect(() => {
    location.hash = page;
  }, [page]);

  if (authed === null) return null;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return (
    <div className="layout">
      <nav className="sidebar" aria-label="后台导航">
        <h1>麻将管理后台</h1>
        {(Object.keys(PAGES) as PageId[]).map((id) => (
          <button key={id} className={id === page ? 'active' : ''} aria-current={id === page ? 'page' : undefined} onClick={() => setPage(id)}>
            {PAGES[id].title}
          </button>
        ))}
        <div className="spacer" />
        <button onClick={() => post('/logout').finally(() => setAuthed(false))}>退出登录</button>
      </nav>
      <main>
        <h2>{PAGES[page].title}</h2>
        {PAGES[page].render()}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone(): void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/login', { username, password, code });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h3>麻将管理后台</h3>
        <input placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        <input placeholder="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <input placeholder="6 位验证码（身份验证器）" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy || !username || !password || code.length !== 6}>
          登录
        </button>
      </form>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
