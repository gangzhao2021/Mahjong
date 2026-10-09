/**
 * Friend-room invite links: /join/123456 is a tiny landing page that opens the
 * app (sichuanmahjong://join/123456), offers the web version when one is
 * deployed (WEB_CLIENT_URL), and always shows the number to type in by hand.
 */

export const APP_SCHEME = 'sichuanmahjong';

export function isRoomCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function invitePage(code: string, webClientUrl: string | null, lang: 'zh' | 'en'): string {
  const zh = lang === 'zh';
  const app = `${APP_SCHEME}://join/${code}`;
  const web = webClientUrl ? `${webClientUrl.replace(/\/$/, '')}/?room=${code}` : null;
  const t = zh
    ? { title: '四川麻将 · 好友房邀请', lead: '朋友邀请你来四川麻将好友房一起打牌', number: '房号', app: '用 App 打开', web: '在网页里玩', manual: '打不开？进入游戏后点「好友房」，输入上面的房号即可加入。' }
    : { title: 'Sichuan Mahjong · friend room', lead: 'A friend invited you to their Sichuan Mahjong table', number: 'Room number', app: 'Open in the app', web: 'Play in the browser', manual: 'Not opening? In the game, tap "Friends" and type the number above.' };
  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: system-ui, sans-serif; background: #1f6b47; color: #fff8e1; }
  main { max-width: 360px; padding: 24px; text-align: center; }
  .code { font-size: 44px; font-weight: 900; letter-spacing: 10px; color: #ffd54f; margin: 4px 0 20px; }
  a.btn { display: block; margin: 10px 0; padding: 14px; border-radius: 14px; font-weight: 800; text-decoration: none; }
  .primary { background: #ffca28; color: #3e2723; }
  .secondary { background: rgba(255,255,255,.15); color: #fff8e1; }
  p.small { font-size: 13px; color: #c8e6c9; }
</style>
</head>
<body>
<main>
  <h1>🀄 ${t.lead}</h1>
  <div>${t.number}</div>
  <div class="code">${code}</div>
  <a class="btn primary" href="${app}">${t.app}</a>
  ${web ? `<a class="btn secondary" href="${web}">${t.web}</a>` : ''}
  <p class="small">${t.manual}</p>
</main>
</body>
</html>`;
}
