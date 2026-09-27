<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useSessionStore } from '../../stores/sessionStore';
import { useSiteStore } from '../../stores/siteStore';
import { useNetLogStore } from '../../stores/netLogStore';
import { NET_CONDITIONS, WIND_ALERT_FORCE, type NetCondition, type NetLog } from '../../types/net-log';
import { formatDateTime } from '../../utils/format';

const props = defineProps<{ sessionId: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const sessionStore = useSessionStore();
const siteStore = useSiteStore();
const netLogStore = useNetLogStore();

const session = computed(() => sessionStore.byId(props.sessionId));
const logs = computed(() => netLogStore.bySession(props.sessionId));
const openLogs = computed(() => logs.value.filter((log) => !log.closedAt));
const openNetNos = computed(() => openLogs.value.map((log) => log.netNo));

/** 批次关闭后只读；确认现场无遗留后锁定登记（可撤销） */
const locked = computed(() => Boolean(session.value?.closed || session.value?.siteCleared));

/** 已用网次 = 开网登记条数 */
const usedRounds = computed(() => logs.value.length);
const roundsUsedUp = computed(() => (session.value ? usedRounds.value >= session.value.netRounds : false));
/** 当前风力取批次与历次开网登记中的最大值 */
const maxWind = computed(() => Math.max(session.value?.windForce ?? 0, ...logs.value.map((log) => log.windForce), 0));
const windAlert = computed(() => maxWind.value >= WIND_ALERT_FORCE);
const showAlert = computed(() => openLogs.value.length > 0 && (roundsUsedUp.value || windAlert.value));
const alertReasons = computed(() => {
  const reasons: string[] = [];
  if (roundsUsedUp.value) reasons.push(`计划网次 ${session.value?.netRounds ?? 0} 次已用完`);
  if (windAlert.value) reasons.push(`风力已达 ${maxWind.value} 级（≥${WIND_ALERT_FORCE} 级）`);
  return reasons.join('；');
});

/** 网号候选：按鸟点网数生成「N 号网」，也允许手动输入 */
const netNoOptions = computed(() => {
  const site = siteStore.sites.find((item) => item.id === session.value?.siteId);
  const count = site && site.netCount > 0 ? site.netCount : 12;
  return Array.from({ length: count }, (_, i) => `${i + 1} 号网`);
});

function nowTime(): string {
  return new Date().toTimeString().slice(0, 5);
}

const openForm = reactive({
  netNo: '',
  openedAt: nowTime(),
  windForce: session.value?.windForce ?? 0,
  keeper: session.value?.leader ?? '',
});
const opening = ref(false);

async function submitOpen() {
  if (!session.value) return;
  opening.value = true;
  try {
    const log = await netLogStore.openNet({
      sessionId: session.value.id,
      netNo: openForm.netNo,
      openedAt: openForm.openedAt || nowTime(),
      windForce: Number(openForm.windForce) || 0,
      keeper: openForm.keeper,
    });
    if (log.windForce >= WIND_ALERT_FORCE) {
      ElMessage.warning(`已登记开网，但风力已达 ${log.windForce} 级，请密切关注并及时收网`);
    } else {
      ElMessage.success(`已登记开网：${log.netNo} ${log.openedAt}`);
    }
    openForm.netNo = '';
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    opening.value = false;
  }
}

const closeTarget = ref<NetLog | null>(null);
const closeForm = reactive({ closedAt: '', birdCount: 0, netCondition: '完好' as NetCondition });
const closing = ref(false);

function openCloseDialog(log: NetLog) {
  closeTarget.value = log;
  closeForm.closedAt = nowTime();
  closeForm.birdCount = 0;
  closeForm.netCondition = '完好';
}

async function submitClose() {
  const target = closeTarget.value;
  if (!target) return;
  closing.value = true;
  try {
    await netLogStore.closeNet(target.id, {
      closedAt: closeForm.closedAt || nowTime(),
      birdCount: closeForm.birdCount,
      netCondition: closeForm.netCondition,
    });
    ElMessage.success(`已收网：${target.netNo}，收鸟 ${Math.max(0, Number(closeForm.birdCount) || 0)} 只`);
    closeTarget.value = null;
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    closing.value = false;
  }
}

async function removeLog(log: NetLog) {
  const confirmed = await ElMessageBox.confirm(
    `确认删除「${log.netNo} · ${log.openedAt} 开网」这条台账记录？`,
    '删除台账记录',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await netLogStore.removeLog(log.id);
  ElMessage.success('已删除台账记录');
}

async function confirmSiteCleared() {
  if (!session.value) return;
  const confirmed = await ElMessageBox.confirm(
    '确认所有雾网已收回、现场无遗留网具与杂物？确认后台账锁定，批次方可关闭。',
    '现场确认',
    { type: 'warning', confirmButtonText: '确认无遗留', cancelButtonText: '再检查一下' },
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  try {
    await sessionStore.confirmSiteCleared(session.value.id);
    ElMessage.success('已确认现场无遗留，批次可以关闭');
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

async function revokeSiteCleared() {
  if (!session.value) return;
  const confirmed = await ElMessageBox.confirm('撤销「现场无遗留」确认后可继续登记开网 / 收网，确认撤销？', '撤销现场确认', {
    type: 'warning',
  })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await sessionStore.revokeSiteCleared(session.value.id);
  ElMessage.success('已撤销现场确认');
}

function conditionTagType(condition?: NetCondition): 'success' | 'warning' | 'danger' {
  if (condition === '完好') return 'success';
  if (condition === '轻微破损') return 'warning';
  return 'danger';
}
</script>

<template>
  <el-dialog :model-value="true" :title="`网次安全台账 · ${session?.sessionNo ?? ''}`" width="940px" @close="emit('close')">
    <template v-if="session">
      <el-descriptions :column="4" border size="small" class="ledger-meta">
        <el-descriptions-item label="鸟点">{{ siteStore.siteName(session.siteId) }}</el-descriptions-item>
        <el-descriptions-item label="调查日期">{{ session.date }}</el-descriptions-item>
        <el-descriptions-item label="计划 / 已开网次">{{ usedRounds }} / {{ session.netRounds }} 次</el-descriptions-item>
        <el-descriptions-item label="待收网">
          <el-tag v-if="openLogs.length > 0" type="danger" size="small">{{ openLogs.length }} 张待收</el-tag>
          <el-tag v-else type="success" size="small">全部收回</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="现场清点">
          <el-tag v-if="session.siteCleared" type="success" size="small">已确认无遗留</el-tag>
          <el-tag v-else type="warning" size="small">未确认</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="批次状态">
          <el-tag :type="session.closed ? 'success' : 'warning'" size="small">
            {{ session.closed ? '已关闭' : '进行中' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="主调查人">{{ session.leader }}</el-descriptions-item>
        <el-descriptions-item label="最高风力">
          <el-tag :type="windAlert ? 'danger' : 'info'" size="small" effect="plain">{{ maxWind }} 级</el-tag>
        </el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-if="showAlert"
        type="error"
        :closable="false"
        class="ledger-alert"
        :title="`${alertReasons}，请立即组织收网！`"
        :description="`待收网号：${openNetNos.join('、')}（共 ${openLogs.length} 张）。大风或暴雨来临前先收网、再处理已捕获鸟类，避免网具遗留与鸟类伤亡。`"
        show-icon
      />
      <el-alert
        v-else-if="session.closed"
        type="success"
        :closable="false"
        class="ledger-alert"
        title="批次已关闭，台账仅供查看"
        show-icon
      />
      <el-alert
        v-else-if="session.siteCleared"
        type="success"
        :closable="false"
        class="ledger-alert"
        :title="`已确认现场无遗留（${session.clearedAt ? formatDateTime(session.clearedAt) : ''}），台账锁定，可关闭批次`"
        show-icon
      />

      <div v-if="!locked" class="open-bar">
        <span class="open-bar-title">开网登记</span>
        <el-select v-model="openForm.netNo" filterable allow-create placeholder="网号" style="width: 130px">
          <el-option
            v-for="option in netNoOptions"
            :key="option"
            :label="option"
            :value="option"
            :disabled="openNetNos.includes(option)"
          />
        </el-select>
        <el-time-picker v-model="openForm.openedAt" value-format="HH:mm" placeholder="开网时间" style="width: 120px" />
        <span class="open-bar-label">风力</span>
        <el-input-number v-model="openForm.windForce" :min="0" :max="12" style="width: 100px" />
        <span class="open-bar-label">级</span>
        <el-input v-model="openForm.keeper" placeholder="看护人" maxlength="16" style="width: 120px" />
        <el-button type="primary" :loading="opening" @click="submitOpen">登记开网</el-button>
        <span v-if="openNetNos.length > 0" class="open-bar-hint">开网中：{{ openNetNos.join('、') }}</span>
      </div>

      <el-table :data="logs" size="small" border empty-text="尚未登记开网">
        <el-table-column type="index" label="#" width="50" />
        <el-table-column label="网号" width="100">
          <template #default="scope">{{ scope.row.netNo }}</template>
        </el-table-column>
        <el-table-column label="开网时间" width="90">
          <template #default="scope">{{ scope.row.openedAt }}</template>
        </el-table-column>
        <el-table-column label="风力" width="80" align="center">
          <template #default="scope">
            <el-tag :type="scope.row.windForce >= WIND_ALERT_FORCE ? 'danger' : 'info'" size="small" effect="plain">
              {{ scope.row.windForce }} 级
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="看护人" width="100">
          <template #default="scope">{{ scope.row.keeper }}</template>
        </el-table-column>
        <el-table-column label="收网时间" width="90">
          <template #default="scope">{{ scope.row.closedAt ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="收鸟数" width="80" align="right">
          <template #default="scope">{{ scope.row.closedAt ? scope.row.birdCount ?? 0 : '—' }}</template>
        </el-table-column>
        <el-table-column label="网具状态" width="100">
          <template #default="scope">
            <el-tag v-if="scope.row.netCondition" :type="conditionTagType(scope.row.netCondition)" size="small">
              {{ scope.row.netCondition }}
            </el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="scope">
            <el-tag :type="scope.row.closedAt ? 'success' : 'danger'" size="small">
              {{ scope.row.closedAt ? '已收网' : '开网中' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="!locked" label="操作" width="120" fixed="right">
          <template #default="scope">
            <el-button v-if="!scope.row.closedAt" link type="primary" @click="openCloseDialog(scope.row)">收网</el-button>
            <el-button link type="danger" @click="removeLog(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-dialog
        v-if="closeTarget"
        :model-value="true"
        :title="`收网登记 · ${closeTarget.netNo}`"
        width="420px"
        append-to-body
        @close="closeTarget = null"
      >
        <el-form label-width="90px">
          <el-form-item label="开网时间">
            <span>{{ closeTarget.openedAt }}（看护人 {{ closeTarget.keeper }}）</span>
          </el-form-item>
          <el-form-item label="收网时间">
            <el-time-picker v-model="closeForm.closedAt" value-format="HH:mm" placeholder="收网时间" style="width: 140px" />
          </el-form-item>
          <el-form-item label="收鸟数">
            <el-input-number v-model="closeForm.birdCount" :min="0" :max="999" />
          </el-form-item>
          <el-form-item label="网具状态">
            <el-select v-model="closeForm.netCondition" style="width: 160px">
              <el-option v-for="condition in NET_CONDITIONS" :key="condition" :label="condition" :value="condition" />
            </el-select>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="closeTarget = null">取消</el-button>
          <el-button type="primary" :loading="closing" @click="submitClose">确认收网</el-button>
        </template>
      </el-dialog>
    </template>

    <template #footer>
      <div class="ledger-footer">
        <div class="ledger-footer-left">
          <template v-if="session && !session.closed">
            <el-button v-if="!session.siteCleared" type="success" :disabled="openLogs.length > 0" @click="confirmSiteCleared">
              确认现场无遗留
            </el-button>
            <el-button v-else link type="warning" @click="revokeSiteCleared">撤销现场确认</el-button>
            <span v-if="!session.siteCleared && openLogs.length > 0" class="footer-hint">
              还有 {{ openLogs.length }} 张网未收，收齐后才能确认现场无遗留
            </span>
          </template>
        </div>
        <el-button type="primary" @click="emit('close')">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.ledger-meta {
  margin-bottom: 12px;
}
.ledger-alert {
  margin-bottom: 12px;
}
.open-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #f4f9f6;
  border: 1px dashed #bcd8cd;
  border-radius: 8px;
}
.open-bar-title {
  font-size: 13px;
  font-weight: 600;
  color: #1f4a44;
}
.open-bar-label {
  font-size: 12px;
  color: #6f8480;
}
.open-bar-hint {
  font-size: 12px;
  color: #b2543a;
}
.ledger-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ledger-footer-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.footer-hint {
  font-size: 12px;
  color: #8a99a5;
}
</style>
