/** Admin action audit log (PRD §28 admin security). */
import { fmtTime, get } from '../api';
import { useLoad } from '../hooks';

const ACTIONS: Record<string, string> = {
  login: '登录',
  loginFailed: '登录失败',
  adjustCoins: '调整金币',
  suspend: '封禁',
  unsuspend: '解封',
  resetMemory: '清除 AI 记忆',
  updateConfig: '修改设置',
  createPersonality: '新建性格',
  updatePersonality: '修改性格',
  deletePersonality: '删除性格',
  createCharacter: '新建角色',
  updateCharacter: '修改角色',
  deleteCharacter: '删除角色',
  resolveModeration: '处理审核',
};

export function Audit() {
  const { data, error } = useLoad<{ entries: { id: number; action: string; target: string | null; detail: unknown; ip: string; createdAt: string }[] }>(() => get('/audit'), []);
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>操作</th>
            <th>对象</th>
            <th>详情</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {data?.entries.map((e) => (
            <tr key={e.id}>
              <td>{fmtTime(e.createdAt)}</td>
              <td>{ACTIONS[e.action] ?? e.action}</td>
              <td>{e.target ?? '—'}</td>
              <td className="muted" style={{ maxWidth: 480, wordBreak: 'break-all' }}>
                {e.detail ? JSON.stringify(e.detail).slice(0, 300) : ''}
              </td>
              <td>{e.ip}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
