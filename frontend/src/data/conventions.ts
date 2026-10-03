/**
 * 故障录波的既有口径：录波明细看板与导出清单共用，避免两处各写一套。
 * 故障电流沿用录波录入值直读（如 "12.40 kA"），不做单位换算、不补后缀；
 * 空值统一落空串，两处展示保持逐字一致。
 */
export function formatFaultCurrent(value: string | number | boolean | undefined | null): string {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim()
}
