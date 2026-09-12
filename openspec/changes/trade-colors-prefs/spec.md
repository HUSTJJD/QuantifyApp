# change: trade-colors-prefs — 涨跌色与数字层级可配置（下一阶段第一优先）

> **状态：已交付（2026-09-12）**。。对标 moomoo/Webull/同花顺：默认 A 股红涨绿跌，支持绿涨红跌（国际习惯）与色弱友好模式。

## Why

多市场用户（A/港/美）对涨跌色习惯不同：A 股红涨，美股/港股常绿涨。当前硬编码 `up/down`，无法切换，跨市场盯盘易误判。头部 App 均提供「涨跌色」设置。

## What Changes

### 1. 偏好项

`appPrefs`：

```ts
upDownScheme: 'cn' | 'intl' | 'colorblind'
// cn: 红涨绿跌（默认）
// intl: 绿涨红跌
// colorblind: 蓝涨橙跌
```

### 2. ColorScheme 派生

`getColors(mode, scheme)`：

- `up/down` 按 scheme 映射
- `success/warning` 不强制跟随涨跌（避免语义混乱）
- 决策卡档位色、PaperBadge 保持 primary 系

### 3. 设置页

外观区增加「涨跌色」三选一 chips，即时生效（Theme 重渲染）。

### 4. 兼容

- 默认 `cn`，零行为变化
- 所有 `colors.up/down` 业务点无需改代码

## Impact

- Affected: `src/theme/index.ts` `ThemeProvider.tsx` `settings/appPrefs.ts` `SettingsScreen.tsx`
- Risks: 无

## Acceptance

1. 切换 intl 后自选/详情涨跌色反转
2. 重启保持选择
3. 决策卡/PAPER 角标不误变色
