# 真机测试

到目前为止只在浏览器（网页版）上验证过。真机上才能确认的有：苹果登录、谷歌登录、音效和静音开关、钥匙串存储、横屏和刘海屏、App 切到后台再回来的重连。

应用用到了 Expo Go 不带的原生模块（谷歌登录），所以要打一个**开发版**装到手机上，之后改代码会热更新，不用每次重新打包。

## 1. 一次性准备

1. 注册 Expo 账号：https://expo.dev/signup
2. 登录：

```bash
npx eas-cli@latest login
```

3. 在 `apps/mobile` 里关联项目（会在 `app.json` 里写入 `projectId`）：

```bash
cd apps/mobile && npx eas-cli@latest init
```

4. iOS 需要苹果开发者账号（每年 99 美元）；第一次打包时 EAS 会引导登录并自动生成证书，还要注册测试手机（按提示扫码即可）。Android 不需要账号。

## 2. 让手机连上电脑上的服务端

手机和电脑连同一个 Wi-Fi，查电脑的局域网 IP（Windows 用 `ipconfig`），然后把 `apps/mobile/eas.json` 里 `development` 配置的 `EXPO_PUBLIC_SERVER_URL` 改成 `http://电脑IP:8787`。启动服务端：

```bash
pnpm server
```

Windows 防火墙第一次会询问是否允许 Node.js 访问网络，选“允许”。

## 3. 打开发版

Android（生成 APK，下载链接手机上直接打开安装）：

```bash
cd apps/mobile && npx eas-cli@latest build --profile development --platform android
```

iOS：

```bash
cd apps/mobile && npx eas-cli@latest build --profile development --platform ios
```

打包在 EAS 云端进行，一般 10–20 分钟，免费账号可能要排队。

## 4. 运行

装好后，电脑上启动开发服务器，手机打开刚装的应用，扫码连接：

```bash
pnpm mobile
```

## 5. 测试清单

- [ ] 首次启动显示隐私同意；不同意时只能学教程
- [ ] 游客登录、苹果登录（iOS）、谷歌登录（需先在 Google Cloud 配好客户端 ID，见 README 的环境变量）
- [ ] 新手教程 6 课都能走完
- [ ] 打完一整场：换三张、定缺、碰、杠、胡，结算和金币正确
- [ ] 音效、背景音乐；手机静音开关打开时不出声；不打断正在听的音乐
- [ ] 横屏，刘海屏和圆角不遮挡按钮；小屏手机（如 iPhone SE）上手牌放得下
- [ ] 打到一半切到后台 1 分钟再回来：自动重连、回到原牌桌
- [ ] 打到一半关掉 Wi-Fi 再打开：显示“正在重新连接”，恢复后接着打
- [ ] 打到一半重启服务端：重连后回到原牌桌
- [ ] 切换中英文
- [ ] 注销账号
- [ ] 后台“崩溃报告”页没有新的崩溃

发现问题时，把手机型号、系统版本和操作步骤记下来；能截图或录屏最好。
