# 工作笔记 · Notekabi

本地优先的个人工作笔记工具。快速记录、方便整理、便于回顾，完全离线运行，数据以 Markdown 文件存在你自己的电脑里。

![界面](docs/screenshot-placeholder.png)

> 三栏布局 · 深色/浅色主题 · 键盘优先 · 自动保存

---

## 一、快速开始

### 方式 A：直接用现成的便携版（推荐给普通用户）

1. 解压 `build/工作笔记-v1.0.0-Windows-x64-便携版.zip` 到任意目录
2. 双击 `工作笔记.exe`
3. 完事。无需安装、无需 Node、无需联网

### 方式 B：从源码运行（开发者）

```bash
npm install          # 安装依赖（Electron 二进制约 100MB，走国内镜像更快）
npm run dev          # 浏览器开发模式（数据存 localStorage，用于快速预览 UI）
npm start            # 启动 Electron 桌面版（需先 npm run build）
```

### 方式 C：重新打包

```bash
npm run build        # 构建前端到 dist/
npm run dist         # 产出 build/工作笔记-v1.0.0-Windows-x64-便携版.zip
```

打包脚本不使用 electron-builder，**只做目录复制 + 内置 zip 打包**，无需下载签名工具链，产出的是解压即用的绿色版。

---

## 二、数据存储

### 默认位置

```
文档\Notekabi\
├── notes\          每篇笔记一个 .md 文件
├── attachments\    粘贴的图片等附件
├── backups\        每篇笔记最近 5 个历史版本
├── trash\          回收站
├── settings.json   设置文件
└── index.json      元信息缓存（可删除，会自动重建）
```

在「设置 → 数据存储位置」可改成任意目录（推荐放到网盘目录即可实现多设备同步）。

### 文件长什么样

每篇笔记就是一个带 front-matter 的 Markdown 文件，**用任何编辑器打开都是 readable 的纯文本**：

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

# 2026-09-08 星期一

## 今日计划
- [x] 完成笔记软件原型
- [ ] 写使用文档
```

### 安全机制

- **自动保存**：停止输入 0.8 秒后自动写入磁盘，也可 `Ctrl + S` 立即保存
- **原子写入**：先写 `.tmp` 再重命名，崩溃断电也不会写出半个文件
- **历史版本**：每次保存前把旧版本归档到 `backups/<笔记ID>/`，保留最近 5 份
- **回收站**：删除的笔记先进入 `trash\`，可随时恢复

---

## 三、导入与导出

| 操作 | 位置 | 说明 |
| --- | --- | --- |
| 导入 Markdown 文件夹 | 设置 → 导入 Markdown 文件夹 | 递归扫描目录下的 `.md/.markdown/.txt`，自动识别 front-matter |
| 导出单篇 | 编辑器右上角 `⤓` | 支持 Markdown / Word / PDF |
| 导出全部 | 设置 → 导出全部 | Markdown 会打成 zip（一篇一文件），Word/PDF 合并成一个文件 |

- **Markdown**：纯文本，零损耗，可直接推到 Git 或再导入其它笔记软件
- **Word**：手写最小 OOXML 生成 `.docx`，保留标题层级、粗斜体、列表、待办、表格、代码块（等宽+灰底），WPS / Word 均可打开
- **PDF**：调用 Chromium 内置打印引擎生成，A4、带背景色，无需安装 pandoc 或打印机

图片导出说明：Markdown 导出保留 `attachments/xxx.png` 引用；Word 导出中图片以 `[图片：名称]` 占位（避免 OOXML 图片关系复杂度）；PDF 会正常渲染图片。

---

## 四、功能清单

### 核心（P0）

- 新建 / 编辑 / 删除笔记，自动保存
- Markdown 实时预览（编辑 / 分屏 / 预览 三档）
- 笔记列表，按更新时间 / 创建时间 / 标题排序，按天分组
- 全文搜索，关键词高亮，支持 `tag:工作` 与 `"精确短语"`
- 标签系统：行内 `#标签` + 顶部标签管理，点击过滤，支持多标签组合
- 每日笔记：`Ctrl + D` 自动创建/打开当天笔记
- 本地 Markdown 文件存储
- 导出 Markdown / Word / PDF
- 设置：浅色/深色主题、字号、存储路径、排序方式

### 增强（P1）

- 双向链接 `[[笔记标题]]`，右侧显示反向链接与出链（不存在的标题可一键创建）
- 笔记模板：每日笔记 / 工作日志 / 复盘 / 项目总结 / 经验卡片
- 图片粘贴（截图直接 `Ctrl+V`）、拖拽与附件管理
- 代码块语法高亮、GFM 表格、任务列表
- 收藏 / 置顶
- 数据统计：笔记数、字数、标签频率、近 14 天活跃度
- 随机回顾：随机打开一篇旧笔记

### 进阶（P2）

- 待办看板：汇总所有笔记中的 `- [ ]`，可直接勾选并回写
- 关系图谱：力导向布局的双向链接图，点击节点跳转
- 多标签组合筛选（与 / 或由点击顺序决定，全部满足）
- 导入已有 Markdown 文件夹
- 专注写作模式（隐藏侧栏与列表）
- **日历视图：月历标记工作节点与提醒**，可新建/编辑/拖拽改期、完成后打勾；今日或逾期提醒会在启动时弹提示并发系统通知；数据独立存于 `events.json`

---

## 五、快捷键

| 功能 | 快捷键 |
| --- | --- |
| 新建笔记 | `Ctrl + N` |
| 从模板新建 | `Ctrl + Shift + N` |
| 搜索 | `Ctrl + K` / `Ctrl + F` |
| 今日笔记 | `Ctrl + D` |
| 随机回顾 | `Ctrl + R` |
| 立即保存 | `Ctrl + S` |
| 编辑 / 分屏 / 预览 | `Ctrl + E` |
| 专注模式 | `Ctrl + Shift + F` |
| 加粗 / 斜体 | `Ctrl + B` / `Ctrl + I` |
| 数据统计 | `Ctrl + Shift + S` |
| 关系图谱 / 待办看板 | `Ctrl + G` / `Ctrl + Shift + K` |
| 日历视图 | `Ctrl + Shift + C` |
| 删除当前笔记 | `Ctrl + Delete` |
| 设置 | `Ctrl + ,` |
| 退出搜索 / 关闭弹窗 | `Esc` |

---

## 六、技术架构

```
Electron（主进程 + Chromium 渲染）
├── 主进程  electron/main.cjs     本地文件读写、对话框、打印 PDF（纯 Node 内置模块）
├── 桥接    electron/preload.cjs  contextBridge 暴露受控 API
└── 渲染层  React 18 + TypeScript + Vite
            Markdown 渲染、搜索、docx 生成、zip 打包 —— 全部自研，零第三方运行时依赖
```

**为什么不用第三方库**：运行时依赖只有 `react` + `react-dom`。Markdown 渲染、语法高亮、全文搜索、docx/zip 生成均为自研实现，好处是包体小（前端产物 208 KB）、启动快（冷启动 < 1s）、无供应链风险、无网络依赖。

详细设计见 [ARCHITECTURE.md](./ARCHITECTURE.md)，产品需求见 [PRD.md](./PRD.md)。

---

## 七、目录结构

```
Notekabi/
├── electron/
│   ├── main.cjs              主进程：窗口、IPC、文件读写、历史版本
│   └── preload.cjs           安全桥接
├── src/
│   ├── App.tsx               状态中枢与业务逻辑
│   ├── components/           UI 组件（侧栏 / 列表 / 编辑器 / 弹窗 / 图谱 / 看板）
│   ├── lib/
│   │   ├── api.ts            存储抽象（Electron / 浏览器双实现）
│   │   ├── markdown.ts       自研 Markdown 渲染器
│   │   ├── search.ts         全文搜索与高亮
│   │   ├── note.ts           front-matter 解析与笔记工具
│   │   ├── export.ts         Markdown / Word / PDF 导出
│   │   ├── zip.ts            零依赖 ZIP 打包（用于 docx）
│   │   └── templates.ts      笔记模板
│   └── styles.css
├── scripts/build-portable.mjs  便携版打包脚本
└── dist/                     前端构建产物
```

---

## 八、自检模式（冒烟测试）

设置环境变量后启动程序，会自动跑一遍「界面渲染 → 新建笔记 → 模拟输入 → 自动保存落盘 → 搜索高亮 → 导出 Word/Markdown/PDF」，把结果写入 `selftest-result.json` 后自动退出：

```bash
# Windows（PowerShell）
$env:NOTEKABI_SELFTEST=1; .\工作笔记.exe

# Windows（CMD）
set NOTEKABI_SELFTEST=1 && 工作笔记.exe
```

可用于打包后确认功能是否正常，无需手工点击。

---

## 九、常见问题

**Q：会不会偷偷联网？**
A：不会。软件没有任何网络请求代码，断网可正常使用。

**Q：笔记会丢失吗？**
A：三重保险：自动保存（0.8s）+ 原子写入 + 每篇保留 5 个历史版本在 `backups/`。删除也先进回收站。

**Q：能多设备同步吗？**
A：把存储目录设置到 OneDrive / 坚果云 / iCloud 的同步文件夹即可。因为一篇笔记一个 .md 文件，冲突概率极低。

**Q：为什么没有做移动端？**
A：先聚焦桌面端把核心体验打磨好。架构上渲染层与存储层已解耦，后续接移动端只需替换 `src/lib/api.ts` 的实现。

**Q：杀毒软件报毒？**
A：便携版未做代码签名，少数杀软会误报。源码完全开放可自行审查编译。

---

## 九、许可

MIT
