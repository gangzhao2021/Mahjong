/**
 * Draft legal pages (PRD Appendix C / D.7): privacy policy, terms of service
 * and the third-party SDK list, served as plain HTML so the app and the store
 * listings can link to them. These are engineering drafts — they MUST be
 * reviewed by legal counsel and completed with the operator's details before release.
 */
import type { Region } from './dialogueConfig';

export type LegalPage = 'privacy' | 'terms' | 'sdks';

const UPDATED = '2026-10-07';

const DRAFT_BANNER = '<p class="draft">【草案】本文件由开发团队起草，正式上线前须经法务审核并补全运营主体、联系方式等信息。</p>';

function page(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
:root{color-scheme:light dark;--bg:#fdfaf2;--text:#2b2a27;--muted:#6b6963;--draft:#fff4d6}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--text:#ecebe6;--muted:#a3a19a;--draft:#3a3220}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}h1{font-size:24px}h2{font-size:18px;margin-top:28px}
.muted{color:var(--muted)}.draft{background:var(--draft);padding:10px 12px;border-radius:8px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid rgba(127,127,127,.3);padding:6px 8px;text-align:left;vertical-align:top}
</style></head><body><main><h1>${title}</h1><p class="muted">更新日期：${UPDATED}</p>${DRAFT_BANNER}${body}</main></body></html>`;
}

const SDKS: Record<Region, { name: string; purpose: string; data: string }[]> = {
  global: [
    { name: 'Expo / React Native', purpose: '应用运行框架', data: '不单独收集个人信息' },
    { name: 'Sign in with Apple', purpose: 'Apple 账号登录（可选）', data: 'Apple 提供的匿名用户标识、（可选）邮箱' },
    { name: 'Google Sign-In', purpose: 'Google 账号登录（可选）', data: 'Google 用户标识、邮箱' },
    { name: 'Anthropic Claude API（服务端调用）', purpose: '生成 AI 角色的对话', data: '牌局事件、昵称、聊天文字；不含设备标识、邮箱' },
  ],
  china: [
    { name: 'Expo / React Native', purpose: '应用运行框架', data: '不单独收集个人信息' },
    { name: '微信开放平台 SDK', purpose: '微信登录（可选）', data: '微信 OpenID / UnionID' },
    { name: '短信服务（服务端调用）', purpose: '发送登录验证码', data: '手机号' },
    { name: '国家网络游戏防沉迷实名认证系统（服务端调用）', purpose: '实名认证', data: '姓名、身份证号（仅用于认证，不保存原文）' },
    { name: '已备案的国产大模型服务（服务端调用）', purpose: '生成 AI 角色的对话', data: '牌局事件、昵称、聊天文字；不含身份信息' },
    { name: '内容安全服务（服务端调用）', purpose: '聊天和昵称内容审核', data: '聊天文字、昵称' },
  ],
};

function privacy(region: Region): string {
  const china = region === 'china';
  return page(
    '隐私政策',
    `<p>本政策说明《四川麻将 · 血战到底》（以下简称"本游戏"）如何收集、使用、存储和保护你的个人信息。本游戏不包含任何真实货币交易，金币仅用于游戏内娱乐，不能购买、兑换或转让。</p>
<h2>1. 我们收集的信息</h2>
<ul>
<li><b>账号信息：</b>${china ? '手机号、微信或 Apple 账号标识' : 'Apple 或 Google 账号标识、邮箱（如由对方提供）'}；游客登录时为设备上随机生成的标识（不是设备硬件标识）。</li>
${china ? '<li><b>实名认证信息：</b>姓名和身份证号仅用于通过国家防沉迷实名认证系统核验，我们只保存核验结果和出生年份（用于未成年人保护），不保存身份证号原文。</li>' : ''}
<li><b>游戏数据：</b>牌局记录、金币变动、游戏时长、偏好设置。</li>
<li><b>聊天内容：</b>你在牌桌上输入的文字，用于显示给 AI 角色、内容审核和举报处理。</li>
<li><b>AI 记忆：</b>AI 角色会记住与你的对局经历（例如一次精彩的胡牌），用于后续对局中的对话。你可以注销账号删除全部记忆。</li>
<li><b>崩溃与诊断信息：</b>应用出错时的错误信息、系统平台和应用版本，用于修复问题。</li>
</ul>
<h2>2. AI 对话</h2>
<p>牌桌上的 AI 角色由${china ? '已完成生成式人工智能服务备案的国产大模型' : '第三方大模型服务'}生成对话。发送给模型的内容仅包括牌局事件、昵称和聊天文字，不包含${china ? '手机号、身份信息' : '邮箱'}或设备标识。AI 生成的内容会标注为 AI。</p>
<h2>3. 信息的使用和共享</h2>
<p>我们仅为提供游戏服务、保障账号安全、内容审核、遵守法律法规而使用上述信息。我们不出售你的个人信息，不进行跨应用追踪，不投放个性化广告。第三方 SDK 和服务见<a href="/legal/sdks">第三方 SDK 清单</a>。</p>
<h2>4. 存储和保留</h2>
<p>${china ? '你的个人信息存储在中华人民共和国境内的服务器上。按照网络安全法律要求，登录日志和聊天记录至少保留 6 个月后删除。' : '登录和聊天日志在必要期限后删除。'}</p>
<h2>5. 你的权利</h2>
<p>你可以在"账号"页面修改昵称、调整设置，并可随时<b>注销账号</b>。注销后，我们会删除你的账号、金币记录和 AI 记忆，法律要求保留的记录仅在规定期限内保存后删除。</p>
${china ? '<h2>6. 未成年人保护</h2><p>未成年人只能在法规允许的时段游戏。不满 14 周岁的用户需在监护人同意后使用。</p>' : '<h2>6. 儿童</h2><p>本游戏不面向 13 岁以下儿童。</p>'}
<h2>7. 联系我们</h2>
<p>运营主体：【待补充】　联系邮箱：【待补充】</p>`,
  );
}

function terms(region: Region): string {
  const china = region === 'china';
  return page(
    '用户协议',
    `<h2>1. 服务内容</h2><p>本游戏提供四川麻将（血战到底）单机/AI 对局娱乐服务。牌桌上的其他玩家均为 AI 角色。</p>
<h2>2. 虚拟金币</h2><p>金币是游戏内的娱乐积分，免费获得，<b>不能用真实货币购买，不能兑换现金或任何物品，不能在玩家之间转让</b>。我们可能调整金币规则，注销账号后金币一并清除。</p>
<h2>3. 行为规范</h2><p>你不得在聊天中发布违法、色情、暴力、侮辱、骚扰或侵犯他人权益的内容。违反规范的，我们可能拦截消息、限制聊天或封禁账号。</p>
<h2>4. AI 生成内容</h2><p>AI 角色的发言由人工智能生成，仅供娱乐，不代表我们的观点。如遇不当内容，可长按对话气泡举报。</p>
${china ? '<h2>5. 防沉迷</h2><p>你需要完成实名认证后才能正常游戏；游客仅可短时试玩。未成年人的游戏时段按国家规定限制。</p>' : ''}
<h2>${china ? 6 : 5}. 协议变更</h2><p>协议更新时会在应用内提示，继续使用即视为同意更新后的协议。</p>
<p>运营主体：【待补充】</p>`,
  );
}

function sdks(region: Region): string {
  const rows = SDKS[region].map((r) => `<tr><td>${r.name}</td><td>${r.purpose}</td><td>${r.data}</td></tr>`).join('');
  return page('第三方 SDK 与服务清单', `<table><thead><tr><th>名称</th><th>用途</th><th>涉及的信息</th></tr></thead><tbody>${rows}</tbody></table>`);
}

export function legalPage(name: LegalPage, region: Region): string {
  return name === 'privacy' ? privacy(region) : name === 'terms' ? terms(region) : sdks(region);
}
