/** Name and avatar libraries used when creating characters (PRD §9). */
import { useEffect, useState } from 'react';
import { get, put } from '../api';
import { useLoad, useSave } from '../hooks';

type Entry = { value: string; enabled: boolean };

export function Libraries() {
  const { data, error } = useLoad<{ nameLibrary: Entry[]; avatarLibrary: Entry[] }>(() => get('/config'), []);
  if (error) return <p className="error">{error}</p>;
  if (!data) return null;
  return (
    <>
      <LibraryCard title="名字库" configKey="nameLibrary" initial={data.nameLibrary} placeholder="新名字" />
      <LibraryCard title="头像库" configKey="avatarLibrary" initial={data.avatarLibrary} placeholder="新头像（emoji）" />
    </>
  );
}

function LibraryCard({ title, configKey, initial, placeholder }: { title: string; configKey: string; initial: Entry[]; placeholder: string }) {
  const [list, setList] = useState(initial);
  const [draft, setDraft] = useState('');
  const save = useSave();
  useEffect(() => setList(initial), [initial]);
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="row" style={{ marginBottom: 8 }}>
        {list.map((e, i) => (
          <span key={i} className="badge" style={{ opacity: e.enabled ? 1 : 0.5, fontSize: 14 }}>
            {e.value}{' '}
            <button aria-label={e.enabled ? `停用 ${e.value}` : `启用 ${e.value}`} onClick={() => setList(list.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))}>
              {e.enabled ? '停用' : '启用'}
            </button>{' '}
            <button aria-label={`删除 ${e.value}`} onClick={() => setList(list.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="row">
        <input placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button
          disabled={!draft.trim() || list.some((e) => e.value === draft.trim())}
          onClick={() => {
            setList([...list, { value: draft.trim(), enabled: true }]);
            setDraft('');
          }}
        >
          添加
        </button>
        <button className="primary" disabled={save.busy} onClick={() => save.run(() => put(`/config/${configKey}`, list), '已保存')}>
          保存
        </button>
        {save.message && <span className={save.message.ok ? 'ok' : 'error'}>{save.message.text}</span>}
      </div>
      <p className="muted">库只用于新建角色时挑选；已有角色的名字和头像不受影响。</p>
    </div>
  );
}
