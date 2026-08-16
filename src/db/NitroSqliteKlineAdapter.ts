/**
 * 原生 SQLite K 线引擎适配器骨架（预留，尚未接入）。
 *
 * 目标：用 react-native-nitro-sqlite（或 op-sqlite）做真正的行级数据库，
 * 比 AsyncStorage 整表序列化更快、支持索引与区间查询，最适合高频盯盘。
 *
 * 接入步骤（后续）：
 *   1) yarn add react-native-nitro-sqlite
 *   2) cd ios && pod install ; 安卓无需额外设置
 *   3) 在 database() 工厂里把 return new AsyncStorageKlineAdapter() 换成 new NitroSqliteKlineAdapter()
 *   4) 填充下面的 TODO 方法（建表 / upsert / 查询 / 清理）
 *
 * 表结构（参考）：
 *   CREATE TABLE kline (
 *     symbol   TEXT NOT NULL,
 *     period   TEXT NOT NULL,
 *     ts       INTEGER NOT NULL,
 *     open     REAL, high REAL, low REAL, close REAL,
 *     volume   REAL, amount REAL, updatedAt INTEGER,
 *     PRIMARY KEY (symbol, period, ts)
 *   );
 *   CREATE INDEX idx_kline_sym_period ON kline(symbol, period, ts);
 */
import type { KlinePeriod, Symbol } from '@/api';
import { KlineRow } from './KlineSchema';
import type { KlineDatabasePort } from './KlineDatabase';

export class NitroSqliteKlineAdapter implements KlineDatabasePort {
  // TODO: 持有 SQLite 连接实例（open db 'kline.db'）
  // private db = openDatabase('kline.db');

  async ensureSchema(): Promise<void> {
    // TODO: 执行建表（IF NOT EXISTS），version 表记录 KLINE_DB_VERSION
    throw new Error('NitroSqliteKlineAdapter 尚未接入：请参考文件头注释完成实现');
  }

  async upsert(_rows: KlineRow[]): Promise<number> {
    // TODO: BEGIN TRANSACTION; INSERT OR REPLACE INTO kline(...) VALUES(...); COMMIT;
    throw new Error('NitroSqliteKlineAdapter 尚未接入');
  }

  async getSeries(_symbol: Symbol, _period: KlinePeriod): Promise<KlineRow[]> {
    // TODO: SELECT * FROM kline WHERE symbol=? AND period=? ORDER BY ts ASC;
    throw new Error('NitroSqliteKlineAdapter 尚未接入');
  }

  async getRange(
    _symbol: Symbol,
    _period: KlinePeriod,
    _fromTs?: number,
    _toTs?: number,
  ): Promise<KlineRow[]> {
    // TODO: SELECT * FROM kline WHERE symbol=? AND period=? AND ts BETWEEN ? AND ? ORDER BY ts ASC;
    throw new Error('NitroSqliteKlineAdapter 尚未接入');
  }

  async getLatest(
    _symbol: Symbol,
    _period: KlinePeriod,
    _limit?: number,
  ): Promise<KlineRow[]> {
    // TODO: SELECT * FROM kline WHERE symbol=? AND period=? ORDER BY ts DESC LIMIT ?;（再反转）
    throw new Error('NitroSqliteKlineAdapter 尚未接入');
  }

  async deleteSymbol(_symbol: Symbol, _period?: KlinePeriod): Promise<void> {
    // TODO: DELETE FROM kline WHERE symbol=? AND (period=? OR 1=1);
    throw new Error('NitroSqliteKlineAdapter 尚未接入');
  }

  async prune(_beforeTs: number): Promise<number> {
    // TODO: DELETE FROM kline WHERE updatedAt < ?; 返回 changes()
    throw new Error('NitroSqliteKlineAdapter 尚未接入');
  }

  async count(): Promise<number> {
    // TODO: SELECT COUNT(*) FROM kline;
    throw new Error('NitroSqliteKlineAdapter 尚未接入');
  }

  async close(): Promise<void> {
    // TODO: db.close()
  }
}

/** 供 database() 工厂判断是否可用（当前恒 false，接入后改为检测依赖） */
export function isNitroSqliteAvailable(): boolean {
  return false;
}
