<template>
  <section class="page" data-module="faultrecord">
    <header class="page-head">
      <div>
        <h2>故障录波管理</h2>
        <p class="page-desc">按故障线路分行、故障类型分栏查看录波；待分析排在各栏最前，已归档收在栏末，同线路录波按故障时间先后排列。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记录波记录</button>
        <button class="btn" type="button" @click="exportRows">导出故障录波清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待分析录波</span>
        <strong class="stat-value">{{ pendingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">分析中/已定性</span>
        <strong class="stat-value">{{ processingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">本月归档数</span>
        <strong class="stat-value">{{ monthArchivedCount }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item tip">同一回线路须按故障时间先后推进，倒序改动会被挡回</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>故障线路</span>
        <input v-model="filters['故障线路']" placeholder="按故障线路检索" />
      </label>
      <label class="filter-item">
        <span>故障类型</span>
        <input v-model="filters['故障类型']" placeholder="按故障类型检索" />
      </label>
      <label class="filter-item">
        <span>录波编号</span>
        <input v-model="filters['录波编号']" placeholder="按录波编号检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="matrix-scroll">
      <table class="matrix-table">
        <thead>
          <tr>
            <th class="line-col">故障线路（本月故障次数）</th>
            <th v-for="type in faultTypes" :key="type">{{ type }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in lineRows" :key="line.name">
            <th class="line-col">
              <span class="line-name">{{ line.name }}</span>
              <span class="line-count">{{ line.monthCount }} 次 / 共 {{ line.totalCount }} 条</span>
            </th>
            <td v-for="type in faultTypes" :key="type" class="matrix-cell">
              <article
                v-for="row in cellMap.get(cellKey(line.name, type))"
                :key="String(row.id)"
                class="wave-card"
                :class="cardClass(row)"
              >
                <header class="wave-head">
                  <span class="wave-code">{{ row['录波编号'] }}</span>
                  <span class="wave-status">{{ row.status }}</span>
                </header>
                <dl class="wave-meta">
                  <div><dt>故障电流</dt><dd>{{ formatFaultCurrent(row['故障电流']) || '—' }}</dd></div>
                  <div><dt>故障时间</dt><dd>{{ row['故障时间'] || '—' }}</dd></div>
                </dl>
                <p v-if="row['分析结论']" class="wave-conclusion" :title="String(row['分析结论'])">
                  结论（{{ row['分析人'] || '未签字' }}）：{{ row['分析结论'] }}
                </p>
                <footer class="wave-actions">
                  <button
                    v-if="String(row.status) === '待分析' || String(row.status) === '分析中'"
                    class="link"
                    type="button"
                    @click="runAction('提交分析', row)"
                  >提交分析</button>
                  <button
                    v-if="String(row.status) !== '已归档'"
                    class="link"
                    type="button"
                    @click="openQualify(row)"
                  >分析签字定性</button>
                  <button
                    v-if="String(row.status) === '已定性'"
                    class="link"
                    type="button"
                    @click="archiveRow(row)"
                  >归档录波</button>
                </footer>
              </article>
              <p v-if="!(cellMap.get(cellKey(line.name, type))?.length)" class="cell-empty">无录波</p>
            </td>
          </tr>
          <tr v-if="!lineRows.length">
            <td :colspan="faultTypes.length + 1" class="empty-state">没有符合条件的故障录波</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条故障录波，覆盖 {{ lineRows.length }} 回线路、{{ faultTypes.length }} 种故障类型</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="qualifyTarget" class="modal-mask" @click.self="closeQualify">
      <section class="modal-box">
        <header class="modal-head">
          <h3>分析签字回填 · {{ String(qualifyTarget['录波编号']) }}</h3>
          <button class="link" type="button" @click="closeQualify">关闭</button>
        </header>
        <dl class="modal-meta">
          <div><dt>故障线路</dt><dd>{{ qualifyTarget['故障线路'] }}</dd></div>
          <div><dt>故障类型</dt><dd>{{ qualifyTarget['故障类型'] }}</dd></div>
          <div><dt>故障电流</dt><dd>{{ formatFaultCurrent(qualifyTarget['故障电流']) || '—' }}</dd></div>
          <div><dt>故障时间</dt><dd>{{ qualifyTarget['故障时间'] }}</dd></div>
        </dl>
        <form class="modal-form" @submit.prevent="submitQualify">
          <label>
            <span>分析人签字</span>
            <input v-model="qualifyAnalyst" placeholder="签字后结论按录波编号归集回填" />
          </label>
          <label>
            <span>分析结论</span>
            <textarea v-model="qualifyConclusion" rows="4" placeholder="填写定性结论，提交后同步至设备巡视待复查清单"></textarea>
          </label>
          <p v-if="qualifyError" class="error-text">{{ qualifyError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeQualify">取消</button>
            <button class="btn primary" type="submit">签字并确认定性</button>
          </div>
        </form>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  archiveFaultRecord,
  downloadEntries,
  formatFaultCurrent,
  listEntries,
  moduleMeta,
  qualifyFaultRecord,
  runAction as applyAction,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('faultrecord')
const session = useSessionStore()

// 栏内排序口径：状态顺序优先（待分析 → 分析中 → 已定性 → 已归档），
// 同一状态内按故障时间先后排列；待分析自然落在栏首，已归档收在栏末。
const STATUS_RANK = new Map(meta.statuses.map((status, index) => [status, index]))
const ARCHIVED = meta.statuses[meta.statuses.length - 1]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const qualifyTarget = ref<EntryRow | null>(null)
const qualifyAnalyst = ref('')
const qualifyConclusion = ref('')
const qualifyError = ref('')

const statuses = meta.statuses
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const pendingCount = computed(
  () => rows.value.filter((row) => String(row.status) === '待分析').length,
)
const processingCount = computed(
  () => rows.value.filter((row) => ['分析中', '已定性'].includes(String(row.status))).length,
)
const monthArchivedCount = computed(
  () =>
    rows.value.filter(
      (row) => String(row.status) === ARCHIVED && String(row['故障时间'] ?? '').startsWith(currentMonth()),
    ).length,
)

// 故障类型即分栏列，按当前筛选结果动态收窄。
const faultTypes = computed(() => {
  const types = new Set(rows.value.map((row) => String(row['故障类型'] ?? '').trim()).filter(Boolean))
  return [...types].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
})

type LineRow = { name: string; monthCount: number; totalCount: number }

const lineRows = computed<LineRow[]>(() => {
  const map = new Map<string, { monthCount: number; totalCount: number }>()
  for (const row of rows.value) {
    const name = String(row['故障线路'] ?? '').trim()
    if (!name) {
      continue
    }
    const bucket = map.get(name) ?? { monthCount: 0, totalCount: 0 }
    bucket.totalCount += 1
    if (String(row['故障时间'] ?? '').startsWith(currentMonth())) {
      bucket.monthCount += 1
    }
    map.set(name, bucket)
  }
  return [...map.entries()]
    .map(([name, counts]) => ({ name, ...counts }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
})

const cellMap = computed(() => {
  const map = new Map<string, EntryRow[]>()
  for (const row of rows.value) {
    const key = cellKey(String(row['故障线路'] ?? '').trim(), String(row['故障类型'] ?? '').trim())
    const bucket = map.get(key) ?? []
    bucket.push(row)
    map.set(key, bucket)
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => {
      const rankDiff =
        (STATUS_RANK.get(String(a.status)) ?? 0) - (STATUS_RANK.get(String(b.status)) ?? 0)
      if (rankDiff !== 0) {
        return rankDiff
      }
      const timeDiff = String(a['故障时间'] ?? '').localeCompare(String(b['故障时间'] ?? ''))
      if (timeDiff !== 0) {
        return timeDiff
      }
      return String(a['录波编号']).localeCompare(String(b['录波编号']))
    })
  }
  return map
})

function currentMonth(): string {
  // 与录波故障时间口径一致，按本地日历取「YYYY-MM」。
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function cellKey(line: string, type: string): string {
  return `${line}::${type}`
}

function cardClass(row: EntryRow): Record<string, boolean> {
  const status = String(row.status)
  return {
    'is-pending': status === '待分析',
    'is-active': status === '分析中',
    'is-qualified': status === '已定性',
    'is-archived': status === ARCHIVED,
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '录波记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function archiveRow(row: EntryRow) {
  errorMessage.value = ''
  const result = archiveFaultRecord(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openQualify(row: EntryRow) {
  qualifyTarget.value = row
  qualifyAnalyst.value = String(row['分析人'] ?? '') || session.operator
  qualifyConclusion.value = String(row['分析结论'] ?? '')
  qualifyError.value = ''
}

function closeQualify() {
  qualifyTarget.value = null
  qualifyAnalyst.value = ''
  qualifyConclusion.value = ''
  qualifyError.value = ''
}

function submitQualify() {
  if (!qualifyTarget.value) {
    return
  }
  const result = qualifyFaultRecord(Number(qualifyTarget.value.id), qualifyAnalyst.value, qualifyConclusion.value)
  if (!result.ok) {
    qualifyError.value = result.message
    return
  }
  closeQualify()
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '故障录波列表读取失败'
  }
}

onMounted(reload)
</script>
