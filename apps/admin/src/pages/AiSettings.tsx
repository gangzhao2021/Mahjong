/** AI behaviour (PRD §35, §38): conversation, skill weights, LLM, quick phrases, chat limits. */
import { useEffect, useState } from 'react';
import { get, put } from '../api';
import { useLoad, useSave } from '../hooks';

type Settings = Record<string, number>;

const SLIDERS: [string, string][] = [
  ['conversationFrequency', '对话频率'],
  ['proactiveFrequency', '主动搭话频率'],
  ['stickerFrequency', '表情频率'],
  ['bluffIntensity', '诈唬强度'],
  ['trashTalkIntensity', '嘲讽强度'],
  ['sarcasmIntensity', '讽刺强度'],
  ['aiReplyChance', 'AI 之间接话概率'],
];

const LIMITS: [string, string][] = [
  ['maxSpeakersPerTrigger', '每个事件最多几个 AI 说话'],
  ['seatCooldownMs', '同一 AI 两句间隔（毫秒）'],
  ['tableCooldownMs', '全桌两句间隔（毫秒）'],
  ['relevanceWindowActions', '台词过时阈值（操作数）'],
  ['llmPerHand', '每局最多大模型调用次数'],
];

const CHAT_LIMITS: [string, string][] = [
  ['maxLength', '单条最长字数'],
  ['minIntervalMs', '两条最短间隔（毫秒）'],
  ['perMinute', '每分钟最多条数'],
  ['violationsBeforeSuspension', '违规几次暂停聊天'],
  ['violationWindowMs', '违规计数窗口（毫秒）'],
  ['suspensionMs', '暂停聊天时长（毫秒）'],
];

const SKILLS: [string, string][] = [
  ['beginner', '新手'],
  ['intermediate', '中级'],
  ['expert', '专家'],
];

interface Config {
  dialogueSettings: Settings;
  skillWeights: Settings;
  llm: { routineModel: string; highValueModel: string; dailyRequestCap: number };
  quickPhrases: { id: string; text: string }[];
  chatLimits: Settings;
}

export function AiSettings() {
  const { data, error } = useLoad<Config>(() => get('/config'), []);
  const [form, setForm] = useState<Config | null>(null);
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);
  if (error) return <p className="error">{error}</p>;
  if (!form) return null;
  const totalWeight = SKILLS.reduce((a, [k]) => a + (form.skillWeights[k] || 0), 0);

  return (
    <>
      <p className="notice">保存后对新开的牌局生效。国内版的嘲讽和讽刺强度会被自动限制在 0.4 以内。</p>
      <Section title="对话与诈唬" onSave={() => put('/config/dialogueSettings', form.dialogueSettings)}>
        <div className="grid-form">
          {SLIDERS.map(([key, label]) => (
            <Slider key={key} label={label} value={form.dialogueSettings[key]} onChange={(v) => setForm({ ...form, dialogueSettings: { ...form.dialogueSettings, [key]: v } })} />
          ))}
          {LIMITS.map(([key, label]) => (
            <NumberField key={key} label={label} value={form.dialogueSettings[key]} onChange={(v) => setForm({ ...form, dialogueSettings: { ...form.dialogueSettings, [key]: v } })} />
          ))}
        </div>
      </Section>

      <Section title="AI 技术水平权重" onSave={() => put('/config/skillWeights', form.skillWeights)}>
        <div className="grid-form">
          {SKILLS.map(([key, label]) => (
            <NumberField
              key={key}
              label={label}
              value={form.skillWeights[key]}
              suffix={totalWeight ? `→ ${((100 * (form.skillWeights[key] || 0)) / totalWeight).toFixed(0)}%` : ''}
              onChange={(v) => setForm({ ...form, skillWeights: { ...form.skillWeights, [key]: v } })}
            />
          ))}
        </div>
        <p className="muted">权重不需要加起来等于 100，系统自动换算成概率；与性格的抽取相互独立。</p>
      </Section>

      <Section title="大模型" onSave={() => put('/config/llm', form.llm)}>
        <div className="grid-form">
          <label htmlFor="routine">日常反应模型</label>
          <input id="routine" value={form.llm.routineModel} onChange={(e) => setForm({ ...form, llm: { ...form.llm, routineModel: e.target.value } })} />
          <label htmlFor="high">高价值时刻模型</label>
          <input id="high" value={form.llm.highValueModel} onChange={(e) => setForm({ ...form, llm: { ...form.llm, highValueModel: e.target.value } })} />
          <NumberField label="每日调用上限" value={form.llm.dailyRequestCap} onChange={(v) => setForm({ ...form, llm: { ...form.llm, dailyRequestCap: v } })} />
        </div>
        <p className="muted">超过每日上限后，AI 自动改用模板台词。</p>
      </Section>

      <Section title="快捷语" onSave={() => put('/config/quickPhrases', form.quickPhrases)}>
        {form.quickPhrases.map((q, i) => (
          <div className="row" key={i} style={{ marginBottom: 6 }}>
            <input value={q.text} maxLength={30} style={{ flex: 1 }} aria-label={`快捷语 ${i + 1}`} onChange={(e) => setForm({ ...form, quickPhrases: form.quickPhrases.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
            <button onClick={() => setForm({ ...form, quickPhrases: form.quickPhrases.filter((_, j) => j !== i) })}>删除</button>
          </div>
        ))}
        <button disabled={form.quickPhrases.length >= 20} onClick={() => setForm({ ...form, quickPhrases: [...form.quickPhrases, { id: `q${Date.now().toString(36)}`, text: '' }] })}>
          添加快捷语
        </button>
      </Section>

      <Section title="玩家聊天限制" onSave={() => put('/config/chatLimits', form.chatLimits)}>
        <div className="grid-form">
          {CHAT_LIMITS.map(([key, label]) => (
            <NumberField key={key} label={label} value={form.chatLimits[key]} onChange={(v) => setForm({ ...form, chatLimits: { ...form.chatLimits, [key]: v } })} />
          ))}
        </div>
      </Section>
    </>
  );
}

function Section({ title, children, onSave }: { title: string; children: React.ReactNode; onSave(): Promise<unknown> }) {
  const save = useSave();
  return (
    <div className="card">
      <h3>{title}</h3>
      {children}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" disabled={save.busy} onClick={() => save.run(onSave)}>
          保存
        </button>
        {save.message && <span className={save.message.ok ? 'ok' : 'error'}>{save.message.text}</span>}
      </div>
    </div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange(v: number): void }) {
  const id = `s-${label}`;
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="row">
        <input id={id} type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1 }} />
        <span style={{ width: 40, fontVariantNumeric: 'tabular-nums' }}>{value.toFixed(2)}</span>
      </div>
    </>
  );
}

function NumberField({ label, value, onChange, suffix }: { label: string; value: number; onChange(v: number): void; suffix?: string }) {
  const id = `n-${label}`;
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="row">
        <input id={id} value={value} inputMode="numeric" onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value.replace(/[^\d.]/g, '')))} />
        {suffix && <span className="muted">{suffix}</span>}
      </div>
    </>
  );
}
