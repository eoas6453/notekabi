import type { Note } from '../types'

/**
 * 轻量全文搜索
 * ---------------------------------------------------------------
 * 个人笔记体量（数百 ~ 数千篇）下，直接线性扫描即可获得亚毫秒级响应，
 * 无需引入 MiniSearch / FlexSearch 等索引库，减少依赖与维护成本。
 *
 * 支持语法：
 *   空格分隔的多关键词（AND）
 *   tag:工作        按标签过滤
 *   #工作           同上
 *   "精确短语"       短语匹配
 */

export interface SearchHit {
  note: Note
  score: number
  /** 命中的关键词，用于高亮 */
  terms: string[]
  /** 命中位置附近的上下文 */
  snippet: string
}

export interface ParsedQuery {
  terms: string[]
  tags: string[]
}

export function parseQuery(raw: string): ParsedQuery {
  const terms: string[] = []
  const tags: string[] = []
  const re = /"([^"]+)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw || ''))) {
    const token = (m[1] || m[2] || '').trim()
    if (!token) continue
    if (/^tag:/i.test(token)) tags.push(token.slice(4).toLowerCase())
    else if (/^#/.test(token)) tags.push(token.slice(1).toLowerCase())
    else terms.push(token.toLowerCase())
  }
  return { terms, tags }
}

/** 取命中词周围的片段 */
function makeSnippet(text: string, terms: string[], len = 90): string {
  const lower = text.toLowerCase()
  let pos = -1
  for (const t of terms) {
    const p = lower.indexOf(t)
    if (p >= 0) {
      pos = p
      break
    }
  }
  if (pos < 0) return text.slice(0, len)
  const start = Math.max(0, pos - Math.floor(len / 3))
  const slice = text.slice(start, start + len)
  return (start > 0 ? '…' : '') + slice + (start + len < text.length ? '…' : '')
}

export function searchNotes(notes: Note[], query: string): SearchHit[] {
  const { terms, tags } = parseQuery(query)
  if (!terms.length && !tags.length) return []

  const hits: SearchHit[] = []
  for (const note of notes) {
    const titleLower = note.title.toLowerCase()
    const body = note.content || ''
    const bodyLower = body.toLowerCase()
    const noteTags = note.tags.map((t) => t.toLowerCase())

    // 标签过滤：必须全部命中
    if (tags.length && !tags.every((t) => noteTags.includes(t))) continue

    if (!terms.length) {
      hits.push({ note, score: 1, terms, snippet: makeSnippet(body.replace(/\s+/g, ' '), []) })
      continue
    }

    let score = 0
    let all = true
    for (const t of terms) {
      let hit = 0
      if (titleLower.includes(t)) hit += 10
      if (noteTags.some((x) => x.includes(t))) hit += 6
      const occurrences = bodyLower.split(t).length - 1
      if (occurrences > 0) hit += Math.min(occurrences, 8)
      if (hit === 0) {
        all = false
        break
      }
      score += hit
    }
    if (!all) continue

    const plain = body
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*_`~|-]/g, ' ')
      .replace(/\s+/g, ' ')
    hits.push({ note, score, terms, snippet: makeSnippet(plain, terms) })
  }

  hits.sort((a, b) => b.score - a.score || +new Date(b.note.updated) - +new Date(a.note.updated))
  return hits
}

/** 高亮文本中的关键词（用于列表标题 / 摘要） */
export function highlightParts(text: string, terms: string[]): { text: string; hit: boolean }[] {
  if (!terms.length) return [{ text, hit: false }]
  const escaped = terms
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!escaped.length) return [{ text, hit: false }]
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts: { text: string; hit: boolean }[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), hit: false })
    parts.push({ text: m[0], hit: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false })
  return parts
}
