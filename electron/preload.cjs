/**
 * 预加载脚本：在隔离上下文中向渲染进程暴露受控 API
 * 渲染进程不直接持有 Node 能力，所有文件操作都经过这里
 */
const { contextBridge, ipcRenderer } = require('electron')

/** 统一解包主进程返回的 { ok, data, error } */
async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args)
  if (res && res.ok) return res.data
  throw new Error((res && res.error) || '未知错误')
}

const api = {
  isElectron: true,
  appInfo: () => call('app:info'),
  getSettings: () => call('settings:get'),
  setSettings: (s) => call('settings:set', s),
  listNotes: () => call('notes:list'),
  readNote: (id) => call('notes:read', id),
  writeNote: (note) => call('notes:write', note),
  deleteNote: (id) => call('notes:delete', id),
  listTrash: () => call('notes:listTrash'),
  restoreNote: (id) => call('notes:restore', id),
  purgeNote: (id) => call('notes:purge', id),
  writeAttachment: (payload) => call('attach:write', payload),
  resolveAttachment: (rel) => call('attach:resolve', rel),
  openFolderDialog: () => call('dialog:openFolder'),
  openFilesDialog: (filters) => call('dialog:openFiles', filters),
  saveFile: (payload) => call('dialog:saveFile', payload),
  saveBytes: (payload) => call('dialog:saveBytes', payload),
  exportPdf: (payload) => call('export:pdf', payload),
  importFolder: () => call('import:folder'),
  showItem: (p) => call('shell:showItem', p),
  openPath: (p) => call('shell:openPath', p),
  openStorage: () => call('app:openStorage'),
  readFile: (p, enc) => call('app:readFile', p, enc),
  listEvents: () => call('events:list'),
  saveEvents: (list) => call('events:saveAll', list),
  listFolders: () => call('folders:list'),
  saveFolders: (list) => call('folders:saveAll', list),
  notify: (payload) => call('notify:send', payload),
  /** 监听主进程消息（保留扩展点） */
  on: (channel, cb) => {
    ipcRenderer.on(channel, (_e, ...args) => cb(...args))
  },
}

contextBridge.exposeInMainWorld('api', api)
