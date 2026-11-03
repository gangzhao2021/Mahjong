# 真机测试

真机上才能确认的有：苹果登录、谷歌登录、音效和静音开关、钥匙串存储、横屏和刘海屏、App 切到后台再回来的重连。

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

手机和电脑连同一个 Wi-Fi，查电脑的局域网 IP（Mac 用 `ipconfig getifaddr en0`，Windows 用 `ipconfig`），然后新建 `apps/mobile/.env.local`（不进 git），写入：

```
EXPO_PUBLIC_SERVER_URL=http://电脑IP:8787
```

开发版的 JS 由电脑上的开发服务器提供，地址从这个文件读取，`eas.json` 里 `development` 配置的值在这里不起作用。IP 变了只要改这个文件，再重启开发服务器（`pnpm mobile --clear`），不用重新打包。

启动服务端：

```bash
pnpm server
```

系统防火墙第一次可能询问是否允许 Node.js 访问网络，选“允许”。

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

装好后，电脑上启动开发服务器，手机打开刚装的应用，扫码连接（也可以在应用里手动输入终端显示的地址）：

```bash
pnpm mobile
```

## 没有手机时：用 iOS 模拟器

Mac 上装了 Xcode 就行，不需要苹果开发者账号。模拟器测不了静音开关和手感，上架前还是要在真机上跑一遍。

```bash
cd apps/mobile && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo prebuild --platform ios
```

终端不是 UTF-8 时 `pod install` 会失败，所以这里要带 `LANG`。`prebuild` 可能改掉 `package.json` 里的 `ios`、`android` 脚本，不要提交这个改动。

```bash
cd apps/mobile && xcodebuild -workspace ios/app.xcworkspace -scheme app -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -derivedDataPath ios/build build
```

设备名换成 `xcrun simctl list devices available` 里有的。我们用 `xcodebuild` 而不是 `expo run:ios`，因为后者曾把模拟器当成真机，报 `No code signing certificates`。

```bash
xcrun simctl install booted apps/mobile/ios/build/Build/Products/Debug-iphonesimulator/app.app
```

然后运行 `pnpm mobile`，在模拟器里打开应用，选列出的开发服务器，或手动输入 `http://localhost:8081`。

用 Xcode 27 编译时，应用必须采用 UIScene 生命周期，否则一启动就崩溃。`app.json` 里 `expo-build-properties` 的 `ios.enableSceneSupport` 就是为此开的。升级到 Expo SDK 58 后默认支持，到时可以去掉。

## 没有手机时：用 Android 模拟器

本机编译不用排 EAS 的队，第一次大约 4 分钟（Apple 芯片，只编 arm64）。模拟器一样测不了手感和声音，上架前还是要在真机上跑一遍。

```bash
brew install openjdk@17 && brew install --cask android-commandlinetools
```

```bash
export JAVA_HOME="$(brew --prefix openjdk@17)" ANDROID_HOME="$HOME/Library/Android/sdk"
```

下面的命令都要在设了这两个变量的终端里运行。第一条会让你逐份确认 SDK 许可协议。

```bash
"$(brew --prefix)/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" --licenses
```

```bash
"$(brew --prefix)/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" "cmdline-tools;latest" platform-tools emulator "platforms;android-36" "system-images;android-36;google_apis;arm64-v8a"
```

系统镜像下载偶尔会解压失败，重跑一次就好。创建设备要用刚装进 SDK 的 `avdmanager`，Homebrew 那份找不到系统镜像。

```bash
echo no | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n mahjong_test -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7
```

```bash
"$ANDROID_HOME/emulator/emulator" -avd mahjong_test
```

```bash
cd apps/mobile && npx expo prebuild --platform android --no-install && cd android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a
```

和 iOS 一样，不要提交 `prebuild` 对 `package.json` 的改动。

```bash
"$ANDROID_HOME/platform-tools/adb" install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

然后运行 `pnpm mobile`，再把开发服务器端口转给模拟器，并打开应用：

```bash
"$ANDROID_HOME/platform-tools/adb" reverse tcp:8081 tcp:8081
```

```bash
"$ANDROID_HOME/platform-tools/adb" shell am start -a android.intent.action.VIEW -d "mahjonggame://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

服务器地址和真机一样来自 `apps/mobile/.env.local`，填电脑的局域网 IP。

## 5. 测试清单

- [ ] 首次启动显示隐私同意；不同意时只能学教程
- [ ] 游客登录、苹果登录（iOS）、谷歌登录（需先在 Google Cloud 配好客户端 ID，见 README 的环境变量）
- [ ] 新手教程 6 课都能走完
- [ ] 打完一整场：换三张、定缺、碰、杠、胡，结算和金币正确
- [ ] 音效、背景音乐；手机静音开关打开时不出声；不打断正在听的音乐；大厅和牌桌的静音按钮能关掉所有声音（包括语音）
- [ ] 系统朗读：碰杠胡播报、出牌报牌名、AI 台词朗读在 iOS 和 Android 上都能出声，中文发音正常
- [ ] 横屏，刘海屏和圆角不遮挡按钮；小屏手机（如 iPhone SE）上手牌放得下；小屏横屏时顶栏收进「⋯」，对家卡片不压住局数信息
- [ ] 竖屏：三家对手在顶部一行，牌河的牌看得清；碰杠牌和胡牌后亮出的手牌在卡片下面能看清
- [ ] 牌桌辅助：换进来的三张有蓝色标记；轮到出牌时能听牌的牌上方有「听」（可以自摸时不显示）；碰杠按钮上有倒计时；能暗杠时有紫色大按钮
- [ ] 防误触：换三张后马上点同一位置，不会误选定缺；碰杠选项刚弹出时点不中
- [ ] AI 强弱：各场次卡片显示对手强度，AI 名字旁有新手/中等/高手；练习场切换难度后开局生效，「再来一场」保持同一场次和难度
- [ ] 打到一半切到后台 1 分钟再回来：自动重连、回到原牌桌
- [ ] 打到一半关掉 Wi-Fi 再打开：显示“正在重新连接”，恢复后接着打
- [ ] 打到一半重启服务端：重连后回到原牌桌
- [ ] 切换中英文
- [ ] 注销账号
- [ ] 后台“崩溃报告”页没有新的崩溃

发现问题时，把手机型号、系统版本和操作步骤记下来；能截图或录屏最好。
