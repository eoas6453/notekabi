/**
 * 日历工具：月历网格生成与事件分组（全部按本地时区，避免 UTC 偏移）
 */
import type { CalendarEvent } from '../types'
import { toDateKey } from './date'

/** 周一起头的星期表 */
export const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日']

export interface DayCell {
  date: string // YYYY-MM-DD
  day: number
  inMonth: boolean
  isToday: boolean
  isWeekend: boolean
}

/** 生成 6 行 × 7 列的月历网格（共 42 格，周一开头） */
export function buildMonthGrid(year: number, month: number): DayCell[] {
  const first = new Date(year, month, 1)
  // getDay(): 0=周日..6=周六，转成 0=周一..6=周日
  const startDow = (first.getDay() + 6) % 7
  const gridStart = new Date(year, month, 1 - startDow)
  const todayKey = toDateKey()
  const cells: DayCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    const key = toDateKey(d)
    const dow = (d.getDay() + 6) % 7
    cells.push({
      date: key,
      day: d.getDate(),
      inMonth: d.getMonth() === month,
      isToday: key === todayKey,
      isWeekend: dow >= 5,
    })
  }
  return cells
}

export function monthLabel(year: number, month: number): string {
  return `${year}年${month + 1}月`
}

/** {year, month} 平移 N 个月，month 0-11 */
export function addMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export function weekdayLabel(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(2023, m - 1, d)
  return '星期' + '日一二三四五六'[dt.getDay()]
}

export function formatDayCN(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number)
  return `${m}月${d}日 ${weekdayLabel(dateKey)}`
}

/** 按日期分组，组内排序：未完成在前、里程碑在前 */
export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    const arr = map.get(e.date) || []
    arr.push(e)
    map.set(e.date, arr)
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      if (a.kind !== b.kind) return a.kind === 'milestone' ? -1 : 1
      return a.date < b.date ? -1 : 1
    })
  }
  return map
}

/** 到期/逾期且未完成的提醒（date <= 今天） */
export function pendingReminders(events: CalendarEvent[], todayKey: string): CalendarEvent[] {
  return events
    .filter((e) => e.kind === 'reminder' && !e.done && e.date <= todayKey)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
