# 上架检查清单（PRD 附录 C / D）

代码里能做的已经做了；下面是上架前必须由人完成或确认的事项。

## 两个版本都需要

- [ ] 把 `app.json` 里的 bundle ID / package `com.example.mahjong` 换成正式的。
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
- [ ] 接入短信服务商、国家防沉迷实名认证系统、微信开放平台 SDK、第三方内容安全服务。
- [ ] 服务器、数据库和大模型都在境内；登录日志和聊天记录保留至少 6 个月。
- [ ] 安卓包里没有 Google Play 服务依赖。
