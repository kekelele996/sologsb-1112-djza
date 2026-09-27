<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useNetSessionStore } from '../../stores/netSessionStore';
import { useSiteStore } from '../../stores/siteStore';
import { useRingStore } from '../../stores/ringStore';
import { isNetClosed, NET_CONDITIONS, WIND_ALERT_LEVEL, type NetCondition, type NetSession } from '../../types/net-session';
import type { SurveySession } from '../../types/session';

const props = defineProps<{ session: SurveySession }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const netSessionStore = useNetSessionStore();
const siteStore = useSiteStore();
const ringStore = useRingStore();

const nowHHmm = () => new Date().toTimeString().slice(0, 5);

const nets = computed(() => netSessionStore.bySession(props.session.id));
const openNets = computed(() => nets.value.filter((net) => !isNetClosed(net)));
const closedCount = computed(() => nets.value.length - openNets.value.length);

/** 计划网次已用完：已开网次数达到批次计划网次 */
const roundsExhausted = computed(() => nets.value.length >= props.session.netRounds);
/** 风力升到 5 级：在看护的网开网时风力达 5 级，或批次观测风力已达 5 级且仍有网未收 */
const windAlert = computed(
  () =>
    openNets.value.some((net) => net.windForce >= WIND_ALERT_LEVEL) ||
    (props.session.windForce >= WIND_ALERT_LEVEL && openNets.value.length > 0),
);

const alertReasons = computed(() => {
  const reasons: string[] = [];
  if (roundsExhausted.value) {
    reasons.push(`计划网次已用完（已开 ${nets.value.length} / 计划 ${props.session.netRounds}），请收网撤点，勿再开新网。`);
  }
  if (windAlert.value) {
    reasons.push(`风力已达 ${WIND_ALERT_LEVEL} 级，请立即组织收网，注意人员与网具安全。`);
  }
  return reasons;
});
/** 批次已关闭后不再弹安全提示，台账仅供查看 */
const showAlert = computed(() => !props.session.closed && alertReasons.value.length > 0);

/** 鸟点网位清单；已在看护的网号置灰，避免重复开网 */
const netNoOptions = computed(() => {
  const site = siteStore.sites.find((item) => item.id === props.session.siteId);
  const count = site?.netCount ?? 0;
  return Array.from({ length: count }, (_, index) => {
    const label = `${index + 1} 号网`;
    return { label, disabled: openNets.value.some((net) => net.netNo === label) };
  });
});

const openForm = ref({
  netNo: '',
  openedAt: nowHHmm(),
  windForce: props.session.windForce,
  keeper: props.session.leader,
});

async function submitOpen() {
  const netNo = openForm.value.netNo.trim();
  if (!netNo) {
    ElMessage.warning('请填写网号');
    return;
  }
  if (!openForm.value.openedAt) {
    ElMessage.warning('请选择开网时间');
    return;
  }
  if (!openForm.value.keeper.trim()) {
    ElMessage.warning('请填写看护人');
    return;
  }
  const { conflict } = await netSessionStore.openNet({
    sessionId: props.session.id,
    netNo,
    openedAt: openForm.value.openedAt,
    windForce: openForm.value.windForce,
    keeper: openForm.value.keeper,
  });
  if (conflict) {
    ElMessage.error(`${netNo} 尚未收网（${conflict.openedAt} 开网，看护人 ${conflict.keeper}），不能重复开网`);
    return;
  }
  if (openForm.value.windForce >= WIND_ALERT_LEVEL) {
    ElMessage.warning(`${netNo} 已开网；风力已达 ${WIND_ALERT_LEVEL} 级，请密切关注并尽快收网`);
  } else if (roundsExhausted.value) {
    ElMessage.warning(`${netNo} 已开网；计划网次已用完，请勿再开新网`);
  } else {
    ElMessage.success(`${netNo} 已开网`);
  }
  openForm.value.netNo = '';
}

const closeTarget = ref<NetSession | null>(null);
const closeForm = ref({ closedAt: '', birdCount: 0, netCondition: '完好' as NetCondition, note: '' });

function openCloseDialog(net: NetSession) {
  closeTarget.value = net;
  // 收鸟数默认带出该批次该网号下的环志记录数，收网人可按实际修正
  const ringCount = ringStore.rings.filter(
    (record) => record.sessionId === props.session.id && record.netNo === net.netNo,
  ).length;
  closeForm.value = { closedAt: nowHHmm(), birdCount: ringCount, netCondition: '完好', note: '' };
}

async function submitClose() {
  const net = closeTarget.value;
  if (!net) return;
  if (!closeForm.value.closedAt) {
    ElMessage.warning('请选择收网时间');
    return;
  }
  await netSessionStore.closeNet(net.id, {
    closedAt: closeForm.value.closedAt,
    birdCount: closeForm.value.birdCount,
    netCondition: closeForm.value.netCondition,
    note: closeForm.value.note,
  });
  ElMessage.success(`${net.netNo} 已收网（收鸟 ${closeForm.value.birdCount} 只）`);
  closeTarget.value = null;
}

async function removeNet(net: NetSession) {
  const confirmed = await ElMessageBox.confirm(
    `确认删除 ${net.netNo}（${net.openedAt} 开网）的台账记录？`,
    '删除确认',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await netSessionStore.removeNet(net.id);
  ElMessage.success('已删除台账记录');
}
</script>

<template>
  <el-dialog :model-value="true" :title="`网次安全台账 · ${session.sessionNo}`" width="920px" @close="emit('close')">
    <div class="ledger-summary">
      <el-tag type="info" effect="plain">计划网次 {{ session.netRounds }}</el-tag>
      <el-tag type="info" effect="plain">已开 {{ nets.length }}</el-tag>
      <el-tag type="success" effect="plain">已收 {{ closedCount }}</el-tag>
      <el-tag :type="openNets.length ? 'danger' : 'success'" effect="dark">待收 {{ openNets.length }}</el-tag>
      <el-tag v-if="session.closed" type="info">批次已关闭 · 台账仅供查看</el-tag>
    </div>

    <el-alert v-if="showAlert" type="warning" show-icon :closable="false" class="ledger-alert">
      <template #title>
        <div v-for="reason in alertReasons" :key="reason">{{ reason }}</div>
      </template>
      <div class="pending-line">
        待收网号：
        <template v-if="openNets.length">
          <el-tag v-for="net in openNets" :key="net.id" type="danger" size="small" effect="dark" class="pending-tag">
            {{ net.netNo }}
          </el-tag>
        </template>
        <span v-else>无（全部已收）</span>
      </div>
    </el-alert>

    <el-form v-if="!session.closed" inline class="open-form" @submit.prevent>
      <el-form-item label="网号">
        <el-select v-model="openForm.netNo" filterable allow-create placeholder="选择或输入" style="width: 130px">
          <el-option
            v-for="opt in netNoOptions"
            :key="opt.label"
            :label="opt.label"
            :value="opt.label"
            :disabled="opt.disabled"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="开网时间">
        <el-time-picker v-model="openForm.openedAt" value-format="HH:mm" placeholder="开网时间" style="width: 110px" />
      </el-form-item>
      <el-form-item label="风力(级)">
        <el-input-number v-model="openForm.windForce" :min="0" :max="12" style="width: 90px" />
      </el-form-item>
      <el-form-item label="看护人">
        <el-input v-model="openForm.keeper" style="width: 110px" maxlength="16" placeholder="看护人" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="submitOpen">开网登记</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="nets" size="small" border empty-text="尚未登记网次，请先开网">
      <el-table-column label="网号" width="90">
        <template #default="scope">{{ scope.row.netNo }}</template>
      </el-table-column>
      <el-table-column label="开网时间" width="90">
        <template #default="scope">{{ scope.row.openedAt }}</template>
      </el-table-column>
      <el-table-column label="风力" width="80" align="right">
        <template #default="scope">
          <span :class="{ 'wind-danger': scope.row.windForce >= WIND_ALERT_LEVEL }">{{ scope.row.windForce }} 级</span>
        </template>
      </el-table-column>
      <el-table-column label="看护人" width="90">
        <template #default="scope">{{ scope.row.keeper }}</template>
      </el-table-column>
      <el-table-column label="收网时间" width="90">
        <template #default="scope">{{ scope.row.closedAt ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="收鸟数" width="80" align="right">
        <template #default="scope">{{ isNetClosed(scope.row) ? scope.row.birdCount ?? 0 : '—' }}</template>
      </el-table-column>
      <el-table-column label="网具状态" width="100">
        <template #default="scope">
          <span v-if="scope.row.netCondition" :class="{ 'condition-danger': scope.row.netCondition !== '完好' }">
            {{ scope.row.netCondition }}
          </span>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="scope">
          <el-tag :type="isNetClosed(scope.row) ? 'success' : 'warning'" size="small">
            {{ isNetClosed(scope.row) ? '已收网' : '看护中' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="备注" min-width="120">
        <template #default="scope">{{ scope.row.note ?? '' }}</template>
      </el-table-column>
      <el-table-column v-if="!session.closed" label="操作" width="120" fixed="right">
        <template #default="scope">
          <el-button v-if="!isNetClosed(scope.row)" link type="primary" @click="openCloseDialog(scope.row)">收网</el-button>
          <el-button link type="danger" @click="removeNet(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-if="closeTarget" :model-value="true" :title="`收网登记 · ${closeTarget.netNo}`" width="420px" append-to-body @close="closeTarget = null">
      <el-form label-width="90px">
        <el-form-item label="收网时间">
          <el-time-picker v-model="closeForm.closedAt" value-format="HH:mm" placeholder="收网时间" style="width: 130px" />
        </el-form-item>
        <el-form-item label="收鸟数">
          <el-input-number v-model="closeForm.birdCount" :min="0" :max="999" />
        </el-form-item>
        <el-form-item label="网具状态">
          <el-select v-model="closeForm.netCondition" style="width: 140px">
            <el-option v-for="condition in NET_CONDITIONS" :key="condition" :label="condition" :value="condition" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="closeForm.note" type="textarea" :rows="2" maxlength="60" placeholder="网具破损情况、遗留物等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeTarget = null">取消</el-button>
        <el-button type="primary" @click="submitClose">确认收网</el-button>
      </template>
    </el-dialog>

    <template #footer>
      <el-button type="primary" @click="emit('close')">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ledger-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.ledger-alert {
  margin-bottom: 12px;
}
.pending-line {
  margin-top: 4px;
}
.pending-tag {
  margin-right: 6px;
}
.open-form {
  margin-bottom: 4px;
}
.wind-danger {
  color: #c62828;
  font-weight: 600;
}
.condition-danger {
  color: #c77700;
  font-weight: 600;
}
</style>
