# 品牌名和玩法名

品牌是整个游戏的名字，玩法是其中一种规则。第一版只有四川血战到底一种玩法，但品牌不绑定四川，以后加广东、国标等玩法时不用改品牌。

## 规则

| 类别 | 用什么名字 | 例子 |
|---|---|---|
| 品牌：应用名、Slug、scheme、包名、商店页、登录页和大厅标题、协议页里的游戏名、好友邀请 | 通用名，不写具体玩法 | 麻将 / Mahjong，`mahjong-game`，`mahjonggame://` |
| 玩法：牌桌副标题、规则说明、教程、AI 台词和提示词 | 写明具体玩法 | 四川血战 / Sichuan Bloody Battle |

新增文案或代码时先判断它属于哪一类。说的是整个游戏就用通用名；只对某种玩法成立的内容（比如“不能吃”“108 张牌”）才写玩法名。

现在的“麻将 / Mahjong”是临时名，正式名字定下后要改的地方见 [release-checklist.md](release-checklist.md)。

## 现在还绑定四川玩法的地方

这些写法目前没有错，因为只有这一种玩法。加第二种玩法时要改成按玩法区分：

- **文案和内容：** `apps/mobile/src/strings.ts` 的 `brandSub` 和 `firstTime`，`apps/mobile/src/tutorial/lessons.ts`，`apps/mobile/src/rules/`，`docs/sichuan-voice-script.md`。
- **AI：** `packages/dialogue/src/prompt.ts` 里的规则说明，`packages/dialogue/src/templates.ts`，`packages/ai-play/src/`（打法和向听计算）。
- **规则引擎：** `packages/engine/src/`。`RuleSet` 现在只能调四川麻将内部的选项，牌型也只有万、条、筒，没有字牌和吃牌。
