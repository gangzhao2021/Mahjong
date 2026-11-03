#!/bin/bash
# One command to set up this project on a Mac. Safe to run again: anything already there is skipped.
#
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/gangzhao2021/Mahjong/main/scripts/setup-mac.sh)"
#
# MAHJONG_DIR  where the code goes (default ~/yashirq/Mahjong)
# MINIMAL=1    skip the large apps (Android Studio, Docker, Xcode)
set -euo pipefail

REPO=gangzhao2021/Mahjong
DIR="${MAHJONG_DIR:-$HOME/yashirq/Mahjong}"
TODO=()

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
later() { TODO+=("$1"); }

[ "$(uname)" = Darwin ] || { echo '这个脚本只能在 Mac 上运行。'; exit 1; }

# --- Homebrew (also installs Apple's command line tools, which include git) --------
if ! command -v brew >/dev/null; then
  say '安装 Homebrew（会要求输入这台 Mac 的开机密码，输入时屏幕不显示）'
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  if [ -x "$b" ]; then
    eval "$("$b" shellenv)"
    # New terminal windows need it too.
    line="eval \"\$($b shellenv)\""
    grep -qsF "$line" "$HOME/.zprofile" || echo "$line" >> "$HOME/.zprofile"
    break
  fi
done

# --- Node, GitHub CLI ------------------------------------------------------------
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(node_major)" -lt 22 ]; then
  say '安装 Node 22'
  brew install node@22
  brew link --overwrite --force node@22
fi
command -v gh >/dev/null || { say '安装 GitHub 命令行工具'; brew install gh; }

# --- Sign in to GitHub (skipped without a terminal, e.g. in CI) -------------------
if [ -t 0 ] && ! gh auth status >/dev/null 2>&1; then
  say '登录 GitHub：按提示操作，会打开浏览器'
  gh auth login --hostname github.com --git-protocol https --web
fi
gh auth status >/dev/null 2>&1 && gh auth setup-git

# --- The code --------------------------------------------------------------------
if [ -d "$DIR/.git" ]; then
  say "代码已在 $DIR，更新到最新"
  git -C "$DIR" pull --ff-only || later "代码没能自动更新（可能有未提交的改动）：$DIR"
else
  say "下载代码到 $DIR"
  mkdir -p "$(dirname "$DIR")"
  git clone "https://github.com/$REPO.git" "$DIR"
fi
cd "$DIR"

# --- Dependencies: pnpm at the version the repository names -----------------------
PNPM_VERSION="$(node -p 'require("./package.json").packageManager.split("@")[1].split("+")[0]')"
if [ "$(pnpm -v 2>/dev/null || true)" != "$PNPM_VERSION" ]; then
  say "安装 pnpm $PNPM_VERSION"
  npm install -g "pnpm@$PNPM_VERSION"
fi
say '安装项目依赖'
pnpm install --frozen-lockfile

# --- Native builds and local deployment checks ------------------------------------
if [ "${MINIMAL:-}" != 1 ]; then
  say '安装原生编译和部署检查要用的工具（下载较大，可能要一段时间）'
  command -v pod >/dev/null || brew install cocoapods || later 'CocoaPods 没装上：brew install cocoapods'
  [ -d '/Applications/Android Studio.app' ] || brew install --cask android-studio || later 'Android Studio 没装上：brew install --cask android-studio'
  [ -d '/Applications/Docker.app' ] || brew install --cask docker || later 'Docker 没装上：brew install --cask docker'
  [ -d '/Applications/Android Studio.app' ] && later '打开一次 Android Studio，按向导点完，它会下载 Android SDK'
  if [ ! -d '/Applications/Xcode.app' ]; then
    # Xcode only comes from the App Store and needs an Apple ID.
    [ -t 0 ] && open 'macappstores://apps.apple.com/app/id497799835' || true
    later '在 App Store 安装 Xcode（免费，已帮你打开页面），装好后打开一次并同意协议'
  fi
fi

# --- Check it works ---------------------------------------------------------------
say '运行测试，确认环境正常（约一分钟）'
if pnpm test; then
  say "环境已就绪：$DIR"
else
  later "有测试没通过，把这个窗口的输出发给 Claude"
fi

if [ ${#TODO[@]} -gt 0 ]; then
  printf '\n\033[1;33m还有几件事要你动手：\033[0m\n'
  for t in "${TODO[@]}"; do echo "  - $t"; done
fi
printf '\n之后在 Claude 里打开这个文件夹就可以继续了：%s\n' "$DIR"
