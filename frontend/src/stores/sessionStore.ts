import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { SurveySession } from '../types/session';
import { useNetLogStore } from './netLogStore';

export interface SessionInput {
  sessionNo: string;
  date: string;
  siteId: string;
  startedAt: string;
  endedAt: string;
  netRounds: number;
  cloudCover: number;
  windForce: number;
  leader: string;
  remark?: string;
}

interface SessionState {
  sessions: SurveySession[];
  hydrated: boolean;
}

/** 调查批次与统计派生值 */
export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({ sessions: [], hydrated: false }),

  getters: {
    byId(state) {
      return (id: string): SurveySession | undefined => state.sessions.find((session) => session.id === id);
    },
    sessionOptions(state): Array<{ label: string; value: string }> {
      return state.sessions.map((session) => ({
        label: `${session.sessionNo} · ${session.date} · ${session.closed ? '已关闭' : '进行中'}`,
        value: session.id,
      }));
    },
    openSessions(state): SurveySession[] {
      return state.sessions.filter((session) => !session.closed);
    },
  },

  actions: {
    async hydrate() {
      this.sessions = await db.sessions.orderBy('date').reverse().toArray();
      this.hydrated = true;
    },

    async addSession(input: SessionInput): Promise<SurveySession> {
      const session: SurveySession = {
        id: uid('session'),
        sessionNo: input.sessionNo.trim(),
        date: input.date,
        siteId: input.siteId,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        netRounds: Number(input.netRounds) || 0,
        cloudCover: Number(input.cloudCover) || 0,
        windForce: Number(input.windForce) || 0,
        closed: false,
        leader: input.leader.trim(),
        remark: input.remark?.trim() || undefined,
      };
      await db.sessions.put(toPlain(session));
      this.sessions = [session, ...this.sessions];
      return session;
    },

    async updateSession(id: string, patch: Partial<SessionInput>) {
      const current = this.sessions.find((session) => session.id === id);
      if (!current) return;
      const next: SurveySession = { ...current, ...patch };
      await db.sessions.put(toPlain(next));
      this.sessions = this.sessions.map((session) => (session.id === id ? next : session));
    },

    /** 确认现场无遗留：全部网具收回后才能确认，确认后台账锁定 */
    async confirmSiteCleared(id: string) {
      const current = this.sessions.find((session) => session.id === id);
      if (!current || current.closed || current.siteCleared) return;
      const openNets = useNetLogStore().openBySession(id);
      if (openNets.length > 0) {
        throw new Error(`还有 ${openNets.length} 张网未收（${openNets.map((log) => log.netNo).join('、')}），不能确认现场无遗留`);
      }
      const next: SurveySession = { ...current, siteCleared: true, clearedAt: new Date().toISOString() };
      await db.sessions.put(toPlain(next));
      this.sessions = this.sessions.map((session) => (session.id === id ? next : session));
    },

    /** 撤销现场确认（批次关闭前允许更正，撤销后可继续登记开/收网） */
    async revokeSiteCleared(id: string) {
      const current = this.sessions.find((session) => session.id === id);
      if (!current || current.closed || !current.siteCleared) return;
      const next: SurveySession = { ...current, siteCleared: undefined, clearedAt: undefined };
      await db.sessions.put(toPlain(next));
      this.sessions = this.sessions.map((session) => (session.id === id ? next : session));
    },

    /** 关闭批次：所有网收完并确认现场无遗留后才能关闭，关闭后出统计 */
    async closeSession(id: string) {
      const current = this.sessions.find((session) => session.id === id);
      if (!current) return;
      const openNets = useNetLogStore().openBySession(id);
      if (openNets.length > 0) {
        throw new Error(`还有 ${openNets.length} 张网未收：${openNets.map((log) => log.netNo).join('、')}，请先收网`);
      }
      if (!current.siteCleared) {
        throw new Error('尚未确认现场无遗留，请先在网次台账中完成现场确认');
      }
      const next: SurveySession = { ...current, closed: true, endedAt: current.endedAt || new Date().toTimeString().slice(0, 5) };
      await db.sessions.put(toPlain(next));
      this.sessions = this.sessions.map((session) => (session.id === id ? next : session));
    },

    async removeSession(id: string) {
      await db.sessions.delete(id);
      this.sessions = this.sessions.filter((session) => session.id !== id);
    },
  },
});
