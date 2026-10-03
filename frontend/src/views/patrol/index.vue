<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>设备巡视管理</h2>
        <p class="page-desc">维护巡视记录，围绕巡视编号、巡视变电站、巡视路线、巡视人做登记、筛选与状态流转；故障录波定性归档后自动进入待复查清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡视记录</button>
        <button class="btn" type="button" @click="exportRows">导出设备巡视清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待巡视站点</span>
        <strong class="stat-value">{{ countOf('待巡视') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待复查清单</span>
        <strong class="stat-value">{{ reviewRows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已上报</span>
        <strong class="stat-value">{{ countOf('已上报') }}</strong>
      </article>
    </div>

    <section class="review-panel">
      <header class="review-head">
        <h3>待复查清单（录波定性归档同步）</h3>
        <span class="page-desc">按录波编号归集，同一录波只占一条；复查完成后确认复查并上报。</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>录波/巡视编号</th>
            <th>巡视线路</th>
            <th>巡视路线</th>
            <th>复查人</th>
            <th>故障时间</th>
            <th>定性结论</th>
            <th>状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in reviewRows" :key="String(row.id)">
            <td>{{ row['巡视编号'] }}</td>
            <td>{{ row['巡视变电站'] }}</td>
            <td>{{ row['巡视路线'] }}</td>
            <td>{{ row['巡视人'] || '待指派' }}</td>
            <td>{{ row['巡视日期'] }}</td>
            <td class="review-note">{{ row['处理情况'] }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="runAction('确认复查', row)">确认复查</button>
            </td>
          </tr>
          <tr v-if="!reviewRows.length">
            <td colspan="8" class="empty-state">暂无待复查项，录波分析签字定性后会自动进入本清单</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p class="status-legend" style="margin-top: 14px">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无设备巡视数据，可先登记巡视记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条设备巡视记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ["巡视编号", "巡视变电站", "巡视路线", "巡视人", "巡视日期", "发现缺陷数", "处理情况", "巡视状态"]
// 「确认复查」只服务待复查清单，普通巡视表不重复挂这个动作。
const actions = ["提交巡视", "确认完成", "上报问题"]
const statuses = meta.statuses

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["巡视编号", "巡视变电站", "巡视路线"]
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const reviewRows = computed(() =>
  rows.value
    .filter((row) => String(row.status) === '待复查')
    .sort((a, b) => String(b['巡视日期']).localeCompare(String(a['巡视日期']))),
)

function countOf(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡视记录登记入口尚未接入审批流'
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

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '设备巡视列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.review-panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.review-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.review-head h3 { margin: 0; font-size: 14px; }
.review-note { max-width: 320px; font-size: 12px; color: #334155; }
</style>
