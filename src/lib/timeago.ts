/**
 * 「x 秒前 / x 分钟前」相对时间格式
 * 中文短串，自动选最大单位；< 10s 显示"刚刚"；> 24h 显示"x 天前"
 */
export function formatTimeAgo(iso: string | number | Date): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, Date.now() - t)
  const s = Math.floor(diff / 1000)
  if (s < 5) return '刚刚'
  if (s < 60) return `${s} 秒前`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  return `${d} 天前`
}