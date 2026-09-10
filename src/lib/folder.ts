import type { Folder, Note } from '../types'

/**
 * 文件夹逻辑（v2：与标签彻底分离）
 * ---------------------------------------------------------------
 * - 文件夹是用户自建的独立树：folders.json 里按 order 有序存储
 * - 一篇笔记只属于一个文件夹（note.folder = 文件夹 id）
 * - 空值 = 未归类
 */

/** 侧栏「全部」的选中值（null 表示不按文件夹过滤） */
export const ALL_FOLDER = null
/** 侧栏「未归类」的选中值 */
export const NO_FOLDER = '__none__'

export interface FolderNode extends Folder {
  children: FolderNode[]
  /** 直接属于本文件夹的笔记数 */
  count: number
  /** 含所有子文件夹的笔记数 */
  total: number
  depth: number
  /** 展示用路径，如 "工作 / 项目A" */
  path: string
}

export function newFolderId(): string {
  return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** 文件夹名合法性：不能为空、不能含路径分隔符与 Windows 非法字符 */
export function isValidFolderName(name: string): boolean {
  const s = (name || '').trim()
  if (!s || s.length > 60) return false
  return !/[\\/:*?"<>|]/.test(s)
}

/** 统计每个文件夹的笔记数（只统计直接归属） */
export function countNotesByFolder(notes: Note[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const n of notes) {
    const f = n.folder || ''
    if (!f) continue
    map[f] = (map[f] || 0) + 1
  }
  return map
}

/**
 * 由有序的扁平文件夹列表构建树。
 * order 小的在前；同级内按 order 排，order 相同按名称排。
 * 父节点不存在或成环的节点，一律降级为根节点（数据脏了也不能崩）。
 */
export function buildFolderTree(folders: Folder[], counts: Record<string, number> = {}): FolderNode[] {
  const list = (folders || []).slice().sort((a, b) => {
    const oa = typeof a.order === 'number' ? a.order : 0
    const ob = typeof b.order === 'number' ? b.order : 0
    return oa - ob || String(a.name).localeCompare(String(b.name), 'zh')
  })

  // 断开成环的父子链：沿 parentId 往上走，若绕回自己或走进已访问节点，就把该节点提到根级。
  // 否则环里的节点既挂不到根上、也不会被任何父节点引用，会在界面上凭空消失。
  const byRawId = new Map<string, Folder>()
  list.forEach((f) => byRawId.set(f.id, f))
  list.forEach((f) => {
    const seen = new Set<string>()
    let cur: Folder | undefined = f
    let guard = 0
    while (cur && cur.parentId && guard++ < 500) {
      if (cur.parentId === f.id || seen.has(cur.parentId)) {
        f.parentId = null
        break
      }
      seen.add(cur.parentId)
      cur = byRawId.get(cur.parentId)
    }
  })

  const byId = new Map<string, FolderNode>()
  list.forEach((f) => {
    byId.set(f.id, {
      ...f,
      parentId: f.parentId || null,
      children: [],
      count: counts[f.id] || 0,
      total: 0,
      depth: 0,
      path: f.name,
    })
  })

  const roots: FolderNode[] = []
  list.forEach((f) => {
    const node = byId.get(f.id)!
    const parent = f.parentId ? byId.get(f.parentId) : null
    // 自己指向自己 / 指向不存在的父 → 当根处理
    if (parent && parent.id !== f.id) parent.children.push(node)
    else roots.push(node)
  })

  // 计算深度、路径与累计数量（同时断开成环）
  const seen = new Set<string>()
  const walk = (nodes: FolderNode[], depth: number, prefix: string) => {
    for (const n of nodes) {
      if (seen.has(n.id)) continue
      seen.add(n.id)
      n.depth = depth
      n.path = prefix ? `${prefix} / ${n.name}` : n.name
      walk(n.children, depth + 1, n.path)
      n.total = n.count + n.children.reduce((s, c) => s + c.total, 0)
    }
  }
  walk(roots, 0, '')

  return roots
}

/** 深度优先摊平成一行行（用于「移动到」列表、拖拽目标枚举） */
export function flattenFolders(nodes: FolderNode[]): FolderNode[] {
  const out: FolderNode[] = []
  const walk = (list: FolderNode[]) => {
    for (const n of list) {
      out.push(n)
      walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/** 收集某文件夹及其全部后代的 id */
export function descendantIds(nodes: FolderNode[], id: string): string[] {
  const hit = flattenFolders(nodes).find((n) => n.id === id)
  if (!hit) return [id]
  const out: string[] = []
  const walk = (n: FolderNode) => {
    out.push(n.id)
    n.children.forEach(walk)
  }
  walk(hit)
  return out
}

/** id 是否为 ancestorId 的后代（用于阻止把父文件夹拖进自己的子树） */
export function isDescendant(folders: Folder[], id: string, ancestorId: string): boolean {
  if (id === ancestorId) return true
  let cur: Folder | undefined = folders.find((f) => f.id === id)
  let guard = 0
  while (cur && cur.parentId && guard++ < 200) {
    if (cur.parentId === ancestorId) return true
    const parentId: string = cur.parentId
    cur = folders.find((f) => f.id === parentId)
  }
  return false
}

/**
 * 重排：把 dragId 放到 targetId 的 前 / 后 / 内部，返回新的有序列表
 * pos: 'before' | 'after' | 'inside'
 */
export function reorderFolders(
  folders: Folder[],
  dragId: string,
  targetId: string | null,
  pos: 'before' | 'after' | 'inside',
): Folder[] {
  if (dragId === targetId) return folders
  const drag = folders.find((f) => f.id === dragId)
  if (!drag) return folders

  // 不允许拖进自己的后代
  if (targetId && (pos === 'inside' ? isDescendant(folders, targetId, dragId) : false)) return folders

  const target = targetId ? folders.find((f) => f.id === targetId) : null
  const nextParent = pos === 'inside' ? targetId : target ? (target.parentId ?? null) : null

  const rest = folders.filter((f) => f.id !== dragId)
  const moved: Folder = { ...drag, parentId: nextParent ?? null }

  if (pos === 'inside' || !targetId) {
    // 作为 target 的最后一个子节点（或根末尾）
    return [...rest, moved]
  }

  const idx = rest.findIndex((f) => f.id === targetId)
  if (idx === -1) return [...rest, moved]
  const insertAt = pos === 'before' ? idx : idx + 1
  const out = rest.slice()
  out.splice(insertAt, 0, moved)
  return out
}

/** 重排后统一重算 order，保证落盘数据里 order 与数组顺序一致 */
export function normalizeOrder(folders: Folder[]): Folder[] {
  return folders.map((f, i) => ({ ...f, order: i }))
}

/** 同级内是否已有同名文件夹 */
export function hasSameName(folders: Folder[], parentId: string | null, name: string, exceptId?: string): boolean {
  const key = (name || '').trim().toLowerCase()
  return folders.some(
    (f) =>
      f.id !== exceptId &&
      (f.parentId || null) === (parentId || null) &&
      String(f.name).trim().toLowerCase() === key,
  )
}
