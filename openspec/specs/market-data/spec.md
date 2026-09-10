# market-data — 行情数据层

## Purpose

为上层提供**稳定、可缓存、跨源统一**的行情契约：实时快照、历史 K 线、财务/估值、榜单。上层不感知 fuyao / hithsa / stock-sdk 差异。

## Requirements

### R1 统一行情契约

**用户**：任意界面取行情，不关心数据来自哪家源。

**规则**
- `getQuotes(Symbol[])` / `getKline(KlineParams)` / `getIndexQuotes` / `getIndexKline` 为唯一入口
- 按 `symbol.exchange` 自动分源（A / HK / US / 基金）
- 返回类型固定为 `Quote` / `Candle` 等 app 层类型

**验收**
- A 股 600519、港股 00700、美股 AAPL 均能拿到非零 `last`
- 上游无数据时返回空数组，**不得伪造 0 价快照**

### R2 多源路由与兜底

**规则**
- `SourceRouter` 按能力声明 + 稳定分排序调度
- 某源 3004 / 失败 → 自动下一源
- 并发同参请求合并（coalesce）

**验收**
- fuyao 不支持港美股时，自动落到 stock-sdk 且 UI 无感

### R3 本地缓存与同步

**规则**
- K 线：不复权价 + 复权因子分表存；复权价运行时合成
- 行情快照：短 TTL（≤60s）秒显；禁止 24h 钉死旧价
- 全市场 K 线可后台同步，供本地扫描/回测

**验收**
- 冷启动自选页有缓存秒显
- 重启后自选、持仓、信号仍在

### R4 数据质量语义

**规则**
- `last=0 && prevClose=0` 判为无效快照
- K 线必须满足 `high≥low` 且 open/close 在区间内
- 冒烟测试（catalog `assertResult`）按语义校验，不只校验「是数组」

**验收**
- 真网集成测试 `apiLive` 通过
- 伪造 0 价会被 catalog 断言拒绝

## 未来需求（不在本期）

- [ ] Level-2 / 逐笔
- [ ] 期权链实时推送
- [ ] 因子库（财务因子、技术因子批量计算）
