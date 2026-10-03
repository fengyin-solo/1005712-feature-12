/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 状态必须按 statuses 顺序逐档正向推进的模块（如故障录波），倒序/跨档改动由服务层挡回。
  orderedFlow?: boolean
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 故障录波分栏视图：按故障线路分行、故障类型分栏。
export type FaultCard = {
  id: number
  录波编号: string
  故障电流: string
  故障时间: string
  status: string
  分析人: string
  分析结论: string
}

export type FaultLineGroup = {
  line: string
  cells: { type: string; cards: FaultCard[] }[]
  total: number
  monthCount: number
}

export type FaultBoard = {
  types: string[]
  lines: FaultLineGroup[]
}
