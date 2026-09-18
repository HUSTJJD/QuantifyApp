# QuantifyApp · 锐见 SharpView

面向 A 股主战场的量化洞察与行情终端（Expo SDK 57 / RN 0.86）。

## 快速开始

```bash
npm install
npx expo start
# 本地原生调试（CNG，按需生成）
npx expo prebuild
npm run ios   # 或 npm run android
```

## 工程结构

```
src/
  domain/          # 纯领域类型与工具（SignalSide/TradeSignal/AlertEvent/symbol）
  data/            # 行情 API 多源路由、SQLite、缓存、同步、仓储
  quant/
    core/          # 多因子框架：factors / templates / engine
    profile.ts     # 策略档案模型（legs + combineMode）
    profileStore.ts
    signals.ts     # 档案驱动信号
    signalStore.ts
    signalAlerts.ts
    runtime.ts     # 常驻运行时：信号重算 + 自动交易
    backtest/      # （模块文件）回测、优化、walk-forward
  simulation/      # 模拟盘账户与撮合
  features/        # UI 按业务域分包
  components/      # ui + charts
  navigation/ theme/ hooks/ utils/ polyfills/
tests/             # 统一测试目录（data / quant / ui / domain / integration）
```

## 模型约定

- **策略档案** = `legs: StrategyLeg[]` + `combineMode`（and/or/vote）+ 选股 + 风控。
- `templateId` **只属于腿**，档案上没有「信号内核」绑定。
- 信号与自动交易都以档案为唯一驱动：`src/quant/runtime.ts`。

## 数据源与符号

- App 规范符号：对象 `{ code, exchange }`，唯一字符串键 `symbolKey()` = **`CODE.EXCHANGE`**（如 `600519.SH`）。
- 禁止反序键 `EXCHANGE.CODE`；DB / 缓存 / 信号键一律走 `symbolKey()`。
- 各源线格式由 codec 负责（`src/data/api/sources/codecs/`）：

| 源 | codec | 线格式 | 覆盖 |
|----|-------|--------|------|
| fuyao | `fuyaoCodec` | thscode `600519.SH` | SH/SZ/BJ/TI/OF |
| stock-sdk | `stockSdkCodec` | 裸代码 `600519` + 市场 ns | SH/SZ/BJ/HK/US/OF/EM |
| longport | `longportCodec` | `700.HK` / `AAPL.US` | HK/US |
| dukascopy | `dukascopyCodec` | instrument id | 全球指数白名单 |
| fund-api | `fundApiCodec` | 数字基金代码 | OF |

- 可移植能力：`marketData.*`（SourceRouter 自动调度/兜底）。
- 源专属 API 直通：`marketData.source(id)` + `src.codec`。
- 本地 SQLite：**无迁移**。`SCHEMA_VERSION` 变更时 `db.delete()` 删库重建，数据不保留。

## 数据源与子模块

- `stock-sdk`、`FuyaoNPM` 为 git 子模块（`file:` 依赖），克隆请 `--recurse-submodules`。
- postinstall 会自动构建本地 SDK 的 `dist/`。
- 未使用的研究仓库（dukascopy-node / myhhub-stock）仍可作为子模块保留，App 代码不再直接依赖其源码树。

## 原生构建（CNG）

仓库**不**检入 `android/` `ios/`。需要原生调试时：

```bash
npx expo prebuild --clean
```

原生模块（op-sqlite / Skia / vector-icons 等）由 Expo autolinking 接入。

## 脚本

| 命令 | 说明 |
|------|------|
| `npm start` | Expo dev server |
| `npm run typecheck` | `tsc -p tsconfig.app.json --noEmit` |
| `npm test` | Jest（roots: src / tests） |
| `npm run lint` | expo lint |
| `npm run validate` | typecheck + test |

## 设计规范

视觉与信息架构见 [DESIGN.md](./DESIGN.md)（锐见 · 终端密度）。
