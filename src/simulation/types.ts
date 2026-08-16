/**
 * 模拟盘领域类型。
 * 完全独立于真实券商，所有资金/持仓/成交都保存在本地存储。
 * 参考标准模拟盘（富途/同花顺模拟交易）设计：独立的虚拟账户、A 股交易规则、
 * 买入冻资、卖出 T+1 可取、手续费（佣金+印花税+过户费）、持仓盈亏实时计算。
 */
import type { Symbol } from '@/api';

/** 买卖方向 */
export type Side = 'buy' | 'sell';

/** 委托类型 */
export type OrderType = 'market' | 'limit';

/** 委托状态 */
export type OrderStatus = 'filled' | 'partial' | 'canceled' | 'rejected' | 'pending';

/** 一笔委托（模拟盘仅做即时撮合，pending 用于排队/未成交展示） */
export interface Order {
  id: string;
  symbol: Symbol;
  side: Side;
  type: OrderType;
  /** 委托价格（限价单有效；市价单为下单时参考价快照） */
  price: number;
  /** 委托数量（股，须为 100 的整数倍，除科创板/场外基金外） */
  quantity: number;
  /** 已成交数量 */
  filledQty: number;
  status: OrderStatus;
  /** 拒绝/失败原因（如资金不足、持仓不足、数量非法） */
  message?: string;
  createdAt: number;
  updatedAt: number;
}

/** 模拟盘持仓（按标的汇总，含成本与可用/冻结） */
export interface SimPosition {
  symbol: Symbol;
  /** 总持仓（股） */
  shares: number;
  /** 可用持仓（股，T+1 卖出受限，今日买入今不可卖） */
  available: number;
  /** 成本价（元/股，含买入费用摊薄） */
  costPrice: number;
  /** 今日买入数量（冻结，今日不可卖） */
  todayBuy: number;
}

/** 一笔成交记录 */
export interface Trade {
  id: string;
  orderId: string;
  symbol: Symbol;
  side: Side;
  price: number;
  quantity: number;
  /** 成交额 = price*quantity */
  amount: number;
  /** 手续费（佣金/印花/过户合计） */
  fee: number;
  /** 该笔对现金的影响：买入为负、卖出为正 */
  cashDelta: number;
  ts: number;
}

/** 模拟账户资产快照 */
export interface SimAccount {
  /** 初始虚拟资金（元） */
  initCash: number;
  /** 当前可用现金（元） */
  cash: number;
  /** 冻结资金（买入委托未成交部分占用的资金，本实现即时成交，基本为 0） */
  frozen: number;
  positions: SimPosition[];
  orders: Order[];
  trades: Trade[];
  /** 是否已完成初始化（首次进入时建仓） */
  initialized: boolean;
}

/** 资产汇总（实时市值 + 盈亏），由 calc 计算 */
export interface PortfolioSummary {
  cash: number;
  /** 持仓市值 */
  marketValue: number;
  /** 总资产 = cash + marketValue */
  totalAsset: number;
  /** 累计盈亏 = totalAsset - initCash */
  totalPnl: number;
  totalPnlPct: number;
  /** 当日盈亏（基于今日持仓的现价-成本价） */
  dayPnl: number;
  dayPnlPct: number;
}
