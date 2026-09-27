/** 网具状态（收网时登记） */
export type NetCondition = '完好' | '轻微破损' | '破损需修' | '遗失';

export const NET_CONDITIONS: NetCondition[] = ['完好', '轻微破损', '破损需修', '遗失'];

/** 大风预警风力（级）：开网登记或批次风力达到该值即提示收网 */
export const WIND_ALERT_FORCE = 5;

/** 网次安全台账条目：一次「开网 → 收网」的完整记录 */
export interface NetLog {
  id: string;
  /** 所属调查批次 id */
  sessionId: string;
  /** 网号，如「3 号网」 */
  netNo: string;
  /** 开网时间 HH:mm */
  openedAt: string;
  /** 开网时风力（级） */
  windForce: number;
  /** 看护人 */
  keeper: string;
  /** 收网时间 HH:mm（空表示仍在开网中） */
  closedAt?: string;
  /** 收鸟数（收网时登记） */
  birdCount?: number;
  /** 网具状态（收网时登记） */
  netCondition?: NetCondition;
}

/** 是否仍在开网中（未收网） */
export function isNetOpen(log: NetLog): boolean {
  return !log.closedAt;
}
