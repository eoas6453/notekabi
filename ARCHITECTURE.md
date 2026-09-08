# 工作笔记 · 技术架构文档

---

## 一、技术选型与理由

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 桌面外壳 | **Electron 44** | 本机无 Rust 工具链，Tauri 需要额外安装 MSVC + Cargo（约 30 分钟且易失败）；Electron 是纯 JS 工具链，`npm install` 即可得运行时 |
| 前端框架 | **React 18 + TypeScript** | 生态成熟、类型安全、构建产物小 |
| 构建 | **Vite 5** | 冷启动与构建都在秒级；`base: './'` 支持 file:// 加载 |
| 编辑器 | **自研（textarea + 自研渲染器）** | 不用 CodeMirror 6 —— 它会拉入 30+ 个子包；工作笔记更需要"所见即所得 + 低干扰"，分屏预览 + 工具栏已足够 |
| Markdown | **自研 `src/lib/markdown.ts`** | 不引入 markdown-it / remark —— 只需覆盖 GFM 常用子集，自研 300 行搞定，包体与依赖都更干净 |
| 搜索 | **自研线性扫描** | 个人笔记 < 5000 篇，线性扫描亚毫秒级；MiniSearch/FlexSearch 属于过度设计 |
| Word 导出 | **自研 OOXML + 自研 zip** | `docx` 库体积大且 API 重；OOXML 最小集只需 4 个文件，配合 Node/浏览器内置 deflate 自己打包即可 |
| PDF 导出 | **Chromium `printToPDF`** | 无需 pandoc、无需打印机驱动，版式与屏幕预览一致 |
| 打包分发 | **目录复制 + 内置 zip** | 不用 electron-builder —— 它会下载 winCodeSign/NSIS 等数百 MB 组件且产出安装程序；本项目要的是"解压即用"的绿色版 |

**最终运行时依赖：`react` + `react-dom`，仅此两个。**

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        渲染进程（Chromium）                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ React UI (src/App.tsx 为状态中枢)                       │  │
│  │  Sidebar │ NoteList │ EditorPane │ Backlinks │ Dialogs │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 业务库：markdown / search / note / export / zip / tpl   │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 存储抽象层 src/lib/api.ts                               │  │
│  │   桌面端 → window.api（preload 桥接）                   │  │
│  │   浏览器 → localStorage（开发预览降级）                  │  │
│  └───────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │  IPC（contextBridge，隔离上下文）
┌───────────────────────────▼─────────────────────────────────┐
│                    主进程 electron/main.cjs                   │
│   文件读写 · 原子写入 · 历史版本 · 对话框 · 打印 PDF · 导入   │
│   （仅使用 node:fs / node:path + electron，无第三方依赖）      │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                     本地文件系统（数据源）                     │
│   文档\Notekabi\notes\*.md  + attachments + backups + trash   │
└─────────────────────────────────────────────────────────────┘
```

**分层原则**：UI 不知道数据存在哪（只调 `api` 接口）；主进程不知道 UI 长什么样（只提供原子能力）。替换存储（比如改成 SQLite 或接云同步）只需改 `src/lib/api.ts` 一处。

---

## 三、目录结构

```
Notekabi/
├── electron/
│   ├── main.cjs                 主进程：窗口 + IPC 处理 + 文件读写
│   └── preload.cjs              contextBridge：向渲染进程暴露受控 API
├── src/
│   ├── main.tsx                 入口
│   ├── App.tsx                  状态中枢：笔记状态、自动保存、快捷键、导出编排
│   ├── types.ts                 全局类型
│   ├── styles.css               全部样式（CSS 变量驱动主题）
│   ├── components/
│   │   ├── Sidebar.tsx          导航 + 标签云 + 快捷操作
│   │   ├── NoteList.tsx         列表 + 搜索框 + 排序 + 高亮
│   │   ├── EditorPane.tsx       标题 / 工具栏 / 编辑器 / 预览
│   │   ├── BacklinkPanel.tsx    反向链接 + 出链
│   │   ├── Dialogs.tsx          设置 / 统计 / 模板 / 快捷键 / 回收站 / 随机回顾
│   │   ├── Views.tsx            关系图谱（力导向）+ 待办看板
│   │   └── PrintView.tsx        PDF 打印视图
│   └── lib/
│       ├── api.ts               存储抽象 + 浏览器降级实现
│       ├── note.ts              front-matter 解析/序列化、摘要、字数、标签、链接、待办解析
│       ├── markdown.ts          自研 Markdown 渲染器 + 语法高亮
│       ├── search.ts            查询解析、加权搜索、高亮切分
│       ├── export.ts            Markdown / docx / 打印 HTML
│       ├── zip.ts               零依赖 ZIP（CRC32 + deflate-raw）
│       ├── templates.ts         笔记模板
│       └── date.ts              日期格式化
├── scripts/build-portable.mjs   便携版打包（复制运行时 + 内置 zip）
├── dist/                        前端构建产物
└── build/                       打包输出（zip + 解压目录）
```

---

## 四、数据模型

### 4.1 笔记实体

```ts
interface Note {
  id: string        // 生成规则：Date.now().toString(36) + 随机 6 位
  title: string
  content: string   // Markdown 正文（不含 front-matter）
  tags: string[]
  created: string   // ISO 时间
  updated: string
  pinned: boolean
  favorite: boolean
  type: 'note' | 'daily'
}
```

### 4.2 落盘格式

一篇笔记 = 一个 `.md` 文件，文件名即 `<id>.md`：

```markdown
---
id: m8k2x1-a3b9c
title: 2026-09-08 星期一
tags: [日志, 复盘]
created: 2026-09-08T12:00:00.000Z
updated: 2026-09-08T12:30:00.000Z
pinned: false
favorite: true
type: daily
---

# 正文开始
```

设计取舍：**正文与元数据同文件**，好处是单文件即可完整迁移、用任何编辑器都能看；代价是解析需要读全文。用 `index.json` 缓存 mtime+size 解决性能问题。

### 4.3 索引缓存

`index.json` 结构：

```json
{
  "m8k2x1-a3b9c": {
    "sig": "1757328000000|2048",
    "meta": { "id": "...", "title": "...", "tags": [], "updated": "...", "excerpt": "...", "words": 320 }
  }
}
```

启动时读目录 `stat`，只有 `mtimeMs|size` 与缓存不一致的文件才真正读取解析 → 启动时间与"变动文件数"成正比，而非笔记总数。

### 4.4 设置

`settings.json`：

```ts
{
  theme: 'light' | 'dark'
  fontSize: number          // 13~20
  storagePath: string       // 空 = 默认「文档\Notekabi」
  sortBy: 'updated' | 'created' | 'title'
  previewMode: 'edit' | 'split' | 'preview'
  focusMode: boolean
  dailyTemplate: string
}
```

---

## 五、关键流程

### 5.1 写入流程（防崩溃）

```
用户输入
  ↓ 0.8s debounce
updateNote() → 更新 React state（界面立即响应）
  ↓
scheduleSave() → pendingRef 暂存
  ↓
api.writeNote(note)
  ↓ 主进程
  ├─ archiveHistory()  旧文件复制到 backups/<id>/<timestamp>.md（保留最近 5 份）
  └─ atomicWrite()     写 <file>.tmp → rename 覆盖目标文件
```

关键点：**先更新 UI 再落盘**（乐观更新，输入零延迟）；**tmp + rename** 保证不会写出半个文件；**历史归档**保证误操作可回溯。

### 5.2 启动流程

```
app ready
  → 读取 settings.json（拿 storagePath）
  → ensureStorageTree()  确保 notes/attachments/trash/backups 存在
  → createWindow()       加载 dist/index.html
渲染进程
  → api.listNotes()      主进程扫描目录 + index.json 缓存 → 返回元数据列表（毫秒级）
  → 分批并发（40/批）读取正文
  → 首次使用写入「欢迎笔记」
  → 渲染
```

### 5.3 搜索流程

```
输入 query
  → parseQuery：拆出 terms[] 与 tags[]（支持 tag: / # / "短语"）
  → 遍历笔记：
      标签必须全部命中
      title 命中 +10 / 标签命中 +6 / 正文命中次数（上限 8）
  → 按分数排序，同分按更新时间
  → 生成 snippet（命中词周围 90 字）
  → 列表与预览中用 <mark> 高亮
```

### 5.4 导出流程

| 目标 | 路径 |
| --- | --- |
| Markdown（单篇） | `noteToMarkdown()` → `api.saveFile()` → 另存为对话框 |
| Markdown（全部） | 每篇一个 `.md` → `makeZip()` → `api.saveBytes()` |
| Word | `renderMarkdown()` → HTML → `DOMParser` → OOXML runs → `makeZip()`（4 个 XML 部件）→ 另存为 `.docx` |
| PDF | `buildPrintHtml()` → 全屏打印视图 → `webContents.printToPDF()` → 另存为 |

**docx 生成要点**：OOXML 最小可用集 = `[Content_Types].xml` + `_rels/.rels` + `word/document.xml` + `word/styles.xml`；`makeZip` 用 `CompressionStream('deflate-raw')`（浏览器/Chromium 内置），不可用时降级为 store 模式。

---

## 六、性能与安全

### 性能

| 关注点 | 措施 |
| --- | --- |
| 启动速度 | index.json 增量解析；正文分批并发读取；首屏骨架屏 |
| 输入流畅 | 受控组件 + 乐观更新，落盘在 debounce 后异步进行 |
| 大列表 | 列表项只渲染标题+摘要；图谱节点上限 120 |
| 图谱布局 | O(n²) 力导向，260 次迭代一次性计算后静态渲染 |
| 搜索 | 内存线性扫描，避免 IPC 往返 |

### 安全

- `contextIsolation: true` + `nodeIntegration: false`，渲染进程无 Node 权限
- 只通过 `preload` 暴露白名单 API，不暴露 `fs` 本身
- 所有 Markdown 内容先 HTML 转义再生成标签，阻断脚本注入
- CSP meta 限制资源来源（self + data/file/blob 图片）
- 外链用系统浏览器打开（`setWindowOpenHandler` 拦截）
- 删除即移入 `trash/`，且保留 5 个历史版本

---

## 七、分发方案

`npm run dist` 产出 `build/工作笔记-v1.0.0-Windows-x64-便携版.zip`：

1. 复制 `node_modules/electron/dist`（Electron 官方发布的就是免安装绿色版）
2. 剔除 `default_app.asar` 与非中英文语言包
3. 写入 `resources/app/`：`main.cjs` + `preload.cjs` + `dist/`
4. `electron.exe` 重命名为 `工作笔记.exe`
5. 附「使用说明.txt」，并用内置 zip 打包器压缩

用户侧：解压 → 双击 → 运行。无注册表写入、无安装器、无运行时依赖（Chromium 已随包）。

体积参考：压缩包约 70~90 MB（Electron 运行时占绝大部分，应用自身代码 < 1 MB）。

---

## 八、后续扩展点

| 方向 | 改动范围 |
| --- | --- |
| 接云同步（WebDAV / S3） | 新增 `src/lib/sync.ts`，复用 `api` 接口 |
| 换成 SQLite 存储 | 替换 `electron/main.cjs` 的读写实现 + `api.ts` |
| 移动端 | 复用 `src/lib/*`，`api.ts` 增加 IndexedDB/原生桥接实现 |
| 富文本块编辑 | 替换 `EditorPane`，其余层不变 |
| 插件系统 | 在 `api` 之上暴露事件总线（当前未做，避免过度设计） |
