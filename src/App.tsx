import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo, Backlink, CalendarEvent, Folder, Note, Settings, ViewKey } from './types'
import { api, DEFAULT_SETTINGS } from './lib/api'
import { deriveTitle, extractLinks, newId } from './lib/note'
import { searchNotes } from './lib/search'
import { dailyTitleText, renderTemplate } from './lib/templates'
import { dailyTitle, toDateKey } from './lib/date'
import { formatTimeAgo } from './lib/timeago'
import {
  buildFolderTree,
  countNotesByFolder,
  descendantIds,
  flattenFolders,
  hasSameName,
  isValidFolderName,
  newFolderId,
  NO_FOLDER,
  normalizeOrder,
  reorderFolders,
} from './lib/folder'
import { pendingReminders } from './lib/calendar'
import { buildPrintHtml, noteToMarkdown, notesToDocx, notesToMarkdownZip } from './lib/export'
import Sidebar from './components/Sidebar'
import FolderTree, { type DropPos } from './components/FolderTree'
import NoteList, { type ListItem } from './components/NoteList'
import EditorPane, { type EditorMode } from './components/EditorPane'
import PrintView from './components/PrintView'
import ContextMenu from './components/ContextMenu'
import { GraphView, KanbanView } from './components/Views'
import { CalendarView } from './components/CalendarView'
import {
  Dialog,
  MoveToDialog,
  PromptDialog,
  RandomDialog,
  SettingsDialog,
  ShortcutsDialog,
  StatsDialog,
  TagDialog,
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
    | null
    | 'settings'
    | 'stats'
    | 'template'
    | 'shortcuts'
    | 'trash'
    | 'random'
    | 'export'
    | 'move'
    | 'newFolder'
    | 'renameFolder'
    | 'addTag'
    | 'editTag'
  >(null)
  const [moveTarget, setMoveTarget] = useState<Note | null>(null)
  /** 右键菜单：笔记（在鼠标位置弹出功能框） */
  const [noteMenu, setNoteMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  /** 文件夹树（与标签完全独立）：有序、可嵌套、可折叠 */
  const [folders, setFolders] = useState<Folder[]>([])
  /** 新建 / 重命名文件夹时的上下文 */
  const [folderCtx, setFolderCtx] = useState<{ parentId: string | null; id?: string; name?: string } | null>(null)
  /** 侧栏各分组的折叠状态（存 localStorage，属纯 UI 偏好） */
  const [sections, setSections] = useState<Record<string, boolean>>({ tags: true })
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([])
  const [printJob, setPrintJob] = useState<{ html: string; name: string } | null>(null)
  const [showBacklinks, setShowBacklinks] = useState(true)
  const [trashItems, setTrashItems] = useState<{ id: string; title: string }[]>([])
  const [randomNote, setRandomNote] = useState<Note | null>(null)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [assetMap, setAssetMap] = useState<Record<string, string>>({})
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [freshlyCreated, setFreshlyCreated] = useState(false)
  /** 当前选中的文件夹 id；null = 全部，NO_FOLDER = 未归类 */
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  /** 是否在按文件夹筛选时包含子文件夹的笔记 */
  const [includeSubfolders, setIncludeSubfolders] = useState(true)

  const searchRef = useRef<HTMLInputElement>(null)
  /** 待保存队列：按 id 归档，批量改动（如整组移动文件夹）不会互相覆盖 */
  const pendingRef = useRef<Record<string, Note> | null>(null)
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
        const fds = await api.listFolders().catch(() => [])
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
        setFolders(fds)

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

  // ---------------------------------------------------------------- 侧栏分组折叠状态
  useEffect(() => {
    try {
      const raw = localStorage.getItem('notekabi.sidebar.sections')
      if (raw) setSections((s) => ({ ...s, ...JSON.parse(raw) }))
    } catch {
      /* 忽略 */
    }
  }, [])

  const toggleSection = useCallback((key: string) => {
    setSections((s) => {
      const next = { ...s, [key]: !s[key] }
      try {
        localStorage.setItem('notekabi.sidebar.sections', JSON.stringify(next))
      } catch {
        /* 忽略 */
      }
      return next
    })
  }, [])

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
    const batch = pendingRef.current
    if (!batch) return
    pendingRef.current = null
    try {
      for (const note of Object.values(batch)) await api.writeNote(note)
      setSavedAt(new Date().toISOString())
    } catch (e) {
      toast('保存失败：' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [toast])

  const scheduleSave = useCallback((note: Note) => {
    pendingRef.current = { ...(pendingRef.current || {}), [note.id]: note }
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

  // 每秒刷新一次状态栏的「x 秒前」，让用户看到保存时间在动
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

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
        // 新建时默认放进当前选中的文件夹
        folder: init?.folder ?? (activeFolder && activeFolder !== NO_FOLDER ? activeFolder : ''),
      }
      setNotes((ns) => [note, ...ns])
      setCurrentId(note.id)
      setView('all')
      setQuery('')
      setActiveTags([])
      setFreshlyCreated(true)
      scheduleSave(note)
      return note
    },
    [scheduleSave, activeFolder],
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

  // ---------------------------------------------------------------- 文件夹（独立于标签）
  /** 每个文件夹的笔记数（只算直接归属） */
  const folderCounts = useMemo(() => countNotesByFolder(notes), [notes])
  const folderTree = useMemo(() => buildFolderTree(folders, folderCounts), [folders, folderCounts])
  const flatFolders = useMemo(() => flattenFolders(folderTree), [folderTree])
  const unclassifiedCount = useMemo(() => notes.filter((n) => !n.folder).length, [notes])
  /** 当前选中文件夹（含子文件夹）的 id 集合，用于过滤列表 */
  const activeFolderIds = useMemo(() => {
    if (!activeFolder || activeFolder === NO_FOLDER) return null
    if (!includeSubfolders) return new Set([activeFolder])
    return new Set(descendantIds(folderTree, activeFolder))
  }, [activeFolder, includeSubfolders, folderTree])

  /** 文件夹改动落盘（folders.json） */
  const persistFolders = useCallback(
    (list: Folder[]) => {
      const ordered = normalizeOrder(list)
      setFolders(ordered)
      api.saveFolders(ordered).catch(() => toast('文件夹保存失败'))
    },
    [toast],
  )

  /** 新建文件夹：先弹输入框，parentId 为空则建在根级 */
  const createFolder = useCallback((parentId: string | null) => {
    setFolderCtx({ parentId })
    setDialog('newFolder')
  }, [])

  const doCreateFolder = useCallback(
    (raw: string) => {
      const parentId = folderCtx?.parentId ?? null
      const name = (raw || '').trim()
      if (!isValidFolderName(name)) {
        toast('文件夹名不能为空，也不能包含 / \\ : * ? " < > |')
        return
      }
      if (hasSameName(folders, parentId, name)) {
        toast('同级下已经有同名文件夹了')
        return
      }
      const f: Folder = { id: newFolderId(), name, parentId, order: folders.length, collapsed: false }
      persistFolders([...folders, f])
      setActiveFolder(f.id)
      toast(`已新建文件夹「${name}」`)
    },
    [folderCtx, folders, persistFolders, toast],
  )

  /** 重命名（树里内联输入后回车） */
  const applyRenameFolder = useCallback(
    (id: string, raw: string) => {
      const f = folders.find((x) => x.id === id)
      if (!f) return
      const name = (raw || '').trim()
      if (!name || name === f.name) return
      if (!isValidFolderName(name)) {
        toast('文件夹名不能为空，也不能包含 / \\ : * ? " < > |')
        return
      }
      if (hasSameName(folders, f.parentId, name, id)) {
        toast('同级下已经有同名文件夹了')
        return
      }
      persistFolders(folders.map((x) => (x.id === id ? { ...x, name } : x)))
      toast(`已重命名为「${name}」`)
    },
    [folders, persistFolders, toast],
  )

  /** 删除文件夹：笔记变「未归类」，子文件夹上提一级 */
  const deleteFolder = useCallback(
    (id: string) => {
      const target = folders.find((f) => f.id === id)
      if (!target) return
      const kids = folders.filter((f) => f.parentId === id).length
      if (
        !confirm(
          `删除文件夹「${target.name}」？\n\n· 里面的笔记不会被删除，会变成「未归类」` +
            (kids ? `\n· ${kids} 个子文件夹会上提一级` : ''),
        )
      )
        return
      const next = folders
        .filter((f) => f.id !== id)
        .map((f) => (f.parentId === id ? { ...f, parentId: target.parentId } : f))
      persistFolders(next)
      notes.filter((n) => n.folder === id).forEach((n) => updateNote(n.id, { folder: '' }))
      if (activeFolder === id) setActiveFolder(null)
      toast(`已删除文件夹「${target.name}」`)
    },
    [folders, notes, activeFolder, persistFolders, updateNote, toast],
  )

  const toggleFolderCollapse = useCallback(
    (id: string) => {
      persistFolders(folders.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)))
    },
    [folders, persistFolders],
  )

  /** 拖动文件夹排序 / 改变层级 */
  const moveFolder = useCallback(
    (dragId: string, targetId: string | null, pos: DropPos) => {
      const next = reorderFolders(folders, dragId, targetId, pos)
      if (next === folders) return
      persistFolders(next)
    },
    [folders, persistFolders],
  )

  /** 把笔记移动到某个文件夹（folderId 为空 = 未归类） */
  const moveNoteToFolder = useCallback(
    (noteId: string, folderId: string) => {
      const target = notes.find((n) => n.id === noteId)
      if (!target) return
      if ((target.folder || '') === folderId) {
        setDialog(null)
        setMoveTarget(null)
        return
      }
      updateNote(noteId, { folder: folderId })
      const name = folderId ? folders.find((f) => f.id === folderId)?.name || '文件夹' : '未归类'
      toast(`已移动到「${name}」`)
      setDialog(null)
      setMoveTarget(null)
    },
    [notes, folders, updateNote, toast],
  )

  /** 从笔记栏把笔记拖到文件夹上 */
  const dropNoteToFolder = useCallback(
    (noteId: string, folderId: string | null) => {
      moveNoteToFolder(noteId, folderId || '')
    },
    [moveNoteToFolder],
  )

  const knownTitles = useMemo(() => new Set(notes.map((n) => n.title.trim().toLowerCase())), [notes])

  // 待提醒（今日/逾期未完成）
  const pendingEvents = useMemo(() => pendingReminders(events, toDateKey()), [events])

  const listItems = useMemo<ListItem[]>(() => {
    let pool = notes
    if (view === 'favorite') pool = pool.filter((n) => n.favorite)
    if (view === 'daily') pool = pool.filter((n) => n.type === 'daily')
    if (activeTags.length) pool = pool.filter((n) => activeTags.every((t) => n.tags.includes(t)))
    if (activeFolder === NO_FOLDER) {
      pool = pool.filter((n) => !n.folder)
    } else if (activeFolderIds) {
      pool = pool.filter((n) => activeFolderIds.has(n.folder || ''))
    }

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
  }, [notes, view, activeTags, activeFolder, activeFolderIds, query, settings.sortBy])

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
  const showList = !settings.focusMode && settings.layout.list && !settings.layout.listCollapsed
  /** 笔记栏缩略成小球（贴左边栏，像电脑管家的悬浮球） */
  const showOrb = !settings.focusMode && settings.layout.list && !!settings.layout.listCollapsed

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
          collapsed={sections}
          onToggleSection={toggleSection}
          folderTree={
            <FolderTree
              nodes={folderTree}
              activeFolder={activeFolder}
              onSelect={setActiveFolder}
              onCreate={createFolder}
              onRename={applyRenameFolder}
              onDelete={deleteFolder}
              onToggleCollapse={toggleFolderCollapse}
              onMoveFolder={moveFolder}
              onDropNote={dropNoteToFolder}
              includeSubfolders={includeSubfolders}
              onToggleIncludeSubfolders={() => setIncludeSubfolders((v) => !v)}
              totalCount={notes.length}
              unclassifiedCount={unclassifiedCount}
            />
          }
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
                : activeFolder === NO_FOLDER
                  ? '没有未归类的笔记'
                  : activeFolder
                    ? '这个文件夹里还没有笔记，可以把笔记拖进来'
                    : '还没有笔记，按 Ctrl + N 开始记录'
          }
          onContextMenu={(e, id) => setNoteMenu({ x: e.clientX, y: e.clientY, id })}
          onCollapse={() => setLayout({ listCollapsed: true })}
        />
      )}

      {showOrb && (
        <button
          className="list-orb"
          style={{ left: showSidebar ? 232 : 8 }}
          title="展开笔记栏（也可按 Ctrl+Shift+L 切换）"
          onClick={() => setLayout({ listCollapsed: false })}
        >
          <span className="orb-ico">📋</span>
          <span className="orb-n">{listItems.length}</span>
        </button>
      )}

      {view === 'graph' ? (
        <GraphView
          notes={notes}
          currentId={currentId}
          onOpenNote={(id) => {
            void openNote(id)
            setView('all')
          }}
          onFilterTag={(t) => {
            setActiveTags([t])
            setView('all')
          }}
        />
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
          freshlyCreated={freshlyCreated}
          onFreshlyConsumed={() => setFreshlyCreated(false)}
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
          <span className={`save-dot ${saving ? 'dirty' : pendingRef.current ? 'pending' : ''}`} />
          {saving
            ? '正在保存…'
            : pendingRef.current
              ? '有改动，0.8 秒后保存'
              : savedAt
                ? `已保存 ${formatTimeAgo(savedAt)}`
                : '自动保存已开启'}
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

      {dialog === 'move' && (
        <MoveToDialog
          note={moveTarget}
          folders={flatFolders.map((f) => ({ id: f.id, label: f.name, depth: f.depth }))}
          onMove={(folderId) => moveTarget && moveNoteToFolder(moveTarget.id, folderId)}
          onClose={() => {
            setDialog(null)
            setMoveTarget(null)
          }}
          onNew={() => {
            setDialog(null)
            setMoveTarget(null)
            createFolder(null)
          }}
        />
      )}

      {dialog === 'newFolder' && (
        <PromptDialog
          title={folderCtx?.parentId ? '新建子文件夹' : '新建文件夹'}
          label="文件夹名称"
          placeholder="例如：工作 / 项目A / 读书笔记"
          confirmText="创建"
          onOk={(v) => {
            setDialog(null)
            doCreateFolder(v)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'editTag' && moveTarget && (
        <TagDialog
          note={moveTarget}
          allTags={tagStats.map((t) => t.name)}
          onToggle={(tag) => {
            const has = moveTarget.tags.includes(tag)
            updateNote(moveTarget.id, {
              tags: has ? moveTarget.tags.filter((x) => x !== tag) : [...moveTarget.tags, tag],
            })
          }}
          onAdd={(tag) => {
            if (!moveTarget.tags.includes(tag)) updateNote(moveTarget.id, { tags: [...moveTarget.tags, tag] })
          }}
          onClose={() => {
            setDialog(null)
            setMoveTarget(null)
          }}
        />
      )}

      {dialog === 'addTag' && moveTarget && (
        <PromptDialog
          title="添加标签"
          label={`给「${moveTarget.title || '无标题笔记'}」添加标签`}
          placeholder="多个标签用逗号分隔"
          confirmText="添加"
          onOk={(v) => {
            const add = v
              .split(/[,，\s]+/)
              .map((s) => s.trim())
              .filter(Boolean)
            const merged = Array.from(new Set([...moveTarget.tags, ...add]))
            updateNote(moveTarget.id, { tags: merged })
            setDialog(null)
            setMoveTarget(null)
            toast(add.length > 1 ? `已添加 ${add.length} 个标签` : `已添加标签「${add[0]}」`)
          }}
          onClose={() => {
            setDialog(null)
            setMoveTarget(null)
          }}
        />
      )}

      {/* 笔记右键功能框：在鼠标位置弹出 */}
      {noteMenu &&
        (() => {
          const n = notes.find((x) => x.id === noteMenu.id)
          if (!n) return null
          return (
            <ContextMenu
              x={noteMenu.x}
              y={noteMenu.y}
              title={n.title || '无标题笔记'}
              onClose={() => setNoteMenu(null)}
              items={[
                { icon: '📖', label: '打开', onSelect: () => void openNote(n.id) },
                {
                  icon: n.favorite ? '★' : '☆',
                  label: n.favorite ? '取消加星' : '加星',
                  onSelect: () => updateNote(n.id, { favorite: !n.favorite }),
                },
                {
                  icon: '📌',
                  label: n.pinned ? '取消置顶' : '置顶',
                  onSelect: () => updateNote(n.id, { pinned: !n.pinned }),
                },
                {
                  icon: '🏷',
                  label: '添加标签…',
                  sepBefore: true,
                  onSelect: () => {
                    setMoveTarget(n)
                    setDialog('addTag')
                  },
                },
                {
                  icon: '🏷',
                  label: '更改标签…',
                  onSelect: () => {
                    setMoveTarget(n)
                    setDialog('editTag')
                  },
                },
                {
                  icon: '📁',
                  label: '移动到文件夹…',
                  onSelect: () => {
                    setMoveTarget(n)
                    setDialog('move')
                  },
                },
                {
                  icon: '📋',
                  label: '复制标题',
                  sepBefore: true,
                  onSelect: () => {
                    try {
                      navigator.clipboard?.writeText(n.title || '')
                      toast('标题已复制')
                    } catch {
                      toast('当前环境不支持剪贴板')
                    }
                  },
                },
                {
                  icon: '📤',
                  label: '导出为 Markdown',
                  onSelect: () => {
                    api
                      .saveFile({
                        defaultName: `${n.title || '笔记'}.md`,
                        filters: [{ name: 'Markdown', extensions: ['md'] }],
                        content: noteToMarkdown(n),
                      })
                      .then(() => toast('已导出 Markdown'))
                      .catch(() => toast('导出已取消'))
                  },
                },
                {
                  icon: '🗑',
                  label: '删除',
                  danger: true,
                  sepBefore: true,
                  onSelect: () => void deleteNote(n.id),
                },
              ]}
            />
          )
        })()}

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
