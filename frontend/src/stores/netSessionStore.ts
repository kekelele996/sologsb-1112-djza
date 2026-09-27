import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { isNetClosed, type NetCondition, type NetSession } from '../types/net-session';

export interface NetOpenInput {
  sessionId: string;
  netNo: string;
  openedAt: string;
  windForce: number;
  keeper: string;
  note?: string;
}

export interface NetCloseInput {
  closedAt: string;
  birdCount: number;
  netCondition: NetCondition;
  note?: string;
}

interface NetSessionState {
  netSessions: NetSession[];
  hydrated: boolean;
}

/** 网次安全台账：开网 / 收网登记与待收网核查 */
export const useNetSessionStore = defineStore('netSession', {
  state: (): NetSessionState => ({ netSessions: [], hydrated: false }),

  getters: {
    /** 某批次的全部网次（按开网时间升序） */
    bySession(state) {
      return (sessionId: string): NetSession[] =>
        state.netSessions
          .filter((net) => net.sessionId === sessionId)
          .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    },
    /** 某批次仍在看护（未收网）的网次 */
    openBySession(state) {
      return (sessionId: string): NetSession[] =>
        state.netSessions.filter((net) => net.sessionId === sessionId && !isNetClosed(net));
    },
  },

  actions: {
    async hydrate() {
      this.netSessions = await db.netSessions.toArray();
      this.hydrated = true;
    },

    /** 开网登记：同批次内同一网号未收网时不允许再次开网 */
    async openNet(input: NetOpenInput): Promise<{ net?: NetSession; conflict?: NetSession }> {
      const netNo = input.netNo.trim();
      const conflict = this.netSessions.find(
        (net) => net.sessionId === input.sessionId && net.netNo === netNo && !isNetClosed(net),
      );
      if (conflict) {
        return { conflict };
      }
      const net: NetSession = {
        id: uid('net'),
        sessionId: input.sessionId,
        netNo,
        openedAt: input.openedAt,
        windForce: Number(input.windForce) || 0,
        keeper: input.keeper.trim(),
        note: input.note?.trim() || undefined,
      };
      await db.netSessions.put(toPlain(net));
      this.netSessions = [...this.netSessions, net];
      return { net };
    },

    /** 收网登记：填写收鸟数与网具状态；已收网的记录不重复登记 */
    async closeNet(id: string, input: NetCloseInput) {
      const current = this.netSessions.find((net) => net.id === id);
      if (!current || isNetClosed(current)) return;
      const next: NetSession = {
        ...current,
        closedAt: input.closedAt,
        birdCount: Number(input.birdCount) || 0,
        netCondition: input.netCondition,
        note: input.note?.trim() || current.note,
      };
      await db.netSessions.put(toPlain(next));
      this.netSessions = this.netSessions.map((net) => (net.id === id ? next : net));
    },

    async removeNet(id: string) {
      await db.netSessions.delete(id);
      this.netSessions = this.netSessions.filter((net) => net.id !== id);
    },

    /** 批次删除时同步清理其台账 */
    async removeBySession(sessionId: string) {
      await db.netSessions.where('sessionId').equals(sessionId).delete();
      this.netSessions = this.netSessions.filter((net) => net.sessionId !== sessionId);
    },
  },
});
