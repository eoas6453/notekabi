/**
 * 文件夹收纳：基于现有标签机制。
 * 一个标签 = 一个文件夹，标签名支持「/」嵌套（"工作/项目A"）。
 * 数据层零变化，笔记 .md 里的 tags 数组原样兼容。
 */
export interface FolderNode {
  name: string
  full: string // 完整路径，用 / 连接
  count: number // 直属于该文件夹的笔记数（不含子文件夹）
  total: number // 含子文件夹的总数
  children: FolderNode[]
}

/** 从所有 tag 列表构造文件夹树 */
export function buildFolderTree(allTags: string[]): FolderNode[] {
  const root: FolderNode = { name: '', full: '', count: 0, total: 0, children: [] }
  for (const t of allTags) {
    if (!t) continue
    const parts = t.split('/').map((s) => s.trim()).filter(Boolean)
    if (!parts.length) continue
    let cur = root
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      let next = cur.children.find((c) => c.name === parts[i])
      if (!next) {
        next = { name: parts[i], full: acc, count: 0, total: 0, children: [] }
        cur.children.push(next)
      }
      // 只有最后一层算 count
      if (i === parts.length - 1) next.count += 1
      cur = next
    }
  }
  // 自底向上累加 total
  const fillTotal = (n: FolderNode): number => {
    n.total = n.count + n.children.reduce((s, c) => s + fillTotal(c), 0)
    return n.total
  }
  root.children.forEach((c) => fillTotal(c))
  // 排序：按名称（中文）
  const sort = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    nodes.forEach((n) => sort(n.children))
  }
  sort(root.children)
  return root.children
}

/** 把所有标签按字典序拍平成列表（用于「移动到…」弹窗） */
export function flattenFolders(nodes: FolderNode[], depth = 0): { full: string; label: string }[] {
  const out: { full: string; label: string }[] = []
  for (const n of nodes) {
    out.push({ full: n.full, label: '  '.repeat(depth) + (depth ? '└ ' : '') + n.name })
    out.push(...flattenFolders(n.children, depth + 1))
  }
  return out
}

/** 重命名：把 oldFull 改成 newFull（oldFull 必须是叶子 = 直接含笔记的标签） */
export function renameFolder(allTags: string[], oldFull: string, newFull: string): string[] {
  return allTags.map((t) => (t === oldFull ? newFull : t))
}

/** 合并：将 fromFull 合并到 toFull（fromFull 移除，含有 fromFull 的笔记改成 toFull） */
export function mergeFolder(allTags: string[], fromFull: string, toFull: string): string[] {
  return allTags.map((t) => (t === fromFull ? toFull : t))
}

/** 删除文件夹（仅删除该标签，笔记保留；该标签上的笔记会从该文件夹消失） */
export function deleteFolder(allTags: string[], folder: string): string[] {
  return allTags.filter((t) => t !== folder)
}

/** 笔记列表中的「标题里的深度」取最大层数（用于 UI 缩进） */
export function tagDepth(tag: string): number {
  return tag.split('/').length
}

/** 校验文件夹名合法性：不允许 / \ : * ? " < > | 开头/结尾空白 */
export function isValidFolderName(name: string): boolean {
  if (!name.trim()) return false
  if (name.includes('\\')) return false
  // 每个 / 段都校验
  for (const seg of name.split('/')) {
    if (!seg.trim()) return false
    if (/[\\:*?"<>|]/.test(seg)) return false
  }
  return true
}