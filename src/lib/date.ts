/** 日期与时间格式化工具（全部本地化中文显示） */

const pad = (n: number) => String(n).padStart(2, '0')

/** 2026-09-08 */
export function toDateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 2026年9月8日 */
export function formatDateCN(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/** 09-08 14:30 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 相对时间：刚刚 / 5分钟前 / 昨天 / 9月8日 */
export function formatRelative(iso: string): string {
  const d = new Date(iso).getTime()
  if (isNaN(d)) return ''
  const diff = Date.now() - d
  const min = 60 * 1000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < 5 * min) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 2 * day) return '昨天'
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  const dt = new Date(iso)
  return `${dt.getMonth() + 1}月${dt.getDate()}日`
}

/** 中文星期 */
export function weekdayCN(d: Date = new Date()): string {
  return '日一二三四五六'[d.getDay()]
}

/** 每日笔记标题：2026-09-08 星期二 */
export function dailyTitle(d: Date = new Date()): string {
  return `${toDateKey(d)} 星期${weekdayCN(d)}`
}

/** 按天分组用的 key */
export function dayGroupLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return '今天'
  if (same(d, yesterday)) return '昨天'
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
