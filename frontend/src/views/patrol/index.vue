<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>设备巡视管理</h2>
        <p class="page-desc">维护巡视记录，围绕巡视编号、巡视变电站、巡视路线、巡视人做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡视记录</button>
        <button class="btn" type="button" @click="exportRows">导出设备巡视清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 定性归档同步来的待复查清单 -->
    <section class="recheck-block">
      <h3 class="block-title">待复查清单（故障录波归档同步）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>巡视编号</th>
            <th>巡视线路</th>
            <th>巡视人</th>
            <th>同步日期</th>
            <th>处理情况</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rechecks" :key="String(row.id)">
            <td>{{ row['巡视编号'] || '—' }}</td>
            <td>{{ row['巡视路线'] || '—' }}</td>
            <td>{{ row['巡视人'] || '—' }}</td>
            <td>{{ row['巡视日期'] || '—' }}</td>
            <td>{{ row['处理情况'] || '—' }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="runAction('复查销号', row)">复查销号</button>
            </td>
          </tr>
          <tr v-if="!rechecks.length">
            <td colspan="6" class="empty-state">暂无归档录波同步来的待复查项</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p class="status-legend">
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
      <span>共 {{ total }} 条设备巡视记录（含待复查 {{ rechecks.length }} 条）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listPatrol,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ['巡视编号', '巡视变电站', '巡视路线', '巡视人', '巡视日期', '发现缺陷数', '处理情况', '巡视状态']
const actions = ['提交巡视', '确认完成', '上报问题']
const statuses = ['待巡视', '巡视中', '已完成', '已上报']

const rows = ref<EntryRow[]>([])
const rechecks = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '待复查清单', value: rechecks.value.length },
  { label: '待巡视站点', value: rows.value.filter((row) => String(row.status) === '待巡视').length },
  { label: '已完成巡视', value: rows.value.filter((row) => String(row.status) === '已完成').length },
])

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
    const payload = listPatrol(filters.value)
    rechecks.value = payload.rechecks
    rows.value = payload.routine
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '设备巡视列表读取失败'
  }
}

onMounted(reload)
</script>
