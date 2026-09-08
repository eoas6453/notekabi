import { useState } from 'react'
import type { FolderNode } from '../lib/folder'

interface Props {
  nodes: FolderNode[]
  /** 当前选中的文件夹路径（精确匹配），null = 未选 */
  activeFolder: string | null
  onSelect: (folder: string | null) => void
  /** 右键操作 */
  onRename: (folder: string) => void
  onDelete: (folder: string) => void
  onMerge: (folder: string) => void
  onNewSub: (parent: string | null) => void
  /** 是否包含子文件夹的笔记 */
  includeSubfolders: boolean
  onToggleIncludeSubfolders: () => void
}

/** 单行文件夹节点，递归渲染子树 */
function Row({
  node,
  depth,
  activeFolder,
  includeSubfolders,
  onSelect,
  onRename,
  onDelete,
  onMerge,
}: {
  node: FolderNode
  depth: number
  activeFolder: string | null
  includeSubfolders: boolean
  onSelect: (folder: string | null) => void
  onRename: (f: string) => void
  onDelete: (f: string) => void
  onMerge: (f: string) => void
}) {
  const [open, setOpen] = useState(true)
  const hasChild = node.children.length > 0
  const isActive = activeFolder === node.full
  return (
    <>
      <div
        className={`folder-row ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => onSelect(node.full)}
        onContextMenu={(e) => {
          e.preventDefault()
          const choice = window.prompt(
            `「${node.full}」操作：\n  1) 重命名\n  2) 删除文件夹（笔记保留）\n  3) 合并到另一个文件夹\n输入 1 / 2 / 3（取消按 Esc）`,
            '1',
          )
          if (choice === '1') onRename(node.full)
          else if (choice === '2') onDelete(node.full)
          else if (choice === '3') onMerge(node.full)
        }}
        title={`右键查看操作（共 ${node.total} 篇${hasChild ? '，含子文件夹' : ''}）`}
      >
        <span
          className="folder-toggle"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((o) => !o)
          }}
        >
          {hasChild ? (open ? '▾' : '▸') : ' '}
        </span>
        <span className="folder-ico">📁</span>
        <span className="folder-name">{node.name}</span>
        <span className="folder-count">{includeSubfolders ? node.total : node.count}</span>
      </div>
      {open && hasChild && (
        <>
          {node.children.map((c) => (
            <Row
              key={c.full}
              node={c}
              depth={depth + 1}
              activeFolder={activeFolder}
              includeSubfolders={includeSubfolders}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
              onMerge={onMerge}
            />
          ))}
        </>
      )}
    </>
  )
}

export default function FolderTree(p: Props) {
  return (
    <div className="folder-tree">
      <div className="folder-head">
        <span>📁 收纳</span>
        <span className="spacer" />
        <button
          className="icon-btn"
          title="新建文件夹（标签）"
          onClick={() => p.onNewSub(p.activeFolder)}
        >
          ＋
        </button>
        <button
          className={`icon-btn ${p.includeSubfolders ? 'active' : ''}`}
          title="包含子文件夹的笔记"
          onClick={p.onToggleIncludeSubfolders}
        >
          ↘
        </button>
      </div>
      <div
        className={`folder-row ${p.activeFolder === null ? 'active' : ''}`}
        onClick={() => p.onSelect(null)}
        style={{ paddingLeft: 6 }}
      >
        <span className="folder-toggle"> </span>
        <span className="folder-ico">🗂</span>
        <span className="folder-name">全部</span>
        <span className="folder-count">—</span>
      </div>
      {p.nodes.length === 0 && (
        <div className="folder-empty">
          还没有文件夹
          <br />
          <button className="btn" style={{ marginTop: 6 }} onClick={() => p.onNewSub(null)}>
            新建一个
          </button>
        </div>
      )}
      {p.nodes.map((n) => (
        <Row
          key={n.full}
          node={n}
          depth={0}
          activeFolder={p.activeFolder}
          includeSubfolders={p.includeSubfolders}
          onSelect={p.onSelect}
          onRename={p.onRename}
          onDelete={p.onDelete}
          onMerge={p.onMerge}
        />
      ))}
    </div>
  )
}