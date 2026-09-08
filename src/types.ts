/** 笔记完整数据（含正文） */
export interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  created: string // ISO 时间字符串
  updated: string
  pinned: boolean
  favorite: boolean
  type: 'note' | 'daily'
}

/** 列表项：不含正文，附带摘要与字数，用于列表渲染与搜索 */
export interface NoteMeta {
  id: string
  title: string
  tags: string[]
  created: string
  updated: string
  pinned: boolean
  favorite: boolean
  type: 'note' | 'daily'
  excerpt: string
  words: number
}

export interface Settings {
  theme: 'light' | 'dark'
  fontSize: number
  storagePath: string
  sortBy: 'updated' | 'created' | 'title'
  previewMode: 'edit' | 'split' | 'preview'
  focusMode: boolean
  dailyTemplate: string
  /** 启动时提醒今日/逾期的待办节点 */
  remindOnStart: boolean
}

export type EventKind = 'milestone' | 'reminder'
export type EventColor = 'purple' | 'blue' | 'green' | 'amber' | 'red'

/**
 * 日历事件：工作节点（里程碑）或提醒
 * 独立于笔记存储（events.json），可选择性关联一篇笔记
 */
export interface CalendarEvent {
  id: string
  /** YYYY-MM-DD */
  date: string
  title: string
  kind: EventKind
  color: EventColor
  noteId?: string
  noteTitle?: string
  done: boolean
  created: string
  updated: string
}

/** 侧边栏导航项 */
export type ViewKey = 'all' | 'favorite' | 'recent' | 'daily' | 'trash' | 'graph' | 'kanban' | 'stats' | 'calendar'

export interface AppInfo {
  isElectron: boolean
  storagePath: string
  version: string
  platform: string
}

/** 反向链接：引用了当前笔记的其它笔记 */
export interface Backlink {
  id: string
  title: string
  context: string
}
