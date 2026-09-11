/**
 * 因子注册表：全部可调参因子。
 * 新增因子 = 在此注册一个 FactorDef，引擎自动可用。
 */
import type { FactorDef } from '../types';
import { defaultFactorParams } from '../types';
import { maCrossFactor } from './ma';
import { macdFactor } from './macd';
import { rsiFactor } from './rsi';
import { volumeRatioFactor } from './volume';
import { breakoutFactor } from './breakout';
import { bollingerFactor } from './boll';
import { maTrendFactor } from './trend';

export const FACTORS: FactorDef[] = [
  maCrossFactor,
  macdFactor,
  rsiFactor,
  volumeRatioFactor,
  breakoutFactor,
  bollingerFactor,
  maTrendFactor,
];

const byId = new Map(FACTORS.map((f) => [f.id, f]));

export function getFactor(id: string): FactorDef | undefined {
  return byId.get(id);
}

export {
  maCrossFactor,
  macdFactor,
  rsiFactor,
  volumeRatioFactor,
  breakoutFactor,
  bollingerFactor,
  maTrendFactor,
  defaultFactorParams,
};
