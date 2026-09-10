import type { AppInfo, CalendarEvent, Folder, Note, Settings } from '../types'
import { deserializeNote, serializeNote, toMeta } from './note'

/**
 * 统一存储接口
 * ---------------------------------------------------------------
 * - 桌面端（Electron）：由 preload 注入 window.api，真正的本地文件读写
 * - 浏览器端（开发预览 / 无客户端时）：降级为 localStorage，功能可用但不落盘为 md
 *
 * 上层业务代码只依赖本接口，不感知运行环境。
 */
export interface AppAPI {
  isElectron: boolean
  appInfo(): Promise<AppInfo>
  getSettings(): Promise<Settings>
  setSettings(s: Partial<Settings>): Promise<Settings>
  listNotes(): Promise<any[]>
  readNote(id: string): Promise<Note>
  writeNote(note: Note): Promise<{ id: string; updated: string }>
  deleteNote(id: string): Promise<boolean>
  listTrash(): Promise<string[]>
  restoreNote(id: string): Promise<boolean>
  purgeNote(id: string): Promise<boolean>
  writeAttachment(p: { name: string; dataURL: string }): Promise<{ relPath: string; absPath: string }>
  resolveAttachment(rel: string): Promise<string>
  openFolderDialog(): Promise<string | null>
  openFilesDialog(filters?: any[]): Promise<string[]>
  saveFile(p: { defaultName: string; filters?: any[]; content: string; isBinary?: boolean }): Promise<string | null>
  saveBytes(p: { defaultName: string; filters?: any[]; bytes: number[] | Uint8Array }): Promise<string | null>
  exportPdf(p: { defaultName: string }): Promise<string | null>
  importFolder(): Promise<{ id: string; title: string }[]>
  showItem(p: string): Promise<boolean>
  openPath(p: string): Promise<boolean>
  openStorage(): Promise<string>
  readFile(p: string, enc?: string): Promise<string>
  listEvents(): Promise<CalendarEvent[]>
  saveEvents(list: CalendarEvent[]): Promise<CalendarEvent[]>
  listFolders(): Promise<Folder[]>
  saveFolders(list: Folder[]): Promise<Folder[]>
  notify(p: { title: string; body: string }): Promise<boolean>
  on?(channel: string, cb: (...a: any[]) => void): void
}

declare global {
  interface Window {
    api?: AppAPI
  }
}

// ---------------------------------------------------------------- 浏览器降级实现
const LS_NOTES = 'notekabi.notes'
const LS_SETTINGS = 'notekabi.settings'

const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  fontSize: 15,
  storagePath: '',
  sortBy: 'updated',
  previewMode: 'split',
  focusMode: false,
  dailyTemplate: 'daily',
  remindOnStart: true,
  layout: { sidebar: true, list: true, listStyle: 'list', listCollapsed: false },
}

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function lsSet(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val))
  } catch {
    /* 容量不足时忽略 */
  }
}

function downloadBlob(name: string, data: BlobPart[], mime: string) {
  const url = URL.createObjectURL(new Blob(data, { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const browserAPI: AppAPI = {
  isElectron: false,
  async appInfo() {
    return { isElectron: false, storagePath: '浏览器本地存储（开发预览模式）', version: 'web', platform: 'web' }
  },
  async getSettings() {
    return { ...DEFAULT_SETTINGS, ...lsGet<Partial<Settings>>(LS_SETTINGS, {}) }
  },
  async setSettings(s) {
    const next = { ...DEFAULT_SETTINGS, ...lsGet<Partial<Settings>>(LS_SETTINGS, {}), ...s }
    lsSet(LS_SETTINGS, next)
    return next
  },
  async listNotes() {
    const notes = lsGet<Note[]>(LS_NOTES, [])
    return notes.map(toMeta)
  },
  async readNote(id) {
    const notes = lsGet<Note[]>(LS_NOTES, [])
    const hit = notes.find((n) => n.id === id)
    if (!hit) throw new Error('笔记不存在')
    return hit
  },
  async writeNote(note) {
    const notes = lsGet<Note[]>(LS_NOTES, [])
    const i = notes.findIndex((n) => n.id === note.id)
    if (i >= 0) notes[i] = note
    else notes.push(note)
    lsSet(LS_NOTES, notes)
    return { id: note.id, updated: note.updated }
  },
  async deleteNote(id) {
    const notes = lsGet<Note[]>(LS_NOTES, [])
    lsSet(
      LS_NOTES,
      notes.filter((n) => n.id !== id),
    )
    return true
  },
  async listTrash() {
    return []
  },
  async restoreNote() {
    return true
  },
  async purgeNote() {
    return true
  },
  async writeAttachment({ name, dataURL }) {
    lsSet('notekabi.att.' + name, dataURL)
    return { relPath: 'attachments/' + name, absPath: dataURL }
  },
  async resolveAttachment(rel) {
    if (/^(https?:|data:|blob:|file:)/.test(rel)) return rel
    return localStorage.getItem('notekabi.att.' + rel.replace('attachments/', '')) || rel
  },
  async openFolderDialog() {
    return null
  },
  async openFilesDialog() {
    return []
  },
  async saveFile({ defaultName, content }) {
    downloadBlob(defaultName, [content], 'text/markdown;charset=utf-8')
    return defaultName
  },
  async saveBytes({ defaultName, bytes }) {
    const arr = (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) as unknown as BlobPart
    downloadBlob(defaultName, [arr], 'application/octet-stream')
    return defaultName
  },
  async exportPdf() {
    window.print()
    return null
  },
  async importFolder() {
    // 浏览器下用目录选择器导入（Chrome / Edge 支持）
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.setAttribute('webkitdirectory', '')
      input.multiple = true
      input.onchange = async () => {
        const files = Array.from(input.files || []).filter((f) => /\.(md|markdown|txt)$/i.test(f.name))
        const notes = lsGet<Note[]>(LS_NOTES, [])
        const added: { id: string; title: string }[] = []
        for (const f of files) {
          const raw = await f.text()
          const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          const note = deserializeNote(id, raw)
          note.title = note.title || f.name.replace(/\.(md|markdown|txt)$/i, '')
          notes.push(note)
          added.push({ id: note.id, title: note.title })
        }
        lsSet(LS_NOTES, notes)
        resolve(added)
      }
      input.click()
    })
  },
  async showItem() {
    return false
  },
  async openPath() {
    return false
  },
  async openStorage() {
    return '浏览器本地存储'
  },
  async listEvents() {
    return lsGet<CalendarEvent[]>('notekabi.events', [])
  },
  async saveEvents(list) {
    lsSet('notekabi.events', list)
    return list
  },
  async listFolders() {
    return lsGet<Folder[]>('notekabi.folders', [])
  },
  async saveFolders(list) {
    lsSet('notekabi.folders', list)
    return list
  },
  async notify({ title, body }) {
    if (typeof Notification !== 'undefined') {
      try {
        new Notification(title, { body })
      } catch {
        /* 浏览器未授权时忽略 */
      }
    }
    return false
  },
  async readFile(p) {
    return localStorage.getItem(p) || ''
  },
}

/** 导出统一入口：优先桌面端真实文件能力 */
export const api: AppAPI = typeof window !== 'undefined' && window.api ? window.api : browserAPI

export { DEFAULT_SETTINGS, serializeNote, deserializeNote }
