# 上架检查清单（PRD 附录 C / D）

代码里能做的已经做了；下面是上架前必须由人完成或确认的事项。标「联调」的代码已写好，但要用真实账号验证。

## 建议的顺序

1. 注册 Expo 账号，按 [device-testing.md](device-testing.md) 打 Android 开发版上手机。这是第一次原生编译，最可能发现新问题。
2. 配好模型密钥，跑 `pnpm llm:smoke`。
3. 决定正式的 bundle ID 和域名，部署测试服务器，跑 `smoke:deploy`。
4. 换美术和声音，请法务审核，上架国际版（PRD：不要让国际版等版号）。
5. 大陆版的资质同时申请，下面「中国大陆版」一节。

## 两个版本都需要

- [ ] 按 [device-testing.md](device-testing.md) 在 iOS 和 Android 真机上跑完测试清单。
- [ ] 按 [deploy.md](deploy.md) 部署正式服务端，配好 HTTPS、每日数据库备份，运行 `smoke:deploy` 确认全部通过。
- [ ] 定正式的应用名和商标。现在的“麻将 / Mahjong”是临时的通用名，商店里不容易被搜到，也不容易注册商标；大陆版申请软著和版号前就要定下来。要改的地方：`app.json`、`apps/mobile/src/strings.ts`（`appTitle`、`brand`、`consent.title`、`inviteText`）、`apps/server/src/invite.ts`、`apps/server/src/legal.ts`。
- [ ] 换掉占位应用图标和启动图（`apps/mobile/assets`）。

- [ ] 把 `app.json` 里的 bundle ID / package `com.example.mahjong` 换成正式的（国内版自动加 `.cn`，或用 `APP_ID` 指定）。
- [ ] 把 `eas.json` 里的服务器地址和 `ascAppId` 换成正式值。
- [ ] 用录制或授权的音效和音乐替换 `apps/mobile/assets/sounds`（现在是程序合成的占位声音）。
- [ ] 请法务审核 `/legal/privacy`、`/legal/terms`、`/legal/sdks`（`apps/server/src/legal.ts`），补全运营主体和联系方式，去掉“草案”标记。政策有实质变化时，修改 `ConsentScreen.tsx` 里的 `CONSENT_VERSION`，让玩家重新同意。
- [ ] 年龄分级问卷按“模拟赌博”如实填写（iOS 预计 12+/17+，Google Play Teen 及以上）。
- [ ] Apple 隐私标签和 Google 数据安全表单要声明：账号标识、游客随机设备标识、游戏数据、聊天内容（会发给大模型服务）、崩溃诊断。没有跨应用追踪，不需要 ATT 弹窗。
- [ ] 准备审核用的演示账号（游客登录即可），并在审核备注里说明：金币不能购买、兑换或转让。
- [ ] 确认管理后台已设好管理员（`pnpm admin:setup`），并开启 IP 白名单。
- [ ] 在后台“崩溃报告”页确认测试版没有未处理的崩溃。

## 国际版

- [ ] 在服务端配好 `ANTHROPIC_API_KEY`，运行 `pnpm llm:smoke` 全部通过，再跑一局确认 AI 对话正常（中文和英文界面各一局）。
- [ ] 英文文案（界面、教程、协议页、角色英文名）请母语者审校。
- [ ] 配好 Google 登录的 client ID（`EXPO_PUBLIC_GOOGLE_*`）。

## 中国大陆版（`eas build --profile production-china`）

- [ ] 版号、软著、ICP 备案、APP 备案、生成式 AI 相关备案（附录 D.1 / D.4）。
- [ ] 在 `eas.json` 的 `production-china` 里填入 `EXPO_PUBLIC_ICP`、`EXPO_PUBLIC_APP_FILING`，并按适龄评定结果填 `EXPO_PUBLIC_AGE_RATING`（现在默认 16+，必须和商店页一致）。
- [ ] 配好 `LLM_API_KEY` 后运行 `pnpm llm:smoke` 全部通过。
- [ ] 选定供应商。代码按阿里云（短信、文本审核）写好，换供应商要改 `apps/server/src/china/vendors.ts`。
- [ ] 联调：阿里云短信和文本审核（`ALIYUN_*`、`MODERATION_PROVIDER`）。
- [ ] 联调：国家防沉迷实名认证系统（`NPPA_*`）。**签名和加密细节要对照发行方后台的官方说明**，用后台的测试码验证。
- [ ] 接入微信开放平台 SDK（客户端还没做，需要微信开放平台账号和原生打包；服务端校验已有）。
- [ ] 请法务确认：年龄门槛、不满 14 周岁的监护人同意流程、`config/personalities.china.json` 的提示词和各性格的中文台词。
- [ ] 确认未成年人时段和节假日是最新的（后台「防沉迷与节假日」）。
- [ ] 服务器、数据库和大模型都在境内；登录日志和聊天记录保留至少 6 个月。
- [ ] 打出 APK 后确认没有 Google Play 服务依赖（Google 登录库已排除，间接依赖要看实际产物）。
