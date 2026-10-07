/** Personality templates and the AI character roster (PRD §9, §36–§37). */
import { useState } from 'react';
import { del, get, put } from '../api';
import { useLoad, useSave } from '../hooks';

interface Personality {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  conversationStyle: string;
  trashTalk: number;
  talkFrequency: number;
  bluffTendency: number;
  stickerTendency: number;
  stickers: string[];
  weight: number;
  enabled: boolean;
}

interface Character {
  id: string;
  name: string;
  avatar: string;
  personalityId: string;
  weight: number;
  enabled: boolean;
  catchphrases?: string[];
}

interface Library {
  nameLibrary: { value: string; enabled: boolean }[];
  avatarLibrary: { value: string; enabled: boolean }[];
}

const NEW_PERSONALITY: Personality = {
  id: '',
  name: '',
  description: '',
  systemPrompt: '',
  conversationStyle: '',
  trashTalk: 0.5,
  talkFrequency: 0.5,
  bluffTendency: 0.3,
  stickerTendency: 0.4,
  stickers: ['laugh'],
  weight: 10,
  enabled: true,
};

export function Roster() {
  const { data, error, reload } = useLoad<{ personalities: Personality[]; characters: Character[] }>(() => get('/roster'), []);
  const libs = useLoad<Library>(() => get('/config'), []);
  const [editing, setEditing] = useState<Personality | null>(null);
  const [editingChar, setEditingChar] = useState<Character | null>(null);
  const save = useSave();
  if (error) return <p className="error">{error}</p>;
  if (!data) return null;

  const totalWeight = data.personalities.filter((p) => p.enabled).reduce((a, p) => a + p.weight, 0);

  return (
    <>
      {save.message && <p className={save.message.ok ? 'ok' : 'error'}>{save.message.text}</p>}
      <div className="card" style={{ overflowX: 'auto' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>性格模板</h3>
          <button onClick={() => setEditing({ ...NEW_PERSONALITY, id: `p${Date.now().toString(36)}` })}>新建性格</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>描述</th>
              <th className="num">权重</th>
              <th className="num">出现概率</th>
              <th className="num">嘲讽</th>
              <th className="num">话量</th>
              <th className="num">诈唬</th>
              <th>状态</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.personalities.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="secondary">{p.description}</td>
                <td className="num">{p.weight}</td>
                <td className="num">{p.enabled && totalWeight ? `${((100 * p.weight) / totalWeight).toFixed(0)}%` : '—'}</td>
                <td className="num">{p.trashTalk}</td>
                <td className="num">{p.talkFrequency}</td>
                <td className="num">{p.bluffTendency}</td>
                <td>{p.enabled ? '启用' : <span className="badge">停用</span>}</td>
                <td className="row">
                  <button onClick={() => setEditing(p)}>编辑</button>
                  <button
                    onClick={() =>
                      save.run(() => put(`/personalities/${p.id}`, { ...p, enabled: !p.enabled }), p.enabled ? '已停用' : '已启用').then(reload)
                    }
                  >
                    {p.enabled ? '停用' : '启用'}
                  </button>
                  <button className="danger" onClick={() => confirm(`删除性格「${p.name}」？`) && save.run(() => del(`/personalities/${p.id}`), '已删除').then(reload)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>AI 角色（{data.characters.filter((c) => c.enabled).length} 个启用）</h3>
          <button onClick={() => setEditingChar({ id: `c${Date.now().toString(36)}`, name: '', avatar: '', personalityId: data.personalities[0]?.id ?? '', weight: 10, enabled: true })}>
            新建角色
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>角色</th>
              <th>性格</th>
              <th className="num">权重</th>
              <th>口头禅</th>
              <th>状态</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.characters.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.avatar} {c.name} <span className="muted">{c.id}</span>
                </td>
                <td>{data.personalities.find((p) => p.id === c.personalityId)?.name ?? c.personalityId}</td>
                <td className="num">{c.weight}</td>
                <td className="secondary">{c.catchphrases?.join(' / ')}</td>
                <td>{c.enabled ? '启用' : <span className="badge">停用</span>}</td>
                <td className="row">
                  <button onClick={() => setEditingChar(c)}>编辑</button>
                  <button onClick={() => save.run(() => put(`/characters/${c.id}`, { ...c, enabled: !c.enabled }), c.enabled ? '已停用（记忆保留）' : '已启用').then(reload)}>
                    {c.enabled ? '停用' : '启用'}
                  </button>
                  <button
                    className="danger"
                    onClick={() => confirm(`删除角色「${c.name}」？它对所有玩家的记忆也会一起删除。`) && save.run(() => del(`/characters/${c.id}`), '已删除角色及其记忆').then(reload)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <PersonalityForm
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={async (p) => {
            if (await save.run(() => put(`/personalities/${p.id}`, p))) {
              setEditing(null);
              reload();
            }
          }}
        />
      )}
      {editingChar && (
        <CharacterForm
          value={editingChar}
          personalities={data.personalities}
          library={libs.data}
          onCancel={() => setEditingChar(null)}
          onSave={async (c) => {
            if (await save.run(() => put(`/characters/${c.id}`, c))) {
              setEditingChar(null);
              reload();
            }
          }}
        />
      )}
    </>
  );
}

function PersonalityForm({ value, onCancel, onSave }: { value: Personality; onCancel(): void; onSave(p: Personality): void }) {
  const [p, setP] = useState(value);
  const field = (key: 'trashTalk' | 'talkFrequency' | 'bluffTendency' | 'stickerTendency', label: string) => (
    <>
      <label htmlFor={key}>{label}</label>
      <div className="row">
        <input id={key} type="range" min={0} max={1} step={0.05} value={p[key]} onChange={(e) => setP({ ...p, [key]: Number(e.target.value) })} style={{ flex: 1 }} />
        <span>{p[key].toFixed(2)}</span>
      </div>
    </>
  );
  return (
    <div className="drawer" role="dialog" aria-label="编辑性格">
      <h2>{value.name ? `编辑性格：${value.name}` : '新建性格'}</h2>
      <div className="card grid-form">
        <label htmlFor="pname">名称</label>
        <input id="pname" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
        <label htmlFor="pdesc">描述</label>
        <input id="pdesc" value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />
        <label htmlFor="pprompt">行为指令（系统提示词）</label>
        <textarea id="pprompt" value={p.systemPrompt} onChange={(e) => setP({ ...p, systemPrompt: e.target.value })} />
        <label htmlFor="pstyle">说话风格</label>
        <textarea id="pstyle" value={p.conversationStyle} onChange={(e) => setP({ ...p, conversationStyle: e.target.value })} />
        {field('trashTalk', '嘲讽强度')}
        {field('talkFrequency', '说话频率')}
        {field('bluffTendency', '诈唬倾向')}
        {field('stickerTendency', '表情倾向')}
        <label htmlFor="pstickers">常用表情（逗号分隔）</label>
        <input id="pstickers" value={p.stickers.join(',')} onChange={(e) => setP({ ...p, stickers: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        <label htmlFor="pweight">出现权重</label>
        <input id="pweight" value={p.weight} onChange={(e) => setP({ ...p, weight: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} />
        <label htmlFor="penabled">启用</label>
        <input id="penabled" type="checkbox" checked={p.enabled} onChange={(e) => setP({ ...p, enabled: e.target.checked })} style={{ justifySelf: 'start' }} />
      </div>
      <div className="row">
        <button onClick={onCancel}>取消</button>
        <button className="primary" disabled={!p.name.trim()} onClick={() => onSave(p)}>
          保存
        </button>
      </div>
    </div>
  );
}

function CharacterForm({
  value,
  personalities,
  library,
  onCancel,
  onSave,
}: {
  value: Character;
  personalities: Personality[];
  library: Library | null;
  onCancel(): void;
  onSave(c: Character): void;
}) {
  const [c, setC] = useState(value);
  const names = library?.nameLibrary.filter((n) => n.enabled) ?? [];
  const avatars = library?.avatarLibrary.filter((a) => a.enabled) ?? [];
  return (
    <div className="drawer" role="dialog" aria-label="编辑角色">
      <h2>{value.name ? `编辑角色：${value.name}` : '新建角色'}</h2>
      <div className="card grid-form">
        <label htmlFor="cname">名字</label>
        <div className="row">
          <input id="cname" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} list="name-library" />
          <datalist id="name-library">
            {names.map((n) => (
              <option key={n.value} value={n.value} />
            ))}
          </datalist>
        </div>
        <span>头像</span>
        <div className="row">
          <input value={c.avatar} onChange={(e) => setC({ ...c, avatar: e.target.value })} style={{ width: 60 }} aria-label="头像" />
          {avatars.map((a) => (
            <button key={a.value} className={a.value === c.avatar ? 'primary' : ''} onClick={() => setC({ ...c, avatar: a.value })}>
              {a.value}
            </button>
          ))}
        </div>
        <label htmlFor="cpers">性格</label>
        <select id="cpers" value={c.personalityId} onChange={(e) => setC({ ...c, personalityId: e.target.value })}>
          {personalities.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.enabled ? '' : '（停用）'}
            </option>
          ))}
        </select>
        <label htmlFor="ccatch">口头禅（每行一句）</label>
        <textarea id="ccatch" value={(c.catchphrases ?? []).join('\n')} onChange={(e) => setC({ ...c, catchphrases: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
        <label htmlFor="cweight">权重</label>
        <input id="cweight" value={c.weight} onChange={(e) => setC({ ...c, weight: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} />
        <label htmlFor="cenabled">启用</label>
        <input id="cenabled" type="checkbox" checked={c.enabled} onChange={(e) => setC({ ...c, enabled: e.target.checked })} style={{ justifySelf: 'start' }} />
      </div>
      <p className="muted">角色的名字、头像、性格一旦创建就固定下来，玩家才能认出老对手；改动会影响所有玩家对它的印象。</p>
      <div className="row">
        <button onClick={onCancel}>取消</button>
        <button className="primary" disabled={!c.name.trim() || !c.avatar.trim()} onClick={() => onSave(c)}>
          保存
        </button>
      </div>
    </div>
  );
}
