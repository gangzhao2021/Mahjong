# 部署服务端

服务端（含管理后台）打包成一个 Docker 镜像，配一个 PostgreSQL。任何能跑 Docker 的云服务器都可以：阿里云、腾讯云、AWS、GCP 等。**国内版必须部署在境内机房**，数据和大模型调用都不能出境（附录 D.6）。

## 1. 准备

- 一台 Linux 服务器：2 核 4 GB 内存够用（单进程只用 1 核，见下面的“容量”）
- 一个域名，解析到服务器；国内版需要先做 ICP 备案
- 安装 Docker 和 Docker Compose

## 2. 配置

```bash
git clone https://github.com/gangzhao2021/Mahjong.git
```

```bash
cd Mahjong && cp .env.example .env
```

编辑 `.env`，至少填：

| 变量 | 说明 |
|---|---|
| `POSTGRES_PASSWORD` | 数据库密码 |
| `SESSION_SECRET`、`ID_HASH_SECRET` | 各 32 位以上随机字符，用 `openssl rand -hex 32` 生成。**设好后不要改**：改了所有玩家都要重新登录，手机号和实名信息也对不上 |
| `REGION` | `global` 或 `china` |
| `ANTHROPIC_API_KEY`（国际版）或 `LLM_API_KEY`（国内版） | AI 对话；不填也能玩，AI 只用模板台词 |
| `ADMIN_*` | 管理后台账号，用 `pnpm admin:setup` 生成；建议同时设 `ADMIN_IP_ALLOWLIST` |

生产环境（镜像里 `NODE_ENV=production`）缺少或过短的密钥会直接拒绝启动，避免误用开发配置上线。

## 3. 启动

```bash
docker compose up -d --build
```

检查：

```bash
curl http://localhost:8787/health
```

返回 `{"ok":true}` 即正常。查看日志：

```bash
docker compose logs -f server
```

## 4. HTTPS 和 WebSocket

服务端监听 8787 端口（HTTP 和 `/ws` WebSocket 同一个端口）。前面放一个反向代理加 HTTPS，例如 Caddy（自动申请证书）：

```
api.example.com {
    reverse_proxy localhost:8787
}
```

用 Nginx 时记得转发 WebSocket 升级头（`Upgrade`、`Connection`），并把超时调长（例如 `proxy_read_timeout 3600s`）。反向代理后面一定要在 `.env` 里设 `TRUST_PROXY=1`，否则日志和后台 IP 白名单拿到的都是代理的 IP。

客户端的 `EXPO_PUBLIC_SERVER_URL` 填 `https://api.example.com`（在 `apps/mobile/eas.json` 里按打包配置填）。管理后台在 `https://api.example.com/admin/`。

## 5. 更新版本

```bash
git pull && docker compose up -d --build
```

停止时服务端会先保存所有进行中的牌局（`stop_grace_period` 为 20 秒），新版本启动后自动恢复；数据库迁移在启动时自动执行。

## 6. 备份

数据都在 PostgreSQL 里（账号、金币、AI 记忆、日志）。每天备份一次：

```bash
docker compose exec -T db pg_dump -U mahjong mahjong | gzip > backup-$(date +%F).sql.gz
```

备份文件要加密保存在服务器以外的地方。牌局回放日志在 `serverdata` 卷里，默认保留 180 天，丢了不影响游戏。

## 7. 日志保留

服务端每 6 小时自动清理过期数据：聊天记录和登录记录默认保留 90 天（国内版至少 180 天，配置更短也不生效），崩溃报告 90 天，牌局回放 180 天。可以用 `RETENTION_*` 变量调整（见 `.env.example`）。国内版玩家注销账号后，聊天和登录记录仍保留到期限结束再删，国际版注销时立即删除。

## 8. 容量

在 32 核开发机的 Docker 里压测（`pnpm --filter @mahjong/server loadtest`，机器人按真人节奏打牌）：

| 同时在打的桌数 | /health 延迟 p50 / p99 | 内存 | 结论 |
|---|---|---|---|
| 1,000 | 2 ms / 41 ms | 约 500 MB | 平稳，没有错误 |
| 2,000 | 6 ms / 135 ms | 约 900 MB | 单核跑满，登录变慢，出现少量错误 |

服务端是单进程，主要受 1 个 CPU 核限制。**建议每个进程最多承载约 1,000 桌同时在打**。更多玩家需要多个实例，并且同一个玩家要固定路由到同一个实例（牌局和断线重连都在实例内存里，检查点按玩家存在数据库里）；这个多实例路由还没做。

没人看着的牌局（玩家离开、断线、服务端重启后恢复的）共享每秒 400 步的预算，不会挤占正在打的桌子；可以用 `ServerConfig.unattendedActionsPerSecond` 调整。
