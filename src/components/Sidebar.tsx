import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ViewKey } from '../types'
import type { ReactNode } from 'react'

interface Props {
  view: ViewKey
  onView: (v: ViewKey) => void
  counts: Record<string, number>
  tags: { name: string; count: number }[]
  activeTags: string[]
  onToggleTag: (t: string) => void
  onNew: () => void
  onTemplate: () => void
  onDaily: () => void
  onRandom: () => void
  onSettings: () => void
  storagePath: string
  onOpenStorage: () => void
  isElectron: boolean
  pendingCount?: number
  /** 文件夹树，由父组件注入（放在标签上方） */
  folderTree?: ReactNode
  /** 各分组是否折叠 */
  collapsed: Record<string, boolean>
  onToggleSection: (key: string) => void
  /** 新建一级文件夹（按钮挂在「文件夹」标题行右侧） */
  onNewFolder?: () => void
  /** 是否包含子文件夹的笔记 */
  includeSubfolders?: boolean
  onToggleIncludeSubfolders?: () => void
}

const NAV: { key: ViewKey; icon: string; label: string }[] = [
  { key: 'all', icon: '📝', label: '全部笔记' },
  { key: 'favorite', icon: '⭐', label: '收藏' },
  { key: 'daily', icon: '📅', label: '每日笔记' },
  { key: 'calendar', icon: '🗓️', label: '日历' },
  { key: 'kanban', icon: '✅', label: '待办看板' },
  { key: 'graph', icon: '🕸️', label: '关系图谱' },
  { key: 'stats', icon: '📊', label: '数据统计' },
  { key: 'trash', icon: '🗑️', label: '回收站' },
]

const SPLIT_KEY = 'notekabi.sidebar.folderH'
const readH = (): number | null => {
  try {
    const n = Number(localStorage.getItem(SPLIT_KEY))
    return n >= 120 ? n : null
  } catch {
    return null
  }
}

/** 可折叠分组：点标题栏收起 / 展开 */
function Section({
  id,
  label,
  collapsed,
  onToggle,
  children,
  grow,
  extra,
  style,
  innerRef,
}: {
  id: string
  label: string
  collapsed: Record<string, boolean>
  onToggle: (k: string) => void
  children: ReactNode
  /** 占满剩余高度（文件夹 / 标签这类可能很长的分组） */
  grow?: boolean
  /** 标题行右侧的附加按钮 */
  extra?: ReactNode
  style?: CSSProperties
  innerRef?: React.Ref<HTMLDivElement>
}) {
  const off = !!collapsed[id]
  return (
    <div
      ref={innerRef}
      className={`nav-group ${off ? 'collapsed' : ''}`}
      style={
        style ??
        (grow
          ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
          : undefined)
      }
    >
      <div
        className="sec-head"
        onClick={() => onToggle(id)}
        title={off ? '展开' : '收起'}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle(id)
          }
        }}
      >
        <span className={`sec-arrow ${off ? 'off' : ''}`}>▾</span>
        <span className="sec-label">{label}</span>
        <span className="spacer" />
        {!off && extra}
      </div>
      {!off && children}
    </div>
  )
}

export default function Sidebar(p: Props) {
  /** 文件夹区域高度（null = 自动等分）；拖动分隔条后固定，存 localStorage */
  const [folderH, setFolderH] = useState<number | null>(readH)
  const [dragging, setDragging] = useState(false)
  const asideRef = useRef<HTMLElement>(null)
  const foldersRef = useRef<HTMLDivElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ y: number; h: number; avail: number } | null>(null)

  const onSplitDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = foldersRef.current
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    const avail =
      el.getBoundingClientRect().height +
      (tagsRef.current?.getBoundingClientRect().height ?? 0)
    dragRef.current = { y: e.clientY, h: el.getBoundingClientRect().height, avail }
    setDragging(true)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 某些环境不支持指针捕获，退化为普通事件即可 */
    }
  }
  const onSplitMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    // 标签区至少保留 72px，文件夹区至少 110px，避免一方被压没
    const max = Math.max(120, d.avail - 72)
    const min = Math.min(110, max)
    const next = Math.max(min, Math.min(max, d.h + (e.clientY - d.y)))
    setFolderH(next)
  }
  const onSplitUp = () => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    const h = foldersRef.current?.getBoundingClientRect().height
    if (h && h >= 120) {
      try {
        localStorage.setItem(SPLIT_KEY, String(Math.round(h)))
      } catch {
        /* 忽略存储失败 */
      }
    }
  }
  /** 双击分隔条恢复自动等分 */
  const resetSplit = () => {
    dragRef.current = null
    setDragging(false)
    setFolderH(null)
    try {
      localStorage.removeItem(SPLIT_KEY)
    } catch {
      /* 忽略 */
    }
  }

  const folderStyle: CSSProperties | undefined =
    folderH != null
      ? { flex: '0 0 auto', height: folderH, minHeight: 0, display: 'flex', flexDirection: 'column' }
      : undefined

  return (
    <aside className="sidebar" ref={asideRef}>
      <div className="brand">
        <div className="brand-mark">工</div>
        <div className="brand-name">工作笔记</div>
      </div>

      <button className="btn-primary" onClick={p.onNew} title="新建笔记 (Ctrl+N)">
        <span>＋</span> 新建笔记
      </button>

      <Section id="nav" label="导航" collapsed={p.collapsed} onToggle={p.onToggleSection}>
        {NAV.map((n) => (
          <button
            key={n.key}
            className={`nav-item ${p.view === n.key ? 'active' : ''} ${
              n.key === 'calendar' && p.pendingCount ? 'alert' : ''
            }`}
            onClick={() => p.onView(n.key)}
          >
            <span className="ico">{n.icon}</span>
            <span>{n.label}</span>
            {p.counts[n.key] != null && (
              <span className={`count ${n.key === 'calendar' && p.pendingCount ? 'alert' : ''}`}>
                {p.counts[n.key]}
              </span>
            )}
          </button>
        ))}
      </Section>

      <Section id="quick" label="快捷操作" collapsed={p.collapsed} onToggle={p.onToggleSection}>
        <button className="nav-item" onClick={p.onDaily} title="打开今日笔记 (Ctrl+D)">
          <span className="ico">☀️</span>
          <span>今日笔记</span>
        </button>
        <button className="nav-item" onClick={p.onRandom} title="随机回顾 (Ctrl+R)">
          <span className="ico">🎲</span>
          <span>随机回顾</span>
        </button>
        <button className="nav-item" onClick={p.onTemplate} title="从模板新建 (Ctrl+Shift+N)">
          <span className="ico">📋</span>
          <span>从模板新建</span>
        </button>
      </Section>

      <Section
        id="folders"
        label="文件夹"
        collapsed={p.collapsed}
        onToggle={p.onToggleSection}
        grow={folderH == null}
        style={folderStyle}
        innerRef={foldersRef}
        extra={
          <>
            <button
              className="icon-btn sec-btn"
              title="新建一级文件夹"
              onClick={(e) => {
                e.stopPropagation()
                p.onNewFolder?.()
              }}
            >
              ＋
            </button>
            <button
              className={`icon-btn sec-btn ${p.includeSubfolders ? 'active' : ''}`}
              title="选中文件夹时同时显示子文件夹的笔记"
              onClick={(e) => {
                e.stopPropagation()
                p.onToggleIncludeSubfolders?.()
              }}
            >
              ↘
            </button>
          </>
        }
      >
        <div className="sidebar-folders">{p.folderTree}</div>
      </Section>

      {!p.collapsed.tags && (
        <div
          className={`sec-split ${dragging ? 'dragging' : ''}`}
          title="拖动调整「文件夹」与「标签」的高度 · 双击恢复自动等分"
          onPointerDown={onSplitDown}
          onPointerMove={onSplitMove}
          onPointerUp={onSplitUp}
          onPointerCancel={onSplitUp}
          onDoubleClick={resetSplit}
        >
          <span className="sec-split-bar" />
        </div>
      )}

      <Section
        id="tags"
        label={`标签${p.activeTags.length > 1 ? '（可多选组合）' : ''}`}
        collapsed={p.collapsed}
        onToggle={p.onToggleSection}
        grow
        innerRef={tagsRef}
      >
        <div className="sidebar-tags">
          {p.tags.length === 0 && <div className="nav-hint">暂无标签</div>}
          {p.tags.map((t) => (
            <button
              key={t.name}
              className={`tag-chip ${p.activeTags.includes(t.name) ? 'active' : ''}`}
              onClick={() => p.onToggleTag(t.name)}
              title={p.activeTags.length > 0 ? '点击可组合筛选' : ''}
            >
              {t.name}
              <span className="n">{t.count}</span>
            </button>
          ))}
        </div>
      </Section>

      <div className="sidebar-foot">
        <button className="nav-item" onClick={p.onSettings} title="设置 (Ctrl+,)">
          <span className="ico">⚙️</span>
          <span>设置</span>
        </button>
        <div
          className="storage-tip"
          onClick={p.onOpenStorage}
          title={p.isElectron ? '点击打开存储目录' : '浏览器预览模式：数据存于浏览器本地'}
        >
          {p.isElectron ? '📁 ' : '🌐 '}
          {p.storagePath}
        </div>
      </div>
    </aside>
  )
}
