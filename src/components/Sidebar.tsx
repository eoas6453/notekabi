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

/** 可折叠分组：点标题栏收起 / 展开 */
function Section({
  id,
  label,
  collapsed,
  onToggle,
  children,
  grow,
  extra,
}: {
  id: string
  label: string
  collapsed: Record<string, boolean>
  onToggle: (k: string) => void
  children: ReactNode
  /** 占满剩余高度（文件夹 / 标签这类可能很长的分组） */
  grow?: boolean
  extra?: ReactNode
}) {
  const off = !!collapsed[id]
  return (
    <div
      className={`nav-group ${off ? 'collapsed' : ''}`}
      style={
        grow
          ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
          : undefined
      }
    >
      <button className="sec-head" onClick={() => onToggle(id)} title={off ? '展开' : '收起'}>
        <span className={`sec-arrow ${off ? 'off' : ''}`}>▾</span>
        <span className="sec-label">{label}</span>
        <span className="spacer" />
        {extra}
      </button>
      {!off && children}
    </div>
  )
}

export default function Sidebar(p: Props) {
  return (
    <aside className="sidebar">
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

      <Section id="folders" label="文件夹" collapsed={p.collapsed} onToggle={p.onToggleSection} grow>
        <div className="sidebar-folders">{p.folderTree}</div>
      </Section>

      <Section
        id="tags"
        label={`标签${p.activeTags.length > 1 ? '（可多选组合）' : ''}`}
        collapsed={p.collapsed}
        onToggle={p.onToggleSection}
        grow
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
