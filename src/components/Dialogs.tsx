import { useEffect, useMemo, useState } from 'react'
import type { Note, Settings } from '../types'
import { api } from '../lib/api'
import { TEMPLATES } from '../lib/templates'
import { renderMarkdown } from '../lib/markdown'
import { extractTasks } from '../lib/note'
import { toDateKey } from '../lib/date'

// ---------------------------------------------------------------- 通用外壳
export function Dialog({
  title,
  wide,
  onClose,
  children,
  footer,
}: {
  title: string
  wide?: boolean
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])
  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''}`}>
        <div className="dialog-head">
          <h3>{title}</h3>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 设置
export function SettingsDialog({
  settings,
  onSave,
  onClose,
  onExportAll,
  onImport,
  isElectron,
  storagePath,
  version,
}: {
  settings: Settings
  onSave: (s: Partial<Settings>) => void
  onClose: () => void
  onExportAll: (kind: 'md' | 'docx' | 'pdf') => void
  onImport: () => void
  isElectron: boolean
  storagePath: string
  version: string
}) {
  const [local, setLocal] = useState<Settings>(settings)

  const pickFolder = async () => {
    const dir = await api.openFolderDialog()
    if (dir) {
      setLocal({ ...local, storagePath: dir })
      onSave({ storagePath: dir })
    }
  }

  return (
    <Dialog title="设置" onClose={onClose}>
      <div className="field">
        <span className="field-label">主题</span>
        <div className="seg">
          <button className={local.theme === 'light' ? 'active' : ''} onClick={() => { setLocal({ ...local, theme: 'light' }); onSave({ theme: 'light' }) }}>
            浅色
          </button>
          <button className={local.theme === 'dark' ? 'active' : ''} onClick={() => { setLocal({ ...local, theme: 'dark' }); onSave({ theme: 'dark' }) }}>
            深色
          </button>
        </div>
      </div>

      <div className="field">
        <span className="field-label">正文字号：{local.fontSize}px</span>
        <input
          type="range"
          min={13}
          max={20}
          value={local.fontSize}
          style={{ width: '100%' }}
          onChange={(e) => setLocal({ ...local, fontSize: Number(e.target.value) })}
          onMouseUp={() => onSave({ fontSize: local.fontSize })}
          onTouchEnd={() => onSave({ fontSize: local.fontSize })}
        />
      </div>

      <div className="field">
        <span className="field-label">列表排序</span>
        <select
          className="text-input"
          value={local.sortBy}
          onChange={(e) => {
            const v = e.target.value as Settings['sortBy']
            setLocal({ ...local, sortBy: v })
            onSave({ sortBy: v })
          }}
        >
          <option value="updated">按更新时间</option>
          <option value="created">按创建时间</option>
          <option value="title">按标题</option>
        </select>
      </div>

      <div className="field">
        <span className="field-label">界面布局</span>
        <label className="check-row">
          <input
            type="checkbox"
            checked={local.layout.sidebar}
            onChange={(e) => {
              const next = { ...local.layout, sidebar: e.target.checked }
              setLocal({ ...local, layout: next })
              onSave({ layout: next })
            }}
          />
          <span>显示侧边栏导航</span>
        </label>
        <label className="check-row" style={{ marginTop: 6 }}>
          <input
            type="checkbox"
            checked={local.layout.list}
            onChange={(e) => {
              const next = { ...local.layout, list: e.target.checked }
              setLocal({ ...local, layout: next })
              onSave({ layout: next })
            }}
          />
          <span>显示笔记列表</span>
        </label>
        <label className="check-row" style={{ marginTop: 6 }}>
          <input
            type="checkbox"
            checked={local.layout.listStyle === 'cards'}
            disabled={!local.layout.list}
            onChange={(e) => {
              const next = { ...local.layout, listStyle: (e.target.checked ? 'cards' : 'list') as 'cards' | 'list' }
              setLocal({ ...local, layout: next })
              onSave({ layout: next })
            }}
          />
          <span>笔记列表以卡片网格展示</span>
        </label>
        <div className="field-hint">
          也可在底部状态栏用按钮实时切换，或用快捷键 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>（侧栏）/
          <kbd>L</kbd>（列表）/ <kbd>M</kbd>（卡片）。
        </div>
      </div>

      <div className="field">
        <span className="field-label">启动提醒</span>
        <label className="check-row">
          <input
            type="checkbox"
            checked={local.remindOnStart}
            onChange={(e) => {
              const v = e.target.checked
              setLocal({ ...local, remindOnStart: v })
              onSave({ remindOnStart: v })
            }}
          />
          <span>启动时弹出今日/逾期的待办提醒</span>
        </label>
      </div>

      <div className="field">
        <span className="field-label">数据存储位置</span>
        <div className="row">
          <input className="text-input" value={local.storagePath || storagePath} readOnly />
          <button className="btn" onClick={pickFolder} disabled={!isElectron}>
            更改
          </button>
        </div>
        <div className="field-hint">
          {isElectron
            ? '笔记以 .md 文件保存于此目录，可用任何编辑器打开、可用 Git 或网盘备份。更改后会自动在新位置创建目录结构。'
            : '当前为浏览器预览模式，数据保存在浏览器本地存储中。'}
        </div>
      </div>

      <div className="field">
        <span className="field-label">导入与导出</span>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn" onClick={onImport} disabled={!isElectron}>
            导入 Markdown 文件夹
          </button>
          <button className="btn" onClick={() => onExportAll('md')}>
            导出全部为 Markdown
          </button>
          <button className="btn" onClick={() => onExportAll('docx')}>
            导出全部为 Word
          </button>
          <button className="btn" onClick={() => onExportAll('pdf')}>
            导出全部为 PDF
          </button>
        </div>
        <div className="field-hint">单篇导出请使用编辑器右上角的 ⤓ 按钮。</div>
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <span className="field-label">关于</span>
        <div className="field-hint">
          工作笔记 v{version} · 本地优先，完全离线运行
          <br />
          快捷键：<kbd>Ctrl</kbd>+<kbd>K</kbd> 搜索 · <kbd>Ctrl</kbd>+<kbd>N</kbd> 新建 ·{' '}
          <kbd>Ctrl</kbd>+<kbd>D</kbd> 今日笔记 · <kbd>Ctrl</kbd>+<kbd>,</kbd> 设置
        </div>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- 统计
export function StatsDialog({ notes, onClose }: { notes: Note[]; onClose: () => void }) {
  const stats = useMemo(() => {
    const totalWords = notes.reduce((s, n) => s + (n.content.match(/[\u4e00-\u9fa5]|[A-Za-z0-9]+/g) || []).length, 0)
    const tagMap = new Map<string, number>()
    notes.forEach((n) => n.tags.forEach((t) => tagMap.set(t, (tagMap.get(t) || 0) + 1)))
    const tags = [...tagMap.entries()].sort((a, b) => b[1] - a[1])
    const daily = notes.filter((n) => n.type === 'daily').length
    const tasks = notes.flatMap((n) => extractTasks(n.content))
    const done = tasks.filter((t) => t.done).length
    const now = Date.now()
    const last7 = notes.filter((n) => now - +new Date(n.created) < 7 * 86400000).length
    const last30 = notes.filter((n) => now - +new Date(n.created) < 30 * 86400000).length
    // 按天统计最近 14 天更新量
    const byDay: { day: string; n: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * 86400000)
      const key = toDateKey(d)
      const n = notes.filter((x) => toDateKey(new Date(x.updated)) === key).length
      byDay.push({ day: `${d.getMonth() + 1}/${d.getDate()}`, n })
    }
    return { totalWords, tags, daily, tasks: tasks.length, done, last7, last30, byDay }
  }, [notes])

  const maxDay = Math.max(1, ...stats.byDay.map((d) => d.n))

  return (
    <Dialog title="数据统计" wide onClose={onClose}>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="v">{notes.length}</div>
          <div className="k">笔记总数</div>
        </div>
        <div className="stat-card">
          <div className="v">{stats.totalWords}</div>
          <div className="k">累计字数</div>
        </div>
        <div className="stat-card">
          <div className="v">{stats.tags.length}</div>
          <div className="k">标签数量</div>
        </div>
        <div className="stat-card">
          <div className="v">{stats.daily}</div>
          <div className="k">每日笔记</div>
        </div>
        <div className="stat-card">
          <div className="v">
            {stats.done}/{stats.tasks}
          </div>
          <div className="k">待办完成</div>
        </div>
        <div className="stat-card">
          <div className="v">{stats.last7}</div>
          <div className="k">近 7 天新建</div>
        </div>
      </div>

      <div className="field">
        <span className="field-label">标签使用频率</span>
        {stats.tags.length === 0 && <div className="field-hint">还没有使用标签</div>}
        {stats.tags.slice(0, 12).map(([t, n]) => (
          <div className="bar-row" key={t}>
            <span className="nm">#{t}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${(n / stats.tags[0][1]) * 100}%` }} />
            </span>
            <span className="vv">{n}</span>
          </div>
        ))}
      </div>

      <div className="field">
        <span className="field-label">最近 14 天活跃度</span>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 70 }}>
          {stats.byDay.map((d) => (
            <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div
                title={`${d.day}：${d.n} 篇`}
                style={{
                  width: '100%',
                  height: `${Math.max(3, (d.n / maxDay) * 52)}px`,
                  background: d.n ? 'var(--accent)' : 'var(--bg-hover)',
                  borderRadius: 3,
                }}
              />
              <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>{d.day}</span>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- 模板
export function TemplateDialog({
  onPick,
  onClose,
}: {
  onPick: (key: string) => void
  onClose: () => void
}) {
  return (
    <Dialog title="从模板新建" onClose={onClose}>
      <div className="tpl-grid">
        {TEMPLATES.map((t) => (
          <div key={t.key} className="tpl-card" onClick={() => onPick(t.key)}>
            <div className="ic">{t.icon}</div>
            <div className="nm">{t.name}</div>
            <div className="ds">{t.desc}</div>
          </div>
        ))}
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- 快捷键
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const list: [string, string][] = [
    ['新建笔记', 'Ctrl + N'],
    ['从模板新建', 'Ctrl + Shift + N'],
    ['打开今日笔记', 'Ctrl + D'],
    ['聚焦搜索', 'Ctrl + K / Ctrl + F'],
    ['随机回顾', 'Ctrl + R'],
    ['保存（自动保存，可手动触发）', 'Ctrl + S'],
    ['切换 编辑 / 分屏 / 预览', 'Ctrl + E'],
    ['专注模式（纯笔记）', 'Ctrl + Shift + F'],
    ['显示 / 隐藏侧边栏', 'Ctrl + Shift + B'],
    ['显示 / 隐藏笔记列表', 'Ctrl + Shift + L'],
    ['列表：卡片 / 行式切换', 'Ctrl + Shift + M'],
    ['加粗 / 斜体', 'Ctrl + B / Ctrl + I'],
    ['删除当前笔记', 'Ctrl + Delete'],
    ['设置', 'Ctrl + ,'],
    ['数据统计', 'Ctrl + Shift + S'],
    ['关系图谱', 'Ctrl + G'],
    ['日历视图', 'Ctrl + Shift + C'],
    ['待办看板', 'Ctrl + Shift + K'],
    ['关闭弹窗 / 退出搜索', 'Esc'],
  ]
  return (
    <Dialog title="键盘快捷键" onClose={onClose}>
      <table className="kbd-table">
        <tbody>
          {list.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>
                {v.split(' / ').map((x, i) => (
                  <span key={i}>
                    {i > 0 && ' 或 '}
                    {x.split(' + ').map((c, j) => (
                      <span key={j}>
                        {j > 0 && '+'}
                        <kbd>{c}</kbd>
                      </span>
                    ))}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  )
}

// ---------------------------------------------------------------- 回收站
export function TrashDialog({
  items,
  onRestore,
  onPurge,
  onClose,
}: {
  items: { id: string; title: string }[]
  onRestore: (id: string) => void
  onPurge: (id: string) => void
  onClose: () => void
}) {
  return (
    <Dialog title="回收站" onClose={onClose}>
      {items.length === 0 && <div className="empty-hint">回收站是空的</div>}
      {items.map((it) => (
        <div className="trash-item" key={it.id}>
          <span className="nm">{it.title}</span>
          <button className="btn" onClick={() => onRestore(it.id)}>
            恢复
          </button>
          <button className="btn danger" onClick={() => onPurge(it.id)}>
            彻底删除
          </button>
        </div>
      ))}
      <div className="field-hint" style={{ marginTop: 12 }}>
        删除的笔记会先移入回收站，并保留最近 5 个历史版本（存储目录 backups/），不会立刻丢失。
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- 随机回顾
export function RandomDialog({
  note,
  onAnother,
  onOpen,
  onClose,
}: {
  note: Note | null
  onAnother: () => void
  onOpen: () => void
  onClose: () => void
}) {
  if (!note) return <Dialog title="随机回顾" onClose={onClose}><div className="empty-hint">还没有可回顾的笔记</div></Dialog>
  return (
    <Dialog title="随机回顾 · 温故而知新" wide onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onAnother}>
            换一篇
          </button>
          <button className="btn primary" onClick={onOpen}>
            打开编辑
          </button>
        </>
      }
    >
      <h2 style={{ marginTop: 0 }}>{note.title}</h2>
      <div className="pm-meta">写于 {new Date(note.created).toLocaleDateString('zh-CN')}</div>
      <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }} />
    </Dialog>
  )
}
