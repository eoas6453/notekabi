import { useEffect, useRef, useState } from 'react'
import type { FolderNode } from '../lib/folder'
import { NO_FOLDER } from '../lib/folder'
import ContextMenu from './ContextMenu'

export type DropPos = 'before' | 'after' | 'inside'
export const NOTE_DND = 'application/x-notekabi-note'
export const FOLDER_DND = 'application/x-notekabi-folder'

interface Props {
  /** 树形结构（已带笔记计数） */
  nodes: FolderNode[]
  /** 当前选中的文件夹 id；null = 全部，NO_FOLDER = 未归类 */
  activeFolder: string | null
  onSelect: (id: string | null) => void
  onCreate: (parentId: string | null) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onToggleCollapse: (id: string) => void
  onMoveFolder: (dragId: string, targetId: string | null, pos: DropPos) => void
  onDropNote: (noteId: string, folderId: string | null) => void
  includeSubfolders: boolean
  totalCount: number
  unclassifiedCount: number
}

interface DropHint {
  id: string | null
  pos: DropPos
}

interface RowProps {
  node: FolderNode
  p: Props
  editingId: string | null
  onEdit: (id: string | null) => void
  hint: DropHint | null
  setHint: (h: DropHint | null) => void
  onMenu: (e: React.MouseEvent, id: string) => void
}

function Row(r: RowProps) {
  const { node: n, p } = r
  const isActive = p.activeFolder === n.id
  const hasChild = n.children.length > 0
  const editing = r.editingId === n.id
  const [draft, setDraft] = useState(n.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(n.name)
      // 下一帧再聚焦并全选，避免被父级重渲染打断
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, n.name])

  const commit = () => {
    const name = draft.trim()
    r.onEdit(null)
    if (!name || name === n.name) return
    p.onRename(n.id, name)
  }

  const cls = ['folder-row']
  if (isActive) cls.push('active')
  if (r.hint && r.hint.id === n.id) {
    if (r.hint.pos === 'inside') cls.push('drop-inside')
    else if (r.hint.pos === 'before') cls.push('drop-before')
    else cls.push('drop-after')
  }

  return (
    <>
      <div
        className={cls.join(' ')}
        style={{ paddingLeft: 4 + n.depth * 13 }}
        draggable={!editing}
        onClick={() => p.onSelect(n.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          r.onMenu(e, n.id)
        }}
        onDragStart={(e) => {
          e.dataTransfer.setData(FOLDER_DND, n.id)
          e.dataTransfer.effectAllowed = 'move'
          e.stopPropagation()
        }}
        onDragOver={(e) => {
          const types = Array.from(e.dataTransfer.types)
          if (!types.includes(FOLDER_DND) && !types.includes(NOTE_DND)) return
          e.preventDefault()
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const rel = e.clientY - rect.top
          if (types.includes(NOTE_DND)) {
            e.dataTransfer.dropEffect = 'move'
            r.setHint({ id: n.id, pos: 'inside' })
            return
          }
          const pos: DropPos = rel < rect.height * 0.28 ? 'before' : rel > rect.height * 0.72 ? 'after' : 'inside'
          e.dataTransfer.dropEffect = 'move'
          r.setHint({ id: n.id, pos })
        }}
        onDragLeave={() => {
          if (r.hint && r.hint.id === n.id) r.setHint(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const noteId = e.dataTransfer.getData(NOTE_DND)
          const folderId = e.dataTransfer.getData(FOLDER_DND)
          const pos = r.hint?.pos || 'inside'
          r.setHint(null)
          if (noteId) p.onDropNote(noteId, n.id)
          else if (folderId) p.onMoveFolder(folderId, n.id, pos)
        }}
        title={`${n.path}（${p.includeSubfolders ? n.total : n.count} 篇）· 可拖动排序，右键查看操作`}
      >
        <span
          className={`folder-toggle ${hasChild ? '' : 'leaf'}`}
          onClick={(e) => {
            e.stopPropagation()
            if (hasChild) p.onToggleCollapse(n.id)
          }}
          title={hasChild ? (n.collapsed ? '展开' : '折叠') : ''}
        >
          {hasChild ? (n.collapsed ? '▸' : '▾') : ''}
        </span>
        <span className="folder-ico">{n.collapsed && hasChild ? '📁' : '📂'}</span>
        {editing ? (
          <input
            ref={inputRef}
            className="folder-rename"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              else if (e.key === 'Escape') r.onEdit(null)
            }}
          />
        ) : (
          <span className="folder-name">{n.name}</span>
        )}
        <span className="folder-count">{p.includeSubfolders ? n.total : n.count}</span>
      </div>

      {!n.collapsed &&
        n.children.map((c) => (
          <Row
            key={c.id}
            node={c}
            p={p}
            editingId={r.editingId}
            onEdit={r.onEdit}
            hint={r.hint}
            setHint={r.setHint}
            onMenu={r.onMenu}
          />
        ))}
    </>
  )
}

export default function FolderTree(p: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [hint, setHint] = useState<DropHint | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)

  const openMenu = (e: React.MouseEvent, id: string) => {
    setMenu({ x: e.clientX, y: e.clientY, id })
  }

  const menuNode = menu ? p.nodes.map((n) => findNode(n, menu.id)).find(Boolean) || null : null

  return (
    <div
      className="folder-tree"
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer.types)
        if (types.includes(FOLDER_DND) || types.includes(NOTE_DND)) e.preventDefault()
      }}
      onDrop={(e) => {
        // 落在空白处：拖笔记 → 移出文件夹（未归类）；拖文件夹 → 提到根级末尾
        e.preventDefault()
        const noteId = e.dataTransfer.getData(NOTE_DND)
        const folderId = e.dataTransfer.getData(FOLDER_DND)
        setHint(null)
        if (noteId) p.onDropNote(noteId, null)
        else if (folderId) p.onMoveFolder(folderId, null, 'after')
      }}
    >
      <div
        className={`folder-row all ${p.activeFolder === null ? 'active' : ''}`}
        onClick={() => p.onSelect(null)}
        title="显示所有笔记"
      >
        <span className="folder-toggle leaf" />
        <span className="folder-ico">🗂</span>
        <span className="folder-name">全部</span>
        <span className="folder-count">{p.totalCount}</span>
      </div>

      {p.nodes.length === 0 && (
        <div className="folder-empty">
          还没有文件夹
          <br />
          <button className="btn" style={{ marginTop: 6 }} onClick={() => p.onCreate(null)}>
            新建一个
          </button>
        </div>
      )}

      {p.nodes.map((n) => (
        <Row
          key={n.id}
          node={n}
          p={p}
          editingId={editingId}
          onEdit={setEditingId}
          hint={hint}
          setHint={setHint}
          onMenu={openMenu}
        />
      ))}

      {p.unclassifiedCount > 0 && (
        <div
          className={`folder-row none ${p.activeFolder === NO_FOLDER ? 'active' : ''}`}
          onClick={() => p.onSelect(NO_FOLDER)}
          title="还没有归入任何文件夹的笔记"
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes(NOTE_DND)) e.preventDefault()
          }}
          onDrop={(e) => {
            const noteId = e.dataTransfer.getData(NOTE_DND)
            if (!noteId) return
            e.preventDefault()
            e.stopPropagation()
            p.onDropNote(noteId, null)
          }}
        >
          <span className="folder-toggle leaf" />
          <span className="folder-ico">📄</span>
          <span className="folder-name">未归类</span>
          <span className="folder-count">{p.unclassifiedCount}</span>
        </div>
      )}

      {menu && menuNode && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={menuNode.name}
          onClose={() => setMenu(null)}
          items={[
            { icon: '✎', label: '重命名', onSelect: () => setEditingId(menu.id) },
            { icon: '＋', label: '新建子文件夹', onSelect: () => p.onCreate(menu.id) },
            { icon: '📄', label: '新建同级文件夹', onSelect: () => p.onCreate(menuNode.parentId) },
            {
              icon: menuNode.collapsed ? '▸' : '▾',
              label: menuNode.collapsed ? '展开' : '折叠',
              onSelect: () => p.onToggleCollapse(menu.id),
            },
            { icon: '🗑', label: '删除文件夹', danger: true, sepBefore: true, onSelect: () => p.onDelete(menu.id) },
          ]}
        />
      )}
    </div>
  )
}

function findNode(n: FolderNode, id: string): FolderNode | null {
  if (n.id === id) return n
  for (const c of n.children) {
    const hit = findNode(c, id)
    if (hit) return hit
  }
  return null
}
