/**
 * Electron 主进程
 * ---------------------------------------------------------------
 * 职责：
 *   1. 创建应用窗口
 *   2. 提供本地文件系统读写能力（笔记 = 本地 .md 文件）
 *   3. 提供另存为 / 打印 PDF / 导入文件夹 / 打开目录等系统能力
 *
 * 设计原则：
 *   - 只使用 Node 内置模块 + electron 自带模块，无第三方依赖
 *   - 所有写操作「原子写」：先写 .tmp 再 rename，避免崩溃导致文件损坏
 *   - 删除 = 移入 trash 目录，永不直接抹除用户数据
 *   - 每次保存自动保留最近 N 份历史版本到 backups/
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification } = require('electron')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')

// ---------------------------------------------------------------- 常量
const APP_NAME = '工作笔记'
const NOTES_DIR = 'notes'
const ATTACH_DIR = 'attachments'
const TRASH_DIR = 'trash'
const BACKUP_DIR = 'backups'
const SETTINGS_FILE = 'settings.json'
const INDEX_FILE = 'index.json'
const EVENTS_FILE = 'events.json' // 日历：工作节点与提醒
const MAX_HISTORY = 5 // 每篇笔记保留的历史版本数

let mainWindow = null
let storageRoot = ''

// ---------------------------------------------------------------- 存储路径
/** 默认存储位置：用户「文档」目录下的 工作笔记 文件夹（直观、好备份） */
function defaultStorageRoot() {
  return path.join(app.getPath('documents'), 'Notekabi')
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true })
}

async function ensureStorageTree(root) {
  await ensureDir(root)
  await ensureDir(path.join(root, NOTES_DIR))
  await ensureDir(path.join(root, ATTACH_DIR))
  await ensureDir(path.join(root, TRASH_DIR))
  await ensureDir(path.join(root, BACKUP_DIR))
}

// ---------------------------------------------------------------- 设置
const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 15,
  storagePath: '',
  sortBy: 'updated', // updated | created | title
  previewMode: 'split', // edit | split | preview
  focusMode: false,
  dailyTemplate: 'daily',
  remindOnStart: true,
  layout: { sidebar: true, list: true, listStyle: 'list' },
}

async function readSettings() {
  try {
    const raw = await fsp.readFile(path.join(storageRoot, SETTINGS_FILE), 'utf8')
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

async function writeSettings(next) {
  const merged = { ...DEFAULT_SETTINGS, ...next }
  await fsp.writeFile(path.join(storageRoot, SETTINGS_FILE), JSON.stringify(merged, null, 2), 'utf8')
  return merged
}

// ---------------------------------------------------------------- 日历事件
/**
 * 工作节点与提醒独立于笔记存储（events.json）。
 * 数据量很小（几十到几百条），直接整体读写，简单可靠。
 */
async function readEvents() {
  try {
    const raw = await fsp.readFile(path.join(storageRoot, EVENTS_FILE), 'utf8')
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function writeEvents(list) {
  const safe = Array.isArray(list) ? list : []
  await atomicWrite(path.join(storageRoot, EVENTS_FILE), JSON.stringify(safe, null, 2))
  return safe
}

// ---------------------------------------------------------------- front-matter
/**
 * 极简 YAML front-matter 解析（只支持我们需要的扁平字段 + 数组）
 * 避免引入 gray-matter 之类的第三方依赖
 */
function parseFrontMatter(raw) {
  const result = { data: {}, content: raw }
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!m) return result
  const body = m[1]
  result.content = raw.slice(m[0].length)
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let val = line.slice(idx + 1).trim()
    if (!key) continue
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).trim()
      result.data[key] = val
        ? val
            .split(',')
            .map((s) => s.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean)
        : []
    } else if (val === 'true' || val === 'false') {
      result.data[key] = val === 'true'
    } else {
      result.data[key] = val.replace(/^["']|["']$/g, '')
    }
  }
  return result
}

/** 把笔记元数据序列化成 front-matter 文本 */
function stringifyFrontMatter(meta) {
  const tags = (meta.tags || []).join(', ')
  return [
    '---',
    `id: ${meta.id}`,
    `title: ${String(meta.title || '').replace(/\n/g, ' ')}`,
    `tags: [${tags}]`,
    `created: ${meta.created}`,
    `updated: ${meta.updated}`,
    `pinned: ${!!meta.pinned}`,
    `favorite: ${!!meta.favorite}`,
    `type: ${meta.type || 'note'}`,
    '---',
    '',
  ].join('\n')
}

/** 完整笔记 -> .md 文件内容 */
function serializeNote(note) {
  return stringifyFrontMatter(note) + (note.content || '')
}

/** .md 文件内容 -> 完整笔记对象 */
function deserializeNote(id, raw, fallbackStat) {
  const { data, content } = parseFrontMatter(raw)
  const created = data.created || (fallbackStat && fallbackStat.birthtime.toISOString()) || new Date().toISOString()
  const updated = data.updated || (fallbackStat && fallbackStat.mtime.toISOString()) || created
  return {
    id: data.id || id,
    title: data.title || id,
    tags: Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : [],
    created,
    updated,
    pinned: data.pinned === true || data.pinned === 'true',
    favorite: data.favorite === true || data.favorite === 'true',
    type: data.type || 'note',
    content,
  }
}

// ---------------------------------------------------------------- 原子写 & 历史备份
async function atomicWrite(file, data) {
  const tmp = file + '.tmp'
  await fsp.writeFile(tmp, data)
  await fsp.rename(tmp, file)
}

/** 保存前把旧版本归档到 backups/<id>/<timestamp>.md，保留最近 MAX_HISTORY 份 */
async function archiveHistory(noteId, file) {
  try {
    const stat = await fsp.stat(file)
    if (!stat.isFile()) return
    const dir = path.join(storageRoot, BACKUP_DIR, noteId)
    await ensureDir(dir)
    const name = new Date().toISOString().replace(/[:.]/g, '-') + '.md'
    await fsp.copyFile(file, path.join(dir, name))
    const files = (await fsp.readdir(dir)).sort()
    while (files.length > MAX_HISTORY) {
      const old = files.shift()
      await fsp.unlink(path.join(dir, old)).catch(() => {})
    }
  } catch {
    /* 首次保存没有历史，忽略 */
  }
}

// ---------------------------------------------------------------- 索引缓存
/**
 * index.json 缓存元数据（不含正文），启动时按 mtime 比对，
 * 只重新解析变动过的文件 —— 保证启动速度 < 2s
 */
async function buildIndex() {
  const notesDir = path.join(storageRoot, NOTES_DIR)
  const indexFile = path.join(storageRoot, INDEX_FILE)
  let cache = {}
  try {
    cache = JSON.parse(await fsp.readFile(indexFile, 'utf8'))
  } catch {
    cache = {}
  }

  const files = (await fsp.readdir(notesDir)).filter((f) => f.endsWith('.md'))
  const items = []
  const nextCache = {}

  for (const file of files) {
    const full = path.join(notesDir, file)
    let stat
    try {
      stat = await fsp.stat(full)
    } catch {
      continue
    }
    const fileId = file.replace(/\.md$/, '')
    const sig = `${stat.mtimeMs}|${stat.size}`
    const hit = cache[fileId]
    if (hit && hit.sig === sig) {
      items.push(hit.meta)
      nextCache[fileId] = hit
      continue
    }
    // 缓存未命中：读取文件解析 front-matter（不保留正文，节省内存）
    try {
      const raw = await fsp.readFile(full, 'utf8')
      const note = deserializeNote(fileId, raw, stat)
      const meta = {
        id: note.id,
        title: note.title,
        tags: note.tags,
        created: note.created,
        updated: note.updated,
        pinned: note.pinned,
        favorite: note.favorite,
        type: note.type,
        excerpt: makeExcerpt(note.content),
        words: countWords(note.content),
      }
      items.push(meta)
      nextCache[fileId] = { sig, meta }
    } catch {
      /* 损坏文件跳过 */
    }
  }

  await fsp.writeFile(indexFile, JSON.stringify(nextCache), 'utf8').catch(() => {})
  return items
}

/** 生成列表摘要：去掉 markdown 标记，取前 120 字 */
function makeExcerpt(content) {
  const text = String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[#>*_`~\-|>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 120)
}

/** 中英文混排字数统计：中日韩按字算，英文按词算 */
function countWords(content) {
  const text = String(content || '').replace(/\s+/g, ' ')
  const cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf]/g) || []).length
  const en = (text.match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g) || []).length
  return cjk + en
}

// ---------------------------------------------------------------- 窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true, // 隐藏菜单栏，按 Alt 可呼出，界面更干净
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  // 隐藏默认菜单（保留常用快捷键由渲染层自己处理）
  Menu.setApplicationMenu(null)

  mainWindow.once('ready-to-show', () => mainWindow.show())

  const devUrl = process.env.DEV_SERVER_URL
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    // app.getAppPath() 在开发环境返回项目根目录，打包后返回 resources/app，
    // 两种布局下 dist 都位于其下，避免手工拼接路径出错
    const htmlFile = path.join(app.getAppPath(), 'dist', 'index.html')
    mainWindow.loadFile(fs.existsSync(htmlFile) ? htmlFile : path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // 外部链接用系统浏览器打开，避免覆盖笔记界面
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 自检模式：NOTEKABI_SELFTEST=1 时，加载完成后检查界面是否渲染成功，
  // 把结果写入 selftest-result.json 并退出。用于 CI / 打包后的冒烟测试。
  if (process.env.NOTEKABI_SELFTEST === '1') {
    mainWindow.webContents.on('did-finish-load', async () => {
      const steps = {}
      const exec = (js) => mainWindow.webContents.executeJavaScript(js)
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const before = await fsp.readdir(path.join(storageRoot, NOTES_DIR)).catch(() => [])

      try {
        await wait(1800)
        steps['1_render'] = await exec(`({
          hasApp: !!document.querySelector('.app'),
          hasSidebar: !!document.querySelector('.sidebar'),
          hasList: !!document.querySelector('.list-pane'),
          hasEditor: !!document.querySelector('.main-pane'),
          title: (document.querySelector('.title-input') || {}).value || '',
          noteCount: document.querySelectorAll('.note-item').length,
          previewHtmlLen: (document.querySelector('.md-body') || {}).innerHTML?.length || 0,
          errors: window.__errors || []
        })`)

        // 新建笔记
        await exec(`document.querySelector('.btn-primary').click(), 'ok'`)
        await wait(700)

        // 模拟输入（React 受控组件需用原生 setter 触发）
        await exec(`(function(){
          const ta = document.querySelector('.md-input');
          const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          s.call(ta, ['# 自检笔记','','这是一段 **粗体** 与 *斜体*','','- [ ] 待办项一','- [x] 待办项二','',
                      '| 列A | 列B |','| --- | --- |','| 1 | 2 |','','\`\`\`js','const x = 1','\`\`\`','',
                      '双向链接 [[欢迎使用工作笔记]] 与行内 #自检标签'].join('\\n'));
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return 'typed'
        })()`)
        await wait(2600) // 等待防抖保存（0.8s）+ 落盘

        steps['2_afterType'] = await exec(`({
          title: (document.querySelector('.title-input') || {}).value,
          noteCount: document.querySelectorAll('.note-item').length,
          previewHtmlLen: (document.querySelector('.md-body') || {}).innerHTML?.length || 0,
          hasTable: !!document.querySelector('.md-body table'),
          hasCode: !!document.querySelector('.md-body .code-block'),
          hasTask: !!document.querySelector('.md-body input[type=checkbox]'),
          hasWiki: !!document.querySelector('.md-body .wikilink'),
          backlinks: document.querySelectorAll('.bl-item').length,
          errors: window.__errors || []
        })`)

        // 搜索
        await exec(`(function(){
          const i = document.querySelector('.search-box input');
          const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          s.call(i, '自检');
          i.dispatchEvent(new Event('input', { bubbles: true }));
          return 'searched'
        })()`)
        await wait(500)
        steps['3_search'] = await exec(`({
          count: document.querySelectorAll('.note-item').length,
          marks: document.querySelectorAll('mark').length
        })`)

        // 落盘校验
        const after = await fsp.readdir(path.join(storageRoot, NOTES_DIR)).catch(() => [])
        const added = after.filter((f) => !before.includes(f))
        steps['4_disk'] = { total: after.length, added: added.length }
        if (added.length) {
          const raw = await fsp.readFile(path.join(storageRoot, NOTES_DIR, added[0]), 'utf8')
          steps['4_disk'].hasFrontMatter = raw.startsWith('---')
          steps['4_disk'].snippet = raw.slice(0, 160)
        }
        // ⑤ 导出链路验证（Word / Markdown / PDF）
        const clickByText = async (label) => {
          await exec(`(function(){
            const b = Array.from(document.querySelectorAll('.dialog .btn')).find(x => x.textContent.includes(${JSON.stringify(label)}))
            if (b) b.click()
            return !!b
          })()`)
        }
        const openExportDialog = async () => {
          await exec(`(function(){
            const btn = document.querySelector('.editor-title-row .icon-btn[title="导出本篇"]')
            if (btn) btn.click()
            return !!btn
          })()`)
          await wait(500)
        }

        await openExportDialog()
        await clickByText('Word')
        await wait(2500)
        await openExportDialog()
        await clickByText('Markdown')
        await wait(1500)
        await openExportDialog()
        await clickByText('PDF')
        await wait(6000) // 打印视图 + printToPDF

        const exported = await fsp.readdir(SELFTEST_EXPORT_DIR).catch(() => [])
        steps['5_export'] = {}
        for (const f of exported) {
          const buf = await fsp.readFile(path.join(SELFTEST_EXPORT_DIR, f))
          const head = buf.slice(0, 4).toString('latin1')
          steps['5_export'][f] = { bytes: buf.length, head: head.replace(/[^\x20-\x7e]/g, '.') }
        }

        // ⑥ 日历视图：新建提醒并验证落盘（events.json）
        await exec(`(function(){
          const cal = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.textContent.includes('日历'))
          if (cal) cal.click()
          return 'opened'
        })()`)
        await wait(600)
        steps['6_calendar_open'] = await exec(`!!document.querySelector('.calendar-view')`)
        await exec(`(function(){
          const b = Array.from(document.querySelectorAll('.cal-actions .btn')).find((x) => x.textContent.includes('提醒'))
          if (b) b.click()
          return 'new'
        })()`)
        await wait(400)
        await exec(`(function(){
          const i = document.querySelector('.dialog .text-input')
          if (!i) return 'no-input'
          const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
          s.call(i, '自检提醒-版本评审')
          i.dispatchEvent(new Event('input', { bubbles: true }))
          return 'typed'
        })()`)
        await wait(200)
        await exec(`(function(){
          const b = Array.from(document.querySelectorAll('.dialog .btn.primary')).find((x) => x.textContent.trim() === '保存')
          if (b) b.click()
          return 'saved'
        })()`)
        await wait(900)
        steps['6_calendar'] = await exec(`({
          hasView: !!document.querySelector('.calendar-view'),
          eventCount: document.querySelectorAll('.cal-ev').length,
          errors: window.__errors || []
        })`)
        const evRaw = await fsp.readFile(path.join(storageRoot, EVENTS_FILE)).catch(() => null)
        steps['6_calendar'].diskHasEvents = !!evRaw && evRaw.includes('自检提醒-版本评审')
        if (evRaw) steps['6_calendar'].diskSnippet = evRaw.slice(0, 220)
        // 清理该事件
        await fsp.writeFile(path.join(storageRoot, EVENTS_FILE), '[]\n', 'utf8').catch(() => {})

        steps.ok = true

        // 清理自检产生的数据
        for (const f of added) {
          await fsp.unlink(path.join(storageRoot, NOTES_DIR, f)).catch(() => {})
        }
      } catch (err) {
        steps.ok = false
        steps.error = String(err && err.message ? err.message : err)
      }

      fs.writeFileSync(path.join(process.cwd(), 'selftest-result.json'), JSON.stringify(steps, null, 2), 'utf8')
      app.quit()
    })
  }
}

// ---------------------------------------------------------------- 单实例
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    // Windows 上设置应用标识，系统通知才能正确归类（不设置可能不弹 toast）
    try {
      if (process.platform === 'win32') app.setAppUserModelId('com.notekabi.app')
    } catch {}
    storageRoot = defaultStorageRoot()
    await ensureStorageTree(storageRoot)
    const saved = await readSettings()
    if (saved.storagePath) {
      try {
        await ensureStorageTree(saved.storagePath)
        storageRoot = saved.storagePath
      } catch {
        /* 自定义路径不可用时回退默认路径 */
      }
    }
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ---------------------------------------------------------------- IPC
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
  })
}

handle('app:info', async () => ({
  isElectron: true,
  storagePath: storageRoot,
  version: app.getVersion(),
  platform: process.platform,
}))

handle('settings:get', async () => (await readSettings()))
handle('settings:set', async (next) => {
  let merged = await writeSettings(next)
  // 支持运行时切换存储目录
  if (next && next.storagePath && next.storagePath !== storageRoot) {
    try {
      await ensureStorageTree(next.storagePath)
      storageRoot = next.storagePath
      // 关键：把设置同步写入新目录，否则下次启动读新目录会拿到默认值而回退
      merged = await writeSettings({ ...merged, storagePath: next.storagePath })
    } catch (e) {
      return { ...merged, storagePath: storageRoot, _error: '存储路径不可用，已保持原路径' }
    }
  }
  return merged
})

handle('notes:list', async () => buildIndex())

handle('notes:read', async (id) => {
  const file = path.join(storageRoot, NOTES_DIR, `${id}.md`)
  const raw = await fsp.readFile(file, 'utf8')
  let stat
  try {
    stat = await fsp.stat(file)
  } catch {}
  return deserializeNote(id, raw, stat)
})

handle('notes:write', async (note) => {
  await ensureDir(path.join(storageRoot, NOTES_DIR))
  const file = path.join(storageRoot, NOTES_DIR, `${note.id}.md`)
  await archiveHistory(note.id, file)
  await atomicWrite(file, serializeNote(note))
  return { id: note.id, updated: note.updated }
})

handle('notes:delete', async (id) => {
  const src = path.join(storageRoot, NOTES_DIR, `${id}.md`)
  const dst = path.join(storageRoot, TRASH_DIR, `${id}.md`)
  await ensureDir(path.join(storageRoot, TRASH_DIR))
  try {
    await fsp.rename(src, dst)
  } catch {
    /* 文件不存在时视为已删除 */
  }
  return true
})

handle('notes:listTrash', async () => {
  const dir = path.join(storageRoot, TRASH_DIR)
  const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md'))
  const out = []
  for (const f of files) {
    let title = f.replace(/\.md$/, '')
    try {
      const raw = await fsp.readFile(path.join(dir, f), 'utf8')
      title = parseFrontMatter(raw).data.title || title
    } catch {
      /* 保留文件名作为标题 */
    }
    out.push({ id: f.replace(/\.md$/, ''), title })
  }
  return out
})

handle('notes:restore', async (id) => {
  const src = path.join(storageRoot, TRASH_DIR, `${id}.md`)
  const dst = path.join(storageRoot, NOTES_DIR, `${id}.md`)
  await fsp.rename(src, dst)
  return true
})

handle('notes:purge', async (id) => {
  await fsp.unlink(path.join(storageRoot, TRASH_DIR, `${id}.md`)).catch(() => {})
  await fsp.rm(path.join(storageRoot, BACKUP_DIR, id), { recursive: true, force: true }).catch(() => {})
  return true
})

/** 附件写入：dataURL -> 文件，返回相对路径（供 markdown 引用） */
handle('attach:write', async ({ name, dataURL }) => {
  await ensureDir(path.join(storageRoot, ATTACH_DIR))
  const base64 = String(dataURL).split(',').pop() || ''
  const buf = Buffer.from(base64, 'base64')
  const safe = String(name).replace(/[\\/:*?"<>|]/g, '_')
  const file = path.join(storageRoot, ATTACH_DIR, safe)
  await atomicWrite(file, buf)
  return { relPath: `attachments/${safe}`, absPath: file }
})

handle('attach:resolve', async (relPath) => {
  // 把相对路径转换为可直接在 <img src> 使用的 file:// 地址
  const abs = path.join(storageRoot, relPath)
  return 'file:///' + abs.replace(/\\/g, '/')
})

handle('dialog:openFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  return res.canceled ? null : res.filePaths[0]
})

handle('dialog:openFiles', async (filters) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: filters || [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
  })
  return res.canceled ? [] : res.filePaths
})

/** 自检模式下跳过"另存为"对话框，直接落到固定目录，便于自动化验证导出链路 */
const SELFTEST_EXPORT_DIR =
  process.env.NOTEKABI_SELFTEST === '1' ? path.join(process.cwd(), 'selftest-export') : null

handle('dialog:saveFile', async ({ defaultName, filters, content, isBinary }) => {
  if (SELFTEST_EXPORT_DIR) {
    await ensureDir(SELFTEST_EXPORT_DIR)
    const p = path.join(SELFTEST_EXPORT_DIR, defaultName)
    await atomicWrite(p, isBinary ? Buffer.from(content) : Buffer.from(String(content), 'utf8'))
    return p
  }
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('documents'), defaultName || 'export.md'),
    filters: filters || [{ name: '所有文件', extensions: ['*'] }],
  })
  if (res.canceled || !res.filePath) return null
  const data = isBinary ? Buffer.from(content) : Buffer.from(String(content), 'utf8')
  await atomicWrite(res.filePath, data)
  return res.filePath
})

handle('dialog:saveBytes', async ({ defaultName, filters, bytes }) => {
  if (SELFTEST_EXPORT_DIR) {
    await ensureDir(SELFTEST_EXPORT_DIR)
    const p = path.join(SELFTEST_EXPORT_DIR, defaultName)
    await atomicWrite(p, Buffer.from(bytes))
    return p
  }
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('documents'), defaultName || 'export.docx'),
    filters: filters || [{ name: '所有文件', extensions: ['*'] }],
  })
  if (res.canceled || !res.filePath) return null
  await atomicWrite(res.filePath, Buffer.from(bytes))
  return res.filePath
})

/** PDF 导出：使用 Chromium 内置打印，无需 pandoc / 外部依赖 */
handle('export:pdf', async ({ defaultName }) => {
  if (SELFTEST_EXPORT_DIR) {
    await ensureDir(SELFTEST_EXPORT_DIR)
    const p = path.join(SELFTEST_EXPORT_DIR, defaultName)
    const data = await mainWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
    })
    await atomicWrite(p, data)
    return p
  }
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('documents'), defaultName || 'export.pdf'),
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
  })
  if (res.canceled || !res.filePath) return null
  const data = await mainWindow.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
  })
  await atomicWrite(res.filePath, data)
  return res.filePath
})

/** 导入：选择包含 .md 的文件夹，递归导入 */
handle('import:folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  if (res.canceled) return []
  const root = res.filePaths[0]
  const out = []
  const walk = async (dir) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full)
      } else if (/\.(md|markdown|txt)$/i.test(e.name)) {
        const raw = await fsp.readFile(full, 'utf8')
        const stat = await fsp.stat(full)
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        const parsed = parseFrontMatter(raw)
        const title =
          (parsed.data && parsed.data.title) || e.name.replace(/\.(md|markdown|txt)$/i, '')
        const note = {
          id,
          title,
          tags: (parsed.data && parsed.data.tags) || [],
          created: (parsed.data && parsed.data.created) || stat.birthtime.toISOString(),
          updated: (parsed.data && parsed.data.updated) || stat.mtime.toISOString(),
          pinned: false,
          favorite: false,
          type: 'note',
          content: parsed.content,
        }
        await atomicWrite(path.join(storageRoot, NOTES_DIR, `${id}.md`), serializeNote(note))
        out.push({ id: note.id, title: note.title })
      }
    }
  }
  await walk(root)
  return out
})

handle('shell:showItem', async (fullPath) => {
  shell.showItemInFolder(fullPath)
  return true
})

handle('shell:openPath', async (p) => {
  await shell.openPath(p)
  return true
})

handle('app:openStorage', async () => {
  shell.openPath(storageRoot)
  return storageRoot
})

handle('app:readFile', async (absPath, encoding) => {
  return await fsp.readFile(absPath, encoding || 'utf8')
})

// ---------------------------------------------------------------- 日历事件
handle('events:list', async () => readEvents())
handle('events:saveAll', async (list) => writeEvents(list))

/** 系统通知：用于到期提醒（失败不影响应用） */
handle('notify:send', async ({ title, body }) => {
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body, silent: false })
      n.show()
      return true
    }
  } catch {
    /* 系统不支持通知时静默忽略 */
  }
  return false
})
