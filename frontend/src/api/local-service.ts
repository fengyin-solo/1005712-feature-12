import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  FaultBoard,
  FaultCard,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const FAULT_KEY = 'faultrecord'
const PATROL_KEY = 'patrol'
const ARCHIVED_STATUS = '已归档'
// 故障类型栏位顺序：不在这个清单里的类型依次补到末尾。
const FAULT_TYPE_ORDER = ['单相接地', '两相短路', '两相接地短路', '三相短路']
const STATUS_RANK: Record<string, number> = { 待分析: 0, 分析中: 1, 已定性: 2, 已归档: 3 }

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

// 故障录波既有口径：原始登记可能是 8.6kA / 7900A / 9.4 千安，统一折算成保留一位小数的 kA。
// 录波明细与导出清单都走这一个口径，保证两处看到的故障电流一致。
export function formatFaultCurrent(raw: unknown): string {
  const value = String(raw ?? '').trim()
  if (!value) {
    return '—'
  }
  const match = value.match(/(-?\d+(?:\.\d+)?)/)
  if (!match) {
    return value
  }
  let amperes = Number(match[1])
  if (/千安|kA|KA/i.test(value)) {
    amperes *= 1000
  }
  return `${(amperes / 1000).toFixed(1)}kA`
}

// 故障时间可能只录到日期，解析失败按 0 处理，排序仍能落到稳定结果。
function faultTimeValue(row: EntryRow): number {
  const parsed = Date.parse(text(row, '故障时间').replace(/年|月/g, '-').replace(/日/g, ''))
  return Number.isNaN(parsed) ? 0 : parsed
}

function statusRank(status: string): number {
  return STATUS_RANK[status] ?? 99
}

// 同一回线路内的排列：待分析在前、已归档收底；同一状态内严格按故障时间先后排列。
function compareWithinLine(a: EntryRow, b: EntryRow): number {
  return (
    statusRank(String(a.status)) - statusRank(String(b.status)) ||
    faultTimeValue(a) - faultTimeValue(b) ||
    Number(a.id) - Number(b.id)
  )
}

export function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// 按故障线路分行、故障类型分栏构建视图；同一录波编号重复提交的只保留一条。
export function loadFaultBoard(
  filters: Record<string, string> = {},
  month = '',
): FaultBoard {
  const filtered = filterRows(listRows(FAULT_KEY), filters).filter((row) =>
    month === '' ? true : text(row, '故障时间').startsWith(month),
  )

  const bestByCode = new Map<string, EntryRow>()
  for (const row of filtered) {
    const code = text(row, '录波编号')
    const prev = bestByCode.get(code)
    if (!prev || compareWithinLine(row, prev) < 0) {
      bestByCode.set(code, row)
    }
  }
  const unique = [...bestByCode.values()]

  const typeSet = [...new Set(unique.map((row) => text(row, '故障类型')).filter(Boolean))]
  const types = [
    ...FAULT_TYPE_ORDER.filter((type) => typeSet.includes(type)),
    ...typeSet.filter((type) => !FAULT_TYPE_ORDER.includes(type)),
  ]

  const byLine = new Map<string, EntryRow[]>()
  for (const row of unique) {
    const line = text(row, '故障线路') || '未登记线路'
    const group = byLine.get(line)
    if (group) {
      group.push(row)
    } else {
      byLine.set(line, [row])
    }
  }

  const lines = [...byLine.entries()]
    .map(([line, rows]) => {
      rows.sort(compareWithinLine)
      return {
        line,
        rows,
        earliest: Math.min(...rows.map(faultTimeValue)),
      }
    })
    .sort((a, b) => a.earliest - b.earliest || a.line.localeCompare(b.line))
    .map(({ line, rows }) => ({
      line,
      total: rows.length,
      monthCount: rows.filter((row) =>
        month === '' ? true : text(row, '故障时间').startsWith(month),
      ).length,
      cells: types.map((type) => ({
        type,
        cards: rows
          .filter((row) => text(row, '故障类型') === type)
          .map<FaultCard>((row) => ({
            id: Number(row.id),
            录波编号: text(row, '录波编号'),
            故障电流: formatFaultCurrent(row['故障电流']),
            故障时间: text(row, '故障时间'),
            status: String(row.status),
            分析人: text(row, '分析人'),
            分析结论: text(row, '分析结论'),
          })),
      })),
    }))

  return { types, lines }
}

// 分析结论按录波编号归集：分析中录波由分析人签字后整体回填，同编号记录一并更新。
export function saveFaultConclusion(
  id: number,
  payload: { conclusion: string; signer: string },
): ActionResult {
  const meta = moduleMeta(FAULT_KEY)
  const rows = listRows(FAULT_KEY)
  const target = rows.find((row) => Number(row.id) === id)
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (String(target.status) !== '分析中') {
    return { ok: false, message: '只有分析中的录波才能回填分析结论' }
  }
  const conclusion = payload.conclusion.trim()
  const signer = payload.signer.trim()
  if (!conclusion) {
    return { ok: false, message: '请先填写分析结论再签字' }
  }
  if (!signer) {
    return { ok: false, message: '请填写分析人签字后再回填' }
  }
  const code = text(target, '录波编号')
  const next = rows.map((row) =>
    text(row, '录波编号') === code
      ? { ...row, 分析结论: conclusion, 分析人: signer }
      : row,
  )
  saveRows(FAULT_KEY, next)
  return { ok: true, message: `录波 ${code} 的分析结论已按签字回填` }
}

// 定性归档后同步到设备巡视的待复查清单：同一录波只挂一条，重复归档不重复生成。
function syncPatrolRecheck(record: EntryRow): void {
  const rows = [...listRows(PATROL_KEY)]
  const code = text(record, '录波编号')
  const existing = rows.find((row) => text(row, '巡视路线').includes(code))
  const conclusion = text(record, '分析结论')
  if (existing) {
    if (String(existing.status) !== '已完成') {
      existing.status = '待复查'
      existing.pending = true
      existing['处理情况'] = `待复查（归档录波 ${code}）${conclusion ? '：' + conclusion : ''}`
      saveRows(PATROL_KEY, rows)
    }
    return
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  rows.push({
    id: nextId,
    status: '待复查',
    pending: true,
    abnormal: false,
    巡视编号: `RECH-${String(nextId).padStart(4, '0')}`,
    巡视变电站: text(record, '故障线路'),
    巡视路线: `${text(record, '故障线路')}（归档录波 ${code}）`,
    巡视人: text(record, '分析人'),
    巡视日期: new Date().toISOString().slice(0, 10),
    发现缺陷数: '0',
    处理情况: `待复查（归档录波 ${code}）${conclusion ? '：' + conclusion : ''}`,
    巡视状态: '待复查',
  })
  saveRows(PATROL_KEY, rows)
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 故障录波按 待分析→分析中→已定性→已归档 正向推进，倒序、跨档改动一律挡回。
  if (meta.orderedFlow) {
    const currentRank = meta.statuses.indexOf(current)
    const targetRank = meta.statuses.indexOf(target)
    if (currentRank < 0) {
      return { ok: false, message: `当前状态「${current}」不在流转链上，无法${action}` }
    }
    if (targetRank <= currentRank) {
      return { ok: false, message: `「${current}」不能倒序改回「${target}」` }
    }
    if (targetRank !== currentRank + 1) {
      return {
        ok: false,
        message: `请先完成「${meta.statuses[currentRank + 1]}」，不能跨档直接${action}`,
      }
    }
  }
  if (key === FAULT_KEY && action === '确认定性') {
    if (!text(rows[index], '分析结论') || !text(rows[index], '分析人')) {
      return { ok: false, message: '分析结论与分析人签字齐全后才能确认定性' }
    }
  }
  if (key === FAULT_KEY && action === '归档录波') {
    const code = text(rows[index], '录波编号')
    // 同一份录波重复提交归档只留一条：已经有同编号归档记录的，挡回本次提交。
    const duplicated = rows.some(
      (row) =>
        Number(row.id) !== id &&
        text(row, '录波编号') === code &&
        String(row.status) === ARCHIVED_STATUS,
    )
    if (duplicated) {
      return { ok: false, message: `录波 ${code} 已归档，重复提交不受理` }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  if (key === FAULT_KEY && target === ARCHIVED_STATUS) {
    syncPatrolRecheck(updated)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// 故障录波导出沿用既有录波口径：故障电流与明细、分栏视图同源。
function exportField(key: string, field: string, row: EntryRow): string | number {
  if (key === FAULT_KEY && field === '故障电流') {
    return formatFaultCurrent(row[field])
  }
  const value = row[field]
  return typeof value === 'boolean' ? String(value) : value ?? ''
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => exportField(key, field, row)), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// 设备巡视拆成两块：归档同步来的待复查清单，以及巡视业务自身的常规记录。
export function listPatrol(filters: Record<string, string> = {}): {
  rechecks: EntryRow[]
  routine: EntryRow[]
  total: number
} {
  const rows = listRows(PATROL_KEY)
  const rechecks = rows.filter((row) => String(row.status) === '待复查')
  const routine = filterRows(
    rows.filter((row) => String(row.status) !== '待复查'),
    filters,
  )
  return { rechecks, routine, total: rows.length }
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
