import type { Note, NoteMeta } from '../types'

/**
 * 笔记序列化 / 反序列化
 * 存储格式：单篇笔记 = 一个 .md 文件，YAML front-matter 存放元数据
 *
 * ---------------------------------------------------------------
 * ---
 * id: xxxx
 * title: 标题
 * tags: [工作, 复盘]
 * created: 2026-09-08T12:00:00.000Z
 * updated: 2026-09-08T12:00:00.000Z
 * pinned: false
 * favorite: false
 * type: note
 * folder: 文件夹id
 * ---
 * 正文内容…
 * ---------------------------------------------------------------
 *
 * 说明：主进程 electron/main.cjs 中有一份等价的 CJS 实现，
 * 两边格式必须保持一致，修改时请同步。
 */

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 极简 YAML front-matter 解析（仅支持扁平字段与 [a, b] 数组） */
export function parseFrontMatter(raw: string): { data: Record<string, any>; content: string } {
  const result: { data: Record<string, any>; content: string } = { data: {}, content: raw }
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!m) return result
  result.content = raw.slice(m[0].length)
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let val = line.slice(idx + 1).trim()
    if (!key) continue
    if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim()
      result.data[key] = inner
        ? inner
            .split(',')
            .map((s) => s.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean)
        : []
    } else if (val === 'true' || val === 'false') {
      result.data[key] = val === 'true'
    } else {
      result.data[key] = val.replace(/^["']|["']$/g, '')
    }
  }
  return result
}

export function stringifyFrontMatter(note: Note): string {
  return [
    '---',
    `id: ${note.id}`,
    `title: ${String(note.title || '').replace(/\n/g, ' ')}`,
    `tags: [${(note.tags || []).join(', ')}]`,
    `created: ${note.created}`,
    `updated: ${note.updated}`,
    `pinned: ${!!note.pinned}`,
    `favorite: ${!!note.favorite}`,
    `type: ${note.type || 'note'}`,
    `folder: ${note.folder || ''}`,
    '---',
    '',
  ].join('\n')
}

export function serializeNote(note: Note): string {
  return stringifyFrontMatter(note) + (note.content || '')
}

export function deserializeNote(id: string, raw: string): Note {
  const { data, content } = parseFrontMatter(raw)
  const now = new Date().toISOString()
  return {
    id: data.id || id,
    title: data.title || id,
    tags: Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : [],
    created: data.created || now,
    updated: data.updated || now,
    pinned: data.pinned === true || data.pinned === 'true',
    favorite: data.favorite === true || data.favorite === 'true',
    type: data.type === 'daily' ? 'daily' : 'note',
    folder: data.folder || '',
    content,
  }
}

/** 生成列表摘要：剥离 Markdown 标记后取前 120 字 */
export function makeExcerpt(content: string, len = 120): string {
  const text = String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/[#>*_`~\-|>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, len)
}

/** 中英文混排字数：CJK 按字、英文按词 */
export function countWords(content: string): number {
  const text = String(content || '').replace(/\s+/g, ' ')
  const cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf]/g) || []).length
  const en = (text.match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g) || []).length
  return cjk + en
}

export function toMeta(note: Note): NoteMeta {
  return {
    id: note.id,
    title: note.title,
    tags: note.tags,
    created: note.created,
    updated: note.updated,
    pinned: note.pinned,
    favorite: note.favorite,
    type: note.type,
    folder: note.folder || '',
    excerpt: makeExcerpt(note.content),
    words: countWords(note.content),
  }
}

/** 从正文首行提取标题（无标题时用首行文本，最多 40 字） */
export function deriveTitle(content: string): string {
  const line = String(content || '')
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0)
  return line ? line.slice(0, 40) : '未命名笔记'
}

/** 从正文中解析 #标签（与 front-matter 中的 tags 合并去重） */
export function extractInlineTags(content: string): string[] {
  const out = new Set<string>()
  const re = /(?:^|[\s(（，,。;；])#([^\s#\[\]()（）,，。;；]{1,24})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content || ''))) {
    out.add(m[1])
  }
  return [...out]
}

/** 解析正文中的双向链接 [[标题]]，返回被引用的标题列表 */
export function extractLinks(content: string): string[] {
  const out = new Set<string>()
  const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content || ''))) {
    out.add(m[1].trim())
  }
  return [...out]
}

/** 统计待办任务：未完成 / 已完成 */
export function extractTasks(content: string): { text: string; done: boolean; line: number }[] {
  const tasks: { text: string; done: boolean; line: number }[] = []
  String(content || '')
    .split('\n')
    .forEach((line, i) => {
      const m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line)
      if (m) tasks.push({ done: m[1].toLowerCase() === 'x', text: m[2].trim(), line: i })
    })
  return tasks
}
