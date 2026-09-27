import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { NetCondition, NetLog } from '../types/net-log';

export interface NetOpenInput {
  sessionId: string;
  netNo: string;
  openedAt: string;
  windForce: number;
  keeper: string;
}

export interface NetCloseInput {
  closedAt: string;
  birdCount: number;
  netCondition: NetCondition;
}

interface NetLogState {
  logs: NetLog[];
  hydrated: boolean;
}

/** 网次安全台账：开网登记 → 收网登记 → 现场确认 */
export const useNetLogStore = defineStore('netLog', {
  state: (): NetLogState => ({ logs: [], hydrated: false }),

  getters: {
    /** 某批次的全部台账（按开网时间、网号排序） */
    bySession(state) {
      return (sessionId: string): NetLog[] =>
        state.logs
          .filter((log) => log.sessionId === sessionId)
          .sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.netNo.localeCompare(b.netNo));
    },
    /** 某批次仍未收网的台账 */
    openBySession(state) {
      return (sessionId: string): NetLog[] => state.logs.filter((log) => log.sessionId === sessionId && !log.closedAt);
    },
    openCountBySession(state) {
      return (sessionId: string): number => state.logs.filter((log) => log.sessionId === sessionId && !log.closedAt).length;
    },
  },

  actions: {
    async hydrate() {
      this.logs = await db.netlogs.toArray();
      this.hydrated = true;
    },

    /** 开网登记：同一网号未收网时不允许再次开网 */
    async openNet(input: NetOpenInput): Promise<NetLog> {
      const netNo = input.netNo.trim();
      if (!netNo) throw new Error('请填写网号');
      if (!input.keeper.trim()) throw new Error('请填写看护人');
      const duplicated = this.logs.find((log) => log.sessionId === input.sessionId && log.netNo === netNo && !log.closedAt);
      if (duplicated) {
        throw new Error(`网号「${netNo}」尚未收网（${duplicated.openedAt} 开网，看护人 ${duplicated.keeper}），不能再次开网`);
      }
      const log: NetLog = {
        id: uid('netlog'),
        sessionId: input.sessionId,
        netNo,
        openedAt: input.openedAt,
        windForce: Number(input.windForce) || 0,
        keeper: input.keeper.trim(),
      };
      await db.netlogs.put(toPlain(log));
      this.logs = [...this.logs, log];
      return log;
    },

    /** 收网登记：填写收鸟数与网具状态 */
    async closeNet(id: string, input: NetCloseInput) {
      const current = this.logs.find((log) => log.id === id);
      if (!current) return;
      if (current.closedAt) throw new Error(`网号「${current.netNo}」已收网，请勿重复登记`);
      if (input.closedAt < current.openedAt) throw new Error(`收网时间不能早于开网时间（${current.openedAt}）`);
      const next: NetLog = {
        ...current,
        closedAt: input.closedAt,
        birdCount: Math.max(0, Number(input.birdCount) || 0),
        netCondition: input.netCondition,
      };
      await db.netlogs.put(toPlain(next));
      this.logs = this.logs.map((log) => (log.id === id ? next : log));
    },

    async removeLog(id: string) {
      await db.netlogs.delete(id);
      this.logs = this.logs.filter((log) => log.id !== id);
    },

    /** 批次删除时级联清理台账 */
    async removeBySession(sessionId: string) {
      const ids = this.logs.filter((log) => log.sessionId === sessionId).map((log) => log.id);
      if (ids.length === 0) return;
      await db.netlogs.bulkDelete(ids);
      this.logs = this.logs.filter((log) => log.sessionId !== sessionId);
    },
  },
});
