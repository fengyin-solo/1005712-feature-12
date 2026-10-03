import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { formatFaultCurrent } from '@/data/conventions'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const FAULT_RECORD_KEY = 'faultrecord'
const PATROL_KEY = 'patrol'
const FAULT_LAST_STATUS = '已归档'
// 定性归档结论同步到设备巡视时的复查状态
const PATROL_REVIEW_STATUS = '待复查'

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

function faultTimeOf(row: EntryRow): string {
  return String(row['故障时间'] ?? '')
}

// 同一回线路的录波必须按故障时间先后严格串行推进：
// 录波要推进到某一目标状态时，故障时间更早的同线路录波必须已到达该状态，
// 否则即为倒序/越级改动，挡回并指出阻塞录波。
// 原地修订（如已定性录波补签结论）不推进状态，不在拦截之列。
function assertFaultOrder(
  rows: EntryRow[],
  index: number,
  currentStatus: string,
  targetStatus: string,
): ActionResult | null {
  if (currentStatus === targetStatus) {
    return null
  }
  const meta = moduleMeta(FAULT_RECORD_KEY)
  const current = rows[index]
  const line = String(current['故障线路'] ?? '')
  // 推进到 target 时，故障时间更早的同线路录波必须已到达 target：
  // 提交分析 → 不能有更早录波还停在「待分析」；
  // 定性     → 更早录波必须已是「已定性」（严格串行）；
  // 归档     → 更早录波必须已归档。
  const requiredRank = meta.statuses.indexOf(targetStatus)
  const blocker = rows
    .filter((row) => row !== current && String(row['故障线路'] ?? '') === line)
    .filter((row) => {
      const timeDiff = faultTimeOf(row).localeCompare(faultTimeOf(current))
      const earlier = timeDiff < 0 || (timeDiff === 0 && String(row['录波编号']) < String(current['录波编号']))
      return earlier && meta.statuses.indexOf(String(row.status)) < requiredRank
    })
    .sort((a, b) => faultTimeOf(a).localeCompare(faultTimeOf(b)))[0]
  if (blocker) {
    return {
      ok: false,
      message: `倒序改动已挡回：同线路录波 ${String(blocker['录波编号'])}（${faultTimeOf(blocker)}）仍停留在「${String(blocker.status)}」，请先处理故障时间更早的录波`,
    }
  }
  return null
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
  if (key === FAULT_RECORD_KEY) {
    const blocked = assertFaultOrder(rows, index, current, target)
    if (blocked) {
      return blocked
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
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 分析人签字后按录波编号回填分析结论，同时完成定性，并把结论同步到巡视待复查清单。
export function qualifyFaultRecord(
  id: number,
  analyst: string,
  conclusion: string,
): ActionResult {
  const rows = listRows(FAULT_RECORD_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的录波记录` }
  }
  const analystName = analyst.trim()
  const text = conclusion.trim()
  if (!analystName) {
    return { ok: false, message: '请填写分析人签字后再提交定性' }
  }
  if (!text) {
    return { ok: false, message: '请填写分析结论后再提交定性' }
  }
  const target = '已定性'
  const current = String(rows[index].status)
  if (current === FAULT_LAST_STATUS) {
    return { ok: false, message: '录波已归档，结论不再改动' }
  }
  const blocked = assertFaultOrder(rows, index, current, target)
  if (blocked) {
    return blocked
  }
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: true,
    abnormal: false,
    分析人: analystName,
    分析结论: text,
    录波状态: target,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(FAULT_RECORD_KEY, next)
  syncPatrolReview(updated)
  return { ok: true, message: `录波 ${String(updated['录波编号'])} 已由 ${analystName} 签字定性，结论已同步至设备巡视待复查清单` }
}

// 归档录波；同一份录波重复提交归档只保留一条，复查清单同样只维护同一条。
export function archiveFaultRecord(id: number): ActionResult {
  const rows = listRows(FAULT_RECORD_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的录波记录` }
  }
  const current = String(rows[index].status)
  if (current === FAULT_LAST_STATUS) {
    return { ok: false, message: '该录波已归档，重复提交只保留原归档记录一条' }
  }
  // 倒序优先于状态门槛提示：越级操作先报「挡回」，避免掩盖真正原因。
  const blocked = assertFaultOrder(rows, index, current, FAULT_LAST_STATUS)
  if (blocked) {
    return blocked
  }
  if (current !== '已定性') {
    return { ok: false, message: '请先由分析人签字定性后再归档' }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: FAULT_LAST_STATUS,
    pending: false,
    abnormal: false,
    录波状态: FAULT_LAST_STATUS,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(FAULT_RECORD_KEY, next)
  syncPatrolReview(updated)
  return { ok: true, message: `录波 ${String(updated['录波编号'])} 已归档，定性结论已同步至设备巡视待复查清单` }
}

// 定性/归档结论 upsert 进设备巡视的待复查清单，以录波编号为业务键去重。
function syncPatrolReview(fault: EntryRow): void {
  const patrolRows = listRows(PATROL_KEY)
  const code = String(fault['录波编号'] ?? '')
  const index = patrolRows.findIndex((row) => String(row['巡视编号'] ?? '') === code)
  const existing = index >= 0 ? patrolRows[index] : null
  // 复查已闭环（已上报）的记录不被二次同步打回，只刷新结论文本。
  const closed = existing !== null && String(existing.status) !== PATROL_REVIEW_STATUS
  const review: EntryRow = {
    id: existing ? Number(existing.id) : patrolRows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1,
    status: closed ? String(existing!.status) : PATROL_REVIEW_STATUS,
    pending: !closed,
    abnormal: false,
    巡视编号: code,
    巡视变电站: existing && existing['巡视变电站'] ? existing['巡视变电站'] : String(fault['故障线路'] ?? ''),
    巡视路线: `${String(fault['故障线路'] ?? '')}${String(fault['故障类型'] ?? '')}故障特巡`,
    巡视人: existing && existing['巡视人'] ? existing['巡视人'] : (fault['分析人'] ?? ''),
    巡视日期: existing && existing['巡视日期'] ? existing['巡视日期'] : String(fault['故障时间'] ?? '').slice(0, 10),
    发现缺陷数: existing && existing['发现缺陷数'] ? existing['发现缺陷数'] : '待复查',
    处理情况: `录波${code}定性结论：${String(fault['分析结论'] ?? '')}`,
    巡视状态: closed ? String(existing!['巡视状态'] ?? existing!.status) : PATROL_REVIEW_STATUS,
  }
  const next = existing ? [...patrolRows] : [...patrolRows, review]
  if (existing) {
    next[index] = review
  }
  saveRows(PATROL_KEY, next)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([
      row.id,
      ...meta.fields.map((field) => {
        // 故障电流沿用既有录波口径，与录波明细看板逐字一致。
        if (field === '故障电流') {
          return formatFaultCurrent(row[field])
        }
        return row[field] ?? ''
      }),
      row.status,
    ].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export { formatFaultCurrent }

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
