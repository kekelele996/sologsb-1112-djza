/** 网具状态（收网时登记） */
export type NetCondition = '完好' | '破损待修' | '遗失';

export const NET_CONDITIONS: NetCondition[] = ['完好', '破损待修', '遗失'];

/** 风力达到该级别即触发安全提示（需尽快收网） */
export const WIND_ALERT_LEVEL = 5;

/** 网次安全台账：一次开网到收网的完整登记 */
export interface NetSession {
  id: string;
  /** 所属调查批次 id */
  sessionId: string;
  /** 网号 */
  netNo: string;
  /** 开网时间 HH:mm */
  openedAt: string;
  /** 开网时风力（级） */
  windForce: number;
  /** 看护人 */
  keeper: string;
  /** 收网时间 HH:mm（未收网为空） */
  closedAt?: string;
  /** 收鸟数（只） */
  birdCount?: number;
  /** 收网时网具状态 */
  netCondition?: NetCondition;
  /** 备注 */
  note?: string;
}

/** 是否已收网 */
export function isNetClosed(net: NetSession): boolean {
  return Boolean(net.closedAt);
}
