<template>
  <section class="page" data-module="faultrecord">
    <header class="page-head">
      <div>
        <h2>故障录波管理</h2>
        <p class="page-desc">按故障线路分栏：线路分行、故障类型分栏，逐栏列出录波编号、故障电流与故障时间。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记录波记录</button>
        <button class="btn" type="button" @click="exportRows">导出故障录波清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: viewMode === tab.key }"
        type="button"
        @click="switchView(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <template v-if="viewMode === 'board'">
        <label class="filter-item">
          <span>故障线路</span>
          <input v-model="boardFilters['故障线路']" placeholder="按故障线路检索" />
        </label>
        <label class="filter-item">
          <span>故障类型</span>
          <input v-model="boardFilters['故障类型']" placeholder="按故障类型检索" />
        </label>
        <label class="filter-item">
          <span>录波编号</span>
          <input v-model="boardFilters['录波编号']" placeholder="按录波编号检索" />
        </label>
        <label class="filter-item">
          <span>月份</span>
          <input v-model="month" type="month" />
        </label>
      </template>
      <label v-for="field in filterFields" v-else :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="detailFilters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 分栏视图：线路分行、故障类型分栏 -->
    <div v-if="viewMode === 'board'" class="board-wrap">
      <table class="board-table">
        <thead>
          <tr>
            <th class="line-col">故障线路</th>
            <th v-for="type in board.types" :key="type">{{ type }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="group in board.lines" :key="group.line">
            <th class="line-col">
              <div class="line-name">{{ group.line }}</div>
              <div class="line-meta">共 {{ group.total }} 次 · 所选月份 {{ group.monthCount }} 次</div>
            </th>
            <td v-for="cell in group.cells" :key="cell.type" class="board-cell">
              <article
                v-for="card in cell.cards"
                :key="card.id"
                class="fault-card"
                :class="`s-${STATUS_RANK[card.status] ?? 0}`"
              >
                <div class="card-head">
                  <span class="fault-no">{{ card.录波编号 }}</span>
                  <span class="fault-state">{{ card.status }}</span>
                </div>
                <div class="card-line"><span class="k">故障电流</span>{{ card.故障电流 }}</div>
                <div class="card-line"><span class="k">故障时间</span>{{ card.故障时间 }}</div>
                <div v-if="card.分析结论" class="card-line conclusion">
                  <span class="k">分析结论</span>{{ card.分析结论 }}
                  <em v-if="card.分析人" class="signer">（{{ card.分析人 }}）</em>
                </div>
                <div class="card-actions">
                  <button
                    v-if="nextAction(card.status)"
                    class="link"
                    type="button"
                    @click="runAction(nextAction(card.status)!, card.id)"
                  >
                    {{ nextAction(card.status) }}
                  </button>
                  <button
                    v-if="card.status === '分析中'"
                    class="link"
                    type="button"
                    @click="openConclusion(card)"
                  >
                    回填结论
                  </button>
                </div>
              </article>
              <span v-if="!cell.cards.length" class="cell-empty">—</span>
            </td>
          </tr>
          <tr v-if="!board.lines.length">
            <td :colspan="board.types.length + 1" class="empty-state">当前条件下没有录波记录</td>
          </tr>
        </tbody>
      </table>
      <p class="board-hint">同线路录波按状态排序（待分析在前、已归档收底），同状态内按故障时间先后排列。</p>
    </div>

    <!-- 明细视图 -->
    <table v-else class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in detailRows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            {{ column === '故障电流' ? formatFaultCurrent(row[column]) : (row[column] || '—') }}
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="nextAction(String(row.status))"
              class="link"
              type="button"
              @click="runAction(nextAction(String(row.status))!, Number(row.id))"
            >
              {{ nextAction(String(row.status)) }}
            </button>
            <button
              v-if="String(row.status) === '分析中'"
              class="link"
              type="button"
              @click="openConclusionRow(row)"
            >
              回填结论
            </button>
          </td>
        </tr>
        <tr v-if="!detailRows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无故障录波数据，可先登记录波记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条故障录波记录（分栏视图按录波编号去重显示）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 分析结论签字回填 -->
    <div v-if="conclusionOpen" class="modal-mask" @click.self="conclusionOpen = false">
      <div class="modal">
        <h3>分析结论签字回填</h3>
        <p class="modal-sub">结论按录波编号 {{ form.code }} 归集，同编号记录一并回填。</p>
        <label class="form-item">
          <span>分析结论</span>
          <textarea v-model="form.conclusion" rows="4" placeholder="填写故障性质、测距、处置意见"></textarea>
        </label>
        <label class="form-item">
          <span>分析人签字</span>
          <input v-model="form.signer" placeholder="签字后回填" />
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="conclusionOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitConclusion">签字回填</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  currentMonth,
  downloadEntries,
  formatFaultCurrent,
  listEntries,
  loadFaultBoard,
  moduleMeta,
  runAction as applyAction,
  saveFaultConclusion,
} from '@/api/local-service'
import type { FaultBoard, FaultCard } from '@/data/types'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('faultrecord')
const columns = ['录波编号', '故障线路', '故障类型', '故障电流', '故障时间', '分析人', '分析结论', '录波状态']
const tabs: { key: 'board' | 'detail'; label: string }[] = [
  { key: 'board', label: '线路分栏视图' },
  { key: 'detail', label: '录波明细' },
]
const STATUS_RANK: Record<string, number> = { 待分析: 0, 分析中: 1, 已定性: 2, 已归档: 3 }
const NEXT_ACTION: Record<string, string> = {
  待分析: '提交分析',
  分析中: '确认定性',
  已定性: '归档录波',
}

const viewMode = ref<'board' | 'detail'>('board')
const board = ref<FaultBoard>({ types: [], lines: [] })
const detailRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const boardFilters = ref<Record<string, string>>({})
const detailFilters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const month = ref(currentMonth())

const stats = computed(() => {
  const all = listEntries(meta.key).items
  return [
    { label: '待分析录波', value: all.filter((row) => String(row.status) === '待分析').length },
    { label: '分析中录波', value: all.filter((row) => String(row.status) === '分析中').length },
    {
      label: '本月归档数',
      value: all.filter(
        (row) =>
          String(row.status) === '已归档' &&
          String(row['故障时间'] ?? '').startsWith(currentMonth()),
      ).length,
    },
  ]
})

const conclusionOpen = ref(false)
const form = ref({ id: 0, code: '', conclusion: '', signer: '' })

function nextAction(status: string): string | undefined {
  return NEXT_ACTION[status]
}

function switchView(mode: 'board' | 'detail') {
  viewMode.value = mode
  errorMessage.value = ''
  reload()
}

function resetFilters() {
  if (viewMode.value === 'board') {
    boardFilters.value = {}
    month.value = currentMonth()
  } else {
    detailFilters.value = {}
  }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '录波记录登记入口尚未接入审批流'
}

function runAction(action: string, id: number) {
  errorMessage.value = ''
  const result = applyAction(meta.key, id, action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openConclusion(card: FaultCard) {
  form.value = {
    id: card.id,
    code: card.录波编号,
    conclusion: card.分析结论,
    signer: card.分析人,
  }
  conclusionOpen.value = true
}

function openConclusionRow(row: EntryRow) {
  form.value = {
    id: Number(row.id),
    code: String(row['录波编号'] ?? ''),
    conclusion: String(row['分析结论'] ?? ''),
    signer: String(row['分析人'] ?? ''),
  }
  conclusionOpen.value = true
}

function submitConclusion() {
  const result = saveFaultConclusion(form.value.id, {
    conclusion: form.value.conclusion,
    signer: form.value.signer,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  conclusionOpen.value = false
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    if (viewMode.value === 'board') {
      board.value = loadFaultBoard(boardFilters.value, month.value)
    } else {
      const payload = listEntries(meta.key, detailFilters.value)
      detailRows.value = payload.items
      total.value = payload.total
    }
    if (viewMode.value === 'board') {
      total.value = listEntries(meta.key).total
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '故障录波列表读取失败'
  }
}

onMounted(reload)
</script>
