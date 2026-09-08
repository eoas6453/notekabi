import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo, Backlink, CalendarEvent, Note, Settings, ViewKey } from './types'
import { api, DEFAULT_SETTINGS } from './lib/api'
import { deriveTitle, extractLinks, newId } from './lib/note'
import { searchNotes } from './lib/search'
import { dailyTitleText, renderTemplate } from './lib/templates'
import { dailyTitle, toDateKey } from './lib/date'
import { pendingReminders } from './lib/calendar'
import { buildPrintHtml, noteToMarkdown, notesToDocx, notesToMarkdownZip } from './lib/export'
import Sidebar from './components/Sidebar'
import NoteList, { type ListItem } from './components/NoteList'
import EditorPane, { type EditorMode } from './components/EditorPane'
import PrintView from './components/PrintView'
import { GraphView, KanbanView } from './components/Views'
import { CalendarView } from './components/CalendarView'
import {
  Dialog,
  RandomDialog,
  SettingsDialog,
  ShortcutsDialog,
  StatsDialog,
  TemplateDialog,
  TrashDialog,
} from './components/Dialogs'

const WELCOME = `# 欢迎使用工作笔记 👋

这是一个**本地优先**的笔记工具：数据以 Markdown 文件存在你自己的电脑里，不联网、不上传、随时可备份。

## 三件事先记住

1. **想到就记**：\`Ctrl + N\` 新建，想到什么直接写，自动保存，不用管保存按钮。
2. **用标签归类**：在正文里写 \`#工作\` 或在标题下方添加标签，左侧点标签即可筛选。
3. **每天一篇**：\`Ctrl + D\` 打开今日笔记，用它做工作日志；\`Ctrl + R\` 随机回顾旧笔记。

## 常用 Markdown 语法

| 语法 | 效果 |
| --- | --- |
| \`# 标题\` | 一级标题 |
| \`**粗体**\` / \`*斜体*\` | **粗体** / *斜体* |
| \`- 列表\` | 无序列表 |
| \`- [ ] 待办\` | 待办清单（可在「待办看板」汇总查看） |
| \`\`\`代码块\`\`\` | 带高亮的代码块 |
| \`[[笔记标题]]\` | 双向链接，可在右侧看到反向链接 |
| \`#标签\` | 行内标签 |

> 提示：直接**粘贴截图**即可插入图片，图片会保存到存储目录的 attachments 文件夹。

## 键盘优先

按 \`Ctrl + ,\` 打开设置可切换深浅主题、字号和存储位置；按 \`Esc\` 随时退出搜索或弹窗。

---
这篇笔记可以随时删除。开始记录吧 🎯
`

export default function App() {
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState<Note[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [view, setView] = useState<ViewKey>('all')
  const [query, setQuery] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [mode, setMode] = useState<EditorMode>('split')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [dialog, setDialog] = useState<
    null | 'settings' | 'stats' | 'template' | 'shortcuts' | 'trash' | 'random' | 'export'
  >(null)
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([])
  const [printJob, setPrintJob] = useState<{ html: string; name: string } | null>(null)
  const [showBacklinks, setShowBacklinks] = useState(true)
  const [trashItems, setTrashItems] = useState<{ id: string; title: string }[]>([])
  const [randomNote, setRandomNote] = useState<Note | null>(null)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [assetMap, setAssetMap] = useState<Record<string, string>>({})
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<Note | null>(null)
  const timerRef = useRef<number | null>(null)

  // ---------------------------------------------------------------- 提示条
  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200)
  }, [])

  // ---------------------------------------------------------------- 初始化
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const info = await api.appInfo()
        const s = await api.getSettings()
        if (!alive) return
        setAppInfo(info)
        setSettings(s)
        setMode((s.previewMode as EditorMode) || 'split')

        const metas = await api.listNotes()
        const evs = await api.listEvents().catch(() => [])
        // 分批并发读取正文，保证大量笔记时也能快速启动
        const full: Note[] = []
        const size = 40
        for (let i = 0; i < metas.length; i += size) {
          const batch = metas.slice(i, i + size)
          const res = await Promise.all(batch.map((m: any) => api.readNote(m.id).catch(() => null)))
          res.forEach((n) => n && full.push(n))
        }
        full.sort((a, b) => +new Date(b.updated) - +new Date(a.updated))
        if (!alive) return

        if (full.length === 0) {
          // 首次使用：写入一篇引导笔记
          const now = new Date().toISOString()
          const welcome: Note = {
            id: newId(),
            title: '欢迎使用工作笔记',
            content: WELCOME,
            tags: ['指南'],
            created: now,
            updated: now,
            pinned: true,
            favorite: false,
            type: 'note',
          }
          await api.writeNote(welcome).catch(() => {})
          full.push(welcome)
        }
        setNotes(full)
        setEvents(evs)

        // 启动提醒：今日/逾期的提醒弹提示 + 系统通知
        if (s.remindOnStart) {
          const pend = pendingReminders(evs, toDateKey())
          if (pend.length) {
            toast(`有 ${pend.length} 个待提醒：${pend.slice(0, 3).map((e) => e.title).join('、')}${pend.length > 3 ? ' 等' : ''}`)
            if (info.isElectron) {
              api.notify({ title: '工作笔记 · 待提醒', body: `你有 ${pend.length} 个待处理的提醒，打开「日历」查看` }).catch(() => {})
            }
          }
        }

        const first = full.find((n) => n.pinned) || full[0]
        setCurrentId(first ? first.id : null)
      } catch (e) {
        console.error(e)
        toast('初始化失败：' + (e as Error).message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [toast])

  // ---------------------------------------------------------------- 主题与字号
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme)
    document.documentElement.style.setProperty('--font-size', `${settings.fontSize}px`)
    try {
      localStorage.setItem('notekabi.settings', JSON.stringify(settings))
    } catch {}
  }, [settings.theme, settings.fontSize])

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      setSettings((s) => ({ ...s, ...patch }))
      try {
        const saved = await api.setSettings(patch)
        if (saved && (saved as any)._error) {
          toast((saved as any)._error)
          setSettings((s) => ({ ...s, storagePath: appInfo?.storagePath || s.storagePath }))
        }
      } catch (e) {
        console.error(e)
      }
    },
    [appInfo, toast],
  )

  /** 更新布局偏好（侧栏 / 列表可见性、列表形式） */
  const setLayout = useCallback(
    (patch: Partial<Settings['layout']>) => {
      setSettings((s) => ({
        ...s,
        layout: { ...s.layout, ...patch },
      }))
      try {
        api.setSettings({ layout: { ...settings.layout, ...patch } } as Partial<Settings>).catch(() => {})
      } catch (e) {
        console.error(e)
      }
    },
    [settings.layout, toast],
  )

  // ---------------------------------------------------------------- 自动保存
  const flushSave = useCallback(async () => {
    const note = pendingRef.current
    if (!note) return
    pendingRef.current = null
    try {
      await api.writeNote(note)
      setSavedAt(new Date().toISOString())
    } catch (e) {
      toast('保存失败：' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [toast])

  const scheduleSave = useCallback((note: Note) => {
    pendingRef.current = note
    setSaving(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      void flushSave()
    }, 800)
  }, [flushSave])

  // 离开页面前尽力保存
  useEffect(() => {
    const h = () => {
      if (pendingRef.current) void flushSave()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [flushSave])

  // ---------------------------------------------------------------- 笔记操作
  const current = useMemo(() => notes.find((n) => n.id === currentId) || null, [notes, currentId])

  const updateNote = useCallback(
    (id: string, patch: Partial<Note>) => {
      // 注意：必须在 setNotes 之外先算出 next。
      // setState 的 updater 是延迟执行的，在其内部取值会导致落盘用的是旧对象。
      const target = notes.find((n) => n.id === id)
      if (!target) return
      const next: Note = { ...target, ...patch, updated: new Date().toISOString() }
      // 标题为空时，用正文首行自动命名
      if (patch.content !== undefined && (!next.title || next.title === '未命名笔记')) {
        next.title = deriveTitle(patch.content)
      }
      setNotes((ns) => ns.map((n) => (n.id === id ? next : n)))
      scheduleSave(next)
    },
    [notes, scheduleSave],
  )

  const createNote = useCallback(
    (init?: Partial<Note>) => {
      const now = new Date().toISOString()
      const note: Note = {
        id: newId(),
        title: init?.title || '',
        content: init?.content ?? '',
        tags: init?.tags ?? [],
        created: now,
        updated: now,
        pinned: false,
        favorite: false,
        type: init?.type ?? 'note',
      }
      setNotes((ns) => [note, ...ns])
      setCurrentId(note.id)
      setView('all')
      setQuery('')
      setActiveTags([])
      scheduleSave(note)
      return note
    },
    [scheduleSave],
  )

  const openNote = useCallback(
    async (id: string) => {
      if (id === currentId) return
      if (pendingRef.current) await flushSave()
      setCurrentId(id)
    },
    [currentId, flushSave],
  )

  const deleteNote = useCallback(
    async (id: string) => {
      const target = notes.find((n) => n.id === id)
      if (!target) return
      if (!confirm(`确定删除「${target.title || '无标题笔记'}」？\n（会先移入回收站，可恢复）`)) return
      await api.deleteNote(id)
      setNotes((ns) => ns.filter((n) => n.id !== id))
      if (currentId === id) {
        const rest = notes.filter((n) => n.id !== id)
        setCurrentId(rest.length ? rest[0].id : null)
      }
      toast('已移入回收站')
    },
    [notes, currentId, toast],
  )

  const openDaily = useCallback(async () => {
    const title = dailyTitleText()
    const exist = notes.find((n) => n.type === 'daily' && n.title === title)
    if (exist) {
      await openNote(exist.id)
      setView('all')
      return
    }
    if (pendingRef.current) await flushSave()
    const tpl = renderTemplate('daily')
    createNote({ title, content: tpl.body, tags: tpl.tags, type: 'daily' })
    toast('已创建今日笔记')
  }, [notes, openNote, createNote, flushSave])

  const openRandom = useCallback(() => {
    const pool = notes.filter((n) => n.id !== currentId)
    if (!pool.length) {
      toast('还没有其它笔记可以回顾')
      return
    }
    // 偏向上个月的旧笔记，更有"回顾"价值
    const old = pool.filter((n) => Date.now() - +new Date(n.updated) > 7 * 86400000)
    const pick = (old.length ? old : pool)[Math.floor(Math.random() * (old.length || pool.length))]
    setRandomNote(pick)
    setDialog('random')
  }, [notes, currentId, toast])

  const toggleTask = useCallback(
    (noteId: string, line: number) => {
      const n = notes.find((x) => x.id === noteId)
      if (!n) return
      const lines = n.content.split('\n')
      if (!lines[line]) return
      lines[line] = lines[line].replace(/\[([ xX])\]/, (_m, c) => (c === ' ' ? '[x]' : '[ ]'))
      updateNote(noteId, { content: lines.join('\n') })
    },
    [notes, updateNote],
  )

  const openTitle = useCallback(
    (title: string) => {
      const key = title.trim().toLowerCase()
      const hit = notes.find((n) => n.title.trim().toLowerCase() === key)
      if (hit) {
        void openNote(hit.id)
      } else {
        createNote({ title, content: `# ${title}\n\n` })
        toast(`已创建「${title}」`)
      }
    },
    [notes, openNote, createNote, toast],
  )

  // ---------------------------------------------------------------- 日历事件
  const saveEvents = useCallback(
    (list: CalendarEvent[]) => {
      setEvents(list)
      api.saveEvents(list).catch(() => toast('提醒保存失败'))
    },
    [toast],
  )

  /** 打开（或按日期创建）一篇每日笔记 */
  const openDailyAt = useCallback(
    async (dateKey: string) => {
      const [y, m, d] = dateKey.split('-').map(Number)
      const title = dailyTitle(new Date(y, m - 1, d))
      const exist = notes.find((n) => n.type === 'daily' && n.title === title)
      if (exist) {
        await openNote(exist.id)
        setView('all')
        return
      }
      if (pendingRef.current) await flushSave()
      const tpl = renderTemplate('daily')
      createNote({ title, content: tpl.body, tags: tpl.tags, type: 'daily' })
      toast('已创建当日笔记')
    },
    [notes, openNote, createNote, flushSave, toast],
  )

  // ---------------------------------------------------------------- 标签与过滤
  const tagStats = useMemo(() => {
    const map = new Map<string, number>()
    notes.forEach((n) => n.tags.forEach((t) => map.set(t, (map.get(t) || 0) + 1)))
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }))
  }, [notes])

  const knownTitles = useMemo(() => new Set(notes.map((n) => n.title.trim().toLowerCase())), [notes])

  // 待提醒（今日/逾期未完成）
  const pendingEvents = useMemo(() => pendingReminders(events, toDateKey()), [events])

  const listItems = useMemo<ListItem[]>(() => {
    let pool = notes
    if (view === 'favorite') pool = pool.filter((n) => n.favorite)
    if (view === 'daily') pool = pool.filter((n) => n.type === 'daily')
    if (activeTags.length) pool = pool.filter((n) => activeTags.every((t) => n.tags.includes(t)))

    if (query.trim()) {
      return searchNotes(pool, query).map((h) => ({ note: h.note, terms: h.terms, snippet: h.snippet }))
    }

    const sorted = [...pool].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (settings.sortBy === 'created') return +new Date(b.created) - +new Date(a.created)
      if (settings.sortBy === 'title') return a.title.localeCompare(b.title, 'zh')
      return +new Date(b.updated) - +new Date(a.updated)
    })
    return sorted.map((n) => ({ note: n, terms: [] }))
  }, [notes, view, activeTags, query, settings.sortBy])

  const highlightTerms = useMemo(() => {
    if (!query.trim()) return []
    return query
      .replace(/tag:\S+/gi, '')
      .split(/\s+/)
      .map((s) => s.replace(/^#/, '').replace(/["']/g, ''))
      .filter(Boolean)
  }, [query])

  // ---------------------------------------------------------------- 双向链接
  const { backlinks, outgoing } = useMemo(() => {
    if (!current) return { backlinks: [] as Backlink[], outgoing: [] as { title: string; exists: boolean }[] }
    const key = current.title.trim().toLowerCase()
    const bl: Backlink[] = []
    notes.forEach((n) => {
      if (n.id === current.id) return
      if (!extractLinks(n.content).some((l) => l.trim().toLowerCase() === key)) return
      const line =
        n.content
          .split('\n')
          .find((l) => l.toLowerCase().includes(`[[${key}`)) || ''
      bl.push({
        id: n.id,
        title: n.title,
        context: line.replace(/\[\[|\]\]/g, '').trim().slice(0, 90) || '（无上下文）',
      })
    })
    const out = extractLinks(current.content).map((t) => ({
      title: t,
      exists: knownTitles.has(t.trim().toLowerCase()),
    }))
    return { backlinks: bl, outgoing: out }
  }, [notes, current, knownTitles])

  // ---------------------------------------------------------------- 附件解析
  const resolveAsset = useCallback(
    (src: string) => {
      if (/^(https?:|data:|blob:|file:)/.test(src)) return src
      if (assetMap[src]) return assetMap[src]
      api
        .resolveAttachment(src)
        .then((url) => setAssetMap((m) => ({ ...m, [src]: url })))
        .catch(() => {})
      return src
    },
    [assetMap],
  )

  // ---------------------------------------------------------------- 导出
  const runExport = useCallback(
    async (kind: 'md' | 'docx' | 'pdf', scope: 'current' | 'all') => {
      const list = scope === 'current' ? (current ? [current] : []) : notes
      if (!list.length) {
        toast('没有可导出的笔记')
        return
      }
      const date = toDateKey()
      try {
        if (kind === 'md') {
          if (list.length === 1) {
            await api.saveFile({
              defaultName: `${list[0].title || '笔记'}.md`,
              filters: [{ name: 'Markdown', extensions: ['md'] }],
              content: noteToMarkdown(list[0]),
            })
          } else {
            const zip = await notesToMarkdownZip(list)
            await api.saveBytes({
              defaultName: `工作笔记-Markdown-${date}.zip`,
              filters: [{ name: '压缩包', extensions: ['zip'] }],
              bytes: zip,
            })
          }
          toast('已导出 Markdown')
        } else if (kind === 'docx') {
          const bytes = await notesToDocx(list)
          const name = list.length === 1 ? `${list[0].title || '笔记'}.docx` : `工作笔记-${date}.docx`
          await api.saveBytes({
            defaultName: name,
            filters: [{ name: 'Word 文档', extensions: ['docx'] }],
            bytes,
          })
          toast('已导出 Word')
        } else {
          const html = buildPrintHtml(list, resolveAsset)
          const name = list.length === 1 ? `${list[0].title || '笔记'}.pdf` : `工作笔记-${date}.pdf`
          setPrintJob({ html, name })
        }
      } catch (e) {
        toast('导出失败：' + (e as Error).message)
      }
    },
    [current, notes, resolveAsset, toast],
  )

  const doImport = useCallback(async () => {
    try {
      const added = await api.importFolder()
      if (!added.length) return
      // 重新载入全部笔记
      const metas = await api.listNotes()
      const full: Note[] = []
      for (let i = 0; i < metas.length; i += 40) {
        const batch = metas.slice(i, i + 40)
        const res = await Promise.all(batch.map((m: any) => api.readNote(m.id).catch(() => null)))
        res.forEach((n) => n && full.push(n))
      }
      full.sort((a, b) => +new Date(b.updated) - +new Date(a.updated))
      setNotes(full)
      toast(`已导入 ${added.length} 篇笔记`)
    } catch (e) {
      toast('导入失败：' + (e as Error).message)
    }
  }, [toast])

  // ---------------------------------------------------------------- 快捷键
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => {})
  handlerRef.current = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()

    if (mod && key === 'n') {
      e.preventDefault()
      if (e.shiftKey) setDialog('template')
      else createNote()
    } else if (mod && (key === 'k' || key === 'f')) {
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    } else if (mod && key === 'd') {
      e.preventDefault()
      void openDaily()
    } else if (mod && key === 'r') {
      e.preventDefault()
      openRandom()
    } else if (mod && key === 's') {
      e.preventDefault()
      if (e.shiftKey) setDialog('stats')
      else void flushSave()
    } else if (mod && key === 'e') {
      e.preventDefault()
      setMode((m) => (m === 'edit' ? 'split' : m === 'split' ? 'preview' : 'edit'))
    } else if (mod && e.shiftKey && key === 'f') {
      e.preventDefault()
      updateSettings({ focusMode: !settings.focusMode })
    } else if (mod && e.shiftKey && key === 'b') {
      e.preventDefault()
      setLayout({ sidebar: !settings.layout.sidebar })
    } else if (mod && e.shiftKey && key === 'l') {
      e.preventDefault()
      setLayout({ list: !settings.layout.list })
    } else if (mod && e.shiftKey && key === 'm') {
      e.preventDefault()
      if (settings.layout.list) {
        setLayout({ listStyle: settings.layout.listStyle === 'cards' ? 'list' : 'cards' })
      } else {
        setLayout({ list: true, listStyle: 'cards' })
      }
    } else if (mod && key === ',') {
      e.preventDefault()
      setDialog('settings')
    } else if (mod && key === 'g') {
      e.preventDefault()
      setView('graph')
    } else if (mod && e.shiftKey && key === 'c') {
      e.preventDefault()
      setView('calendar')
    } else if (mod && e.shiftKey && key === 'k') {
      e.preventDefault()
      setView('kanban')
    } else if (mod && key === 'delete' && current) {
      e.preventDefault()
      void deleteNote(current.id)
    } else if (e.key === 'Escape') {
      if (printJob) return
      if (query) setQuery('')
      else if (settings.focusMode) updateSettings({ focusMode: false })
      else if (dialog) setDialog(null)
    }
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => handlerRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ---------------------------------------------------------------- 回收站数据
  useEffect(() => {
    if (dialog === 'trash') {
      api.listTrash().then((ids) => {
        const list = (ids as any[]).map((x) =>
          typeof x === 'string' ? { id: x, title: x } : { id: x.id, title: x.title || '(无标题)' },
        )
        setTrashItems(list)
      })
    }
  }, [dialog])

  // ---------------------------------------------------------------- 渲染
  if (loading) {
    return (
      <div className="boot-splash">
        <div className="boot-logo">工作笔记</div>
        <div className="boot-tip">正在加载本地笔记…</div>
      </div>
    )
  }

  const isElectron = !!appInfo?.isElectron
  const storagePath = settings.storagePath || appInfo?.storagePath || ''

  // 布局可见性：专注模式（纯笔记）下隐藏所有左栏；否则按 layout 偏好
  const showSidebar = !settings.focusMode && settings.layout.sidebar
  const showList = !settings.focusMode && settings.layout.list

  return (
    <div className={`app ${settings.focusMode ? 'focus-mode' : ''}`}>
      {showSidebar && (
        <Sidebar
          view={view}
          onView={(v) => {
            if (v === 'stats') setDialog('stats')
            else if (v === 'trash') setDialog('trash')
            else setView(v)
          }}
          counts={{
            all: notes.length,
            favorite: notes.filter((n) => n.favorite).length,
            daily: notes.filter((n) => n.type === 'daily').length,
            calendar: pendingEvents.length,
          }}
          tags={tagStats}
          activeTags={activeTags}
          onToggleTag={(t) =>
            setActiveTags((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]))
          }
          onNew={() => createNote()}
          onTemplate={() => setDialog('template')}
          onDaily={() => void openDaily()}
          onRandom={openRandom}
          onSettings={() => setDialog('settings')}
          storagePath={storagePath || '本地存储'}
          onOpenStorage={() => isElectron && api.openStorage()}
          isElectron={isElectron}
          pendingCount={pendingEvents.length}
        />
      )}

      {showList && (
        <NoteList
          items={listItems}
          currentId={currentId}
          onOpen={openNote}
          query={query}
          onQuery={setQuery}
          sortBy={settings.sortBy}
          onSort={(s) => updateSettings({ sortBy: s as Settings['sortBy'] })}
          activeTags={activeTags}
          onClearTag={(t) => setActiveTags((ts) => ts.filter((x) => x !== t))}
          onClearAll={() => setActiveTags([])}
          searchRef={searchRef}
          group={view === 'all' && !query}
          mode={settings.layout.listStyle}
          emptyText={
            query
              ? '没有匹配的笔记，试试其它关键词'
              : activeTags.length
                ? '当前标签下没有笔记'
                : '还没有笔记，按 Ctrl + N 开始记录'
          }
        />
      )}

      {view === 'graph' ? (
        <GraphView notes={notes} currentId={currentId} onOpen={openNote} />
      ) : view === 'kanban' ? (
        <KanbanView notes={notes} onOpen={openNote} onToggle={toggleTask} />
      ) : view === 'calendar' ? (
        <CalendarView
          events={events}
          notes={notes}
          todayKey={toDateKey()}
          onSaveEvents={saveEvents}
          onOpenNote={openNote}
          onOpenDaily={openDailyAt}
        />
      ) : current ? (
        <EditorPane
          note={current}
          mode={mode}
          onMode={(m) => {
            setMode(m)
            updateSettings({ previewMode: m })
          }}
          onChange={(patch) => updateNote(current.id, patch)}
          onTogglePin={() => updateNote(current.id, { pinned: !current.pinned })}
          onToggleFav={() => updateNote(current.id, { favorite: !current.favorite })}
          onDelete={() => void deleteNote(current.id)}
          onExport={() => setDialog('export')}
          onFocusToggle={() => updateSettings({ focusMode: !settings.focusMode })}
          focusMode={settings.focusMode}
          knownTitles={knownTitles}
          highlightTerms={highlightTerms}
          resolveAsset={resolveAsset}
          backlinks={backlinks}
          outgoing={outgoing}
          onOpenNote={openNote}
          onOpenTitle={openTitle}
          onAddTag={(t) => {
            if (!current.tags.includes(t)) updateNote(current.id, { tags: [...current.tags, t] })
          }}
          onRemoveTag={(t) => updateNote(current.id, { tags: current.tags.filter((x) => x !== t) })}
          showBacklinks={showBacklinks}
          onToggleBacklinks={() => setShowBacklinks((s) => !s)}
        />
      ) : (
        <div className="main-pane">
          <div className="empty-hint" style={{ marginTop: 120 }}>
            还没有选中笔记
            <br />
            <button className="btn primary" style={{ marginTop: 14 }} onClick={() => createNote()}>
              新建一篇
            </button>
          </div>
        </div>
      )}

      {/* 底部状态栏 */}
      <div
        className="status-bar"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          borderTop: '1px solid var(--border)',
        }}
      >
        <span>
          <span className={`save-dot ${saving ? 'dirty' : ''}`} />
          {saving ? '正在保存…' : savedAt ? `已保存 ${new Date(savedAt).toLocaleTimeString('zh-CN')}` : '自动保存已开启'}
        </span>
        <span>共 {notes.length} 篇</span>
        <span className="layout-group" role="group" aria-label="界面布局">
          <button
            className={`icon-btn ${settings.focusMode ? 'active' : ''}`}
            title="纯笔记（专注模式，Ctrl+Shift+F）"
            onClick={() => updateSettings({ focusMode: !settings.focusMode })}
          >
            ⛶
          </button>
          <button
            className={`icon-btn ${settings.layout.sidebar ? 'active' : ''}`}
            title="侧边栏（Ctrl+Shift+B）"
            onClick={() => setLayout({ sidebar: !settings.layout.sidebar })}
          >
            🧭
          </button>
          <button
            className={`icon-btn ${settings.layout.list ? 'active' : ''}`}
            title="笔记列表（Ctrl+Shift+L）"
            onClick={() => setLayout({ list: !settings.layout.list })}
          >
            📋
          </button>
          <button
            className={`icon-btn ${settings.layout.listStyle === 'cards' ? 'active' : ''}`}
            title="列表以卡片展示（Ctrl+Shift+M）"
            disabled={!settings.layout.list}
            onClick={() =>
              setLayout({ listStyle: settings.layout.listStyle === 'cards' ? 'list' : 'cards' })
            }
          >
            ▦
          </button>
        </span>
        <span className="spacer" />
        <span>{isElectron ? '本地运行 · 无需联网' : '浏览器预览模式'}</span>
        <button className="icon-btn" title="快捷键说明" onClick={() => setDialog('shortcuts')}>
          ⌨
        </button>
      </div>

      {/* 弹窗 */}
      {dialog === 'settings' && (
        <SettingsDialog
          settings={settings}
          onSave={updateSettings}
          onClose={() => setDialog(null)}
          onExportAll={(kind) => runExport(kind, 'all')}
          onImport={() => void doImport()}
          isElectron={isElectron}
          storagePath={storagePath}
          version={appInfo?.version || '1.0.0'}
        />
      )}
      {dialog === 'stats' && <StatsDialog notes={notes} onClose={() => setDialog(null)} />}
      {dialog === 'template' && (
        <TemplateDialog
          onPick={(key) => {
            const tpl = renderTemplate(key)
            createNote({ content: tpl.body, tags: tpl.tags, title: key === 'daily' ? dailyTitleText() : '' })
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'trash' && (
        <TrashDialog
          items={trashItems}
          onRestore={async (id) => {
            await api.restoreNote(id)
            setTrashItems((t) => t.filter((x) => x.id !== id))
            const n = await api.readNote(id).catch(() => null)
            if (n) setNotes((ns) => [n, ...ns])
            toast('已恢复')
          }}
          onPurge={async (id) => {
            await api.purgeNote(id)
            setTrashItems((t) => t.filter((x) => x.id !== id))
            toast('已彻底删除')
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'random' && (
        <RandomDialog
          note={randomNote}
          onAnother={() => {
            const pool = notes.filter((n) => n.id !== randomNote?.id)
            if (pool.length) setRandomNote(pool[Math.floor(Math.random() * pool.length)])
          }}
          onOpen={() => {
            if (randomNote) void openNote(randomNote.id)
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'export' && (
        <Dialog title="导出笔记" onClose={() => setDialog(null)}>
          <div className="field">
            <span className="field-label">导出本篇</span>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => { runExport('md', 'current'); setDialog(null) }}>
                Markdown
              </button>
              <button className="btn" onClick={() => { runExport('docx', 'current'); setDialog(null) }}>
                Word (.docx)
              </button>
              <button className="btn" onClick={() => { runExport('pdf', 'current'); setDialog(null) }}>
                PDF
              </button>
            </div>
          </div>
          <div className="field">
            <span className="field-label">导出全部（{notes.length} 篇）</span>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => { runExport('md', 'all'); setDialog(null) }}>
                Markdown 压缩包
              </button>
              <button className="btn" onClick={() => { runExport('docx', 'all'); setDialog(null) }}>
                合并为 Word
              </button>
              <button className="btn" onClick={() => { runExport('pdf', 'all'); setDialog(null) }}>
                合并为 PDF
              </button>
            </div>
          </div>
          <div className="field-hint">Word 导出会保留标题、列表、表格、代码块等基本格式；PDF 使用内置打印引擎生成。</div>
        </Dialog>
      )}

      {printJob && (
        <PrintView
          html={printJob.html}
          name={printJob.name}
          onDone={(ok, path) => {
            setPrintJob(null)
            if (ok) toast(path ? `已导出 PDF：${path}` : '已导出 PDF')
          }}
        />
      )}

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  )
}
