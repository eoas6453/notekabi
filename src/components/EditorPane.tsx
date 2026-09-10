import { useEffect, useMemo, useRef } from 'react'
import type { Note, Backlink } from '../types'
import { renderMarkdown } from '../lib/markdown'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/date'
import { countWords } from '../lib/note'
import BacklinkPanel from './BacklinkPanel'

export type EditorMode = 'edit' | 'split' | 'preview'

interface Props {
  note: Note
  mode: EditorMode
  onMode: (m: EditorMode) => void
  onChange: (patch: Partial<Note>) => void
  onTogglePin: () => void
  onToggleFav: () => void
  onDelete: () => void
  onExport: () => void
  onFocusToggle: () => void
  focusMode: boolean
  knownTitles: Set<string>
  highlightTerms: string[]
  resolveAsset: (src: string) => string
  backlinks: Backlink[]
  outgoing: { title: string; exists: boolean }[]
  onOpenNote: (id: string) => void
  onOpenTitle: (title: string) => void
  onAddTag: (t: string) => void
  onRemoveTag: (t: string) => void
  /** 当前笔记所在文件夹名（空 = 未归类） */
  folderName?: string
  /** 点击文件夹徽标：打开「移动到文件夹」 */
  onMoveToFolder?: () => void
  showBacklinks: boolean
  onToggleBacklinks: () => void
  /** 是否刚由用户新建（触发自动聚焦正文 + 滚到顶 + 高亮标题） */
  freshlyCreated?: boolean
  /** EditorPane 消费完 freshlyCreated 后回调，App 用来清掉标记 */
  onFreshlyConsumed?: () => void
}

/** 在光标处插入文本（或包裹选中内容） */
function surround(ta: HTMLTextAreaElement, before: string, after = before, placeholder = '') {
  const { selectionStart: s, selectionEnd: e, value } = ta
  const sel = value.slice(s, e) || placeholder
  const next = value.slice(0, s) + before + sel + after + value.slice(e)
  const caret = s + before.length + sel.length
  return { next, caret }
}

export default function EditorPane(p: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const previewWrapRef = useRef<HTMLDivElement>(null)
  const lastNoteIdRef = useRef(p.note.id)

  const apply = (fn: (ta: HTMLTextAreaElement) => { next: string; caret: number }) => {
    const ta = taRef.current
    if (!ta) return
    const { next, caret } = fn(ta)
    p.onChange({ content: next })
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(caret, caret)
    })
  }

  // 切笔记 → 滚到顶 + 焦点回到正文；新建笔记 → 先聚焦标题，便于立即改名
  useEffect(() => {
    const isNew = lastNoteIdRef.current !== p.note.id
    lastNoteIdRef.current = p.note.id
    if (!isNew) return
    if (previewWrapRef.current) previewWrapRef.current.scrollTop = 0
    if (p.freshlyCreated) {
      // 新建：先聚焦标题，给个选中文本的状态（如果没标题就不选）
      requestAnimationFrame(() => {
        const t = titleRef.current
        if (t) {
          t.focus()
          if (t.value) t.select()
        }
      })
    } else {
      requestAnimationFrame(() => {
        const ta = taRef.current
        if (ta) {
          ta.focus()
          ta.setSelectionRange(ta.value.length, ta.value.length)
          ta.scrollTop = 0
        }
      })
    }
    if (p.freshlyCreated) p.onFreshlyConsumed?.()
  }, [p.note.id, p.freshlyCreated, p.onFreshlyConsumed])

  const linePrefix = (prefix: string) =>
    apply((ta) => {
      const { value, selectionStart: s } = ta
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const next = value.slice(0, lineStart) + prefix + value.slice(lineStart)
      return { next, caret: s + prefix.length }
    })

  const tools: { icon: string; title: string; run: () => void }[] = [
    { icon: 'B', title: '加粗 (Ctrl+B)', run: () => apply((ta) => surround(ta, '**', '**', '粗体')) },
    { icon: 'I', title: '斜体 (Ctrl+I)', run: () => apply((ta) => surround(ta, '*', '*', '斜体')) },
    { icon: 'S', title: '删除线', run: () => apply((ta) => surround(ta, '~~', '~~', '删除线')) },
    { icon: 'H', title: '标题', run: () => linePrefix('## ') },
    { icon: '•', title: '无序列表', run: () => linePrefix('- ') },
    { icon: '☑', title: '待办项', run: () => linePrefix('- [ ] ') },
    { icon: '❝', title: '引用', run: () => linePrefix('> ') },
    { icon: '</>', title: '代码块', run: () => apply((ta) => surround(ta, '```\n', '\n```', '代码')) },
    { icon: '🔗', title: '链接', run: () => apply((ta) => surround(ta, '[', '](https://)', '链接文字')) },
    { icon: '🔗+', title: '双向链接 [[', run: () => apply((ta) => surround(ta, '[[', ']]', '笔记标题')) },
    {
      icon: '⊞',
      title: '表格',
      run: () =>
        apply((ta) => ({
          next: ta.value.slice(0, ta.selectionStart) + '\n| 项目 | 内容 |\n| --- | --- |\n|  |  |\n' + ta.value.slice(ta.selectionEnd),
          caret: ta.selectionStart + 16,
        })),
    },
    { icon: '🖼', title: '插入图片', run: () => fileRef.current?.click() },
  ]

  /** 粘贴 / 拖入图片 → 保存为附件并插入引用 */
  const handleFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue
      const dataURL = await new Promise<string>((res) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.readAsDataURL(f)
      })
      const name = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`
      try {
        const { relPath } = await api.writeAttachment({ name, dataURL })
        apply((ta) => ({
          next: ta.value.slice(0, ta.selectionStart) + `\n![${f.name || name}](${relPath})\n` + ta.value.slice(ta.selectionEnd),
          caret: ta.selectionStart,
        }))
      } catch (e) {
        console.error(e)
      }
    }
  }

  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith('image/'))
    if (!imgs.length) return
    e.preventDefault()
    handleFiles(imgs.map((i) => i.getAsFile()).filter(Boolean) as File[])
  }

  const stats = useMemo(() => {
    const text = p.note.content || ''
    const lines = text === '' ? 0 : text.split('\n').length
    // 段：以一个或多个空行分开的连续非空行
    const paragraphs = text.split(/\r?\n\s*\r?\n/).filter((b) => b.trim().length > 0).length || (text.trim() ? 1 : 0)
    return { words: countWords(text), lines, paragraphs }
  }, [p.note.content])

  return (
    <>
      <div className="main-pane">
        <div className="editor-head">
          <div className="editor-title-row">
            <input
              ref={titleRef}
              className="title-input"
              value={p.note.title}
              placeholder="无标题笔记"
              onChange={(e) => p.onChange({ title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const ta = taRef.current
                  if (ta) {
                    ta.focus()
                    ta.setSelectionRange(ta.value.length, ta.value.length)
                  }
                }
              }}
            />
            <button
              className={`icon-btn ${p.note.pinned ? 'active' : ''}`}
              onClick={p.onTogglePin}
              title={p.note.pinned ? '取消置顶' : '置顶'}
            >
              📌
            </button>
            <button
              className={`icon-btn ${p.note.favorite ? 'active' : ''}`}
              onClick={p.onToggleFav}
              title={p.note.favorite ? '取消收藏' : '收藏'}
            >
              ⭐
            </button>
            <button className="icon-btn" onClick={p.onExport} title="导出本篇">
              ⤓
            </button>
            <button className="icon-btn danger" onClick={p.onDelete} title="删除 (Ctrl+Delete)">
              🗑
            </button>
          </div>

          <div className="editor-meta">
            <button
              className={`folder-chip ${p.folderName ? '' : 'empty'}`}
              onClick={p.onMoveToFolder}
              title="点击把这篇笔记移动到别的文件夹"
            >
              {p.folderName ? `📁 ${p.folderName}` : '📄 未归类'}
              <span className="chip-act">▾</span>
            </button>
            <div className="tag-editor">
              {p.note.tags.map((t) => (
                <span key={t} className="tag-pill">
                  #{t}
                  <button onClick={() => p.onRemoveTag(t)} title="移除标签">
                    ✕
                  </button>
                </span>
              ))}
              <input
                className="tag-input"
                placeholder="+ 标签"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                    e.preventDefault()
                    const v = (e.target as HTMLInputElement).value.trim()
                    if (v) p.onAddTag(v.replace(/^#/, ''))
                    ;(e.target as HTMLInputElement).value = ''
                  }
                }}
              />
            </div>
            <span style={{ marginLeft: 'auto' }}>创建 {formatDateTime(p.note.created)}</span>
            <span>·</span>
            <span>更新 {formatDateTime(p.note.updated)}</span>
            <span>·</span>
            <span>{stats.words} 字 · {stats.lines} 行 · {stats.paragraphs} 段</span>
          </div>
        </div>

        <div className="editor-toolbar">
          {tools.map((t) => (
            <button key={t.title} className="icon-btn" title={t.title} onClick={t.run}>
              {t.icon}
            </button>
          ))}
          <span className="tool-sep" />
          <span className="spacer" />
          <div className="seg">
            <button className={p.mode === 'edit' ? 'active' : ''} onClick={() => p.onMode('edit')}>
              编辑
            </button>
            <button className={p.mode === 'split' ? 'active' : ''} onClick={() => p.onMode('split')}>
              分屏
            </button>
            <button className={p.mode === 'preview' ? 'active' : ''} onClick={() => p.onMode('preview')}>
              预览
            </button>
          </div>
          <button
            className={`icon-btn ${p.showBacklinks ? 'active' : ''}`}
            onClick={p.onToggleBacklinks}
            title="反向链接面板"
          >
            🔗
          </button>
          <button
            className={`icon-btn ${p.focusMode ? 'active' : ''}`}
            onClick={p.onFocusToggle}
            title="专注模式 (Ctrl+Shift+F)"
          >
            ⛶
          </button>
        </div>

        <div className={`editor-body mode-${p.mode}`}>
          <div className="editor-input-wrap">
            <textarea
              ref={taRef}
              className="md-input"
              value={p.note.content}
              placeholder={'開始记录…\n\n支持 Markdown：# 标题、**粗体**、- 列表、- [ ] 待办、| 表格 |、```代码块```\n用 [[标题]] 建立双向链接，用 #标签 归类'}
              onChange={(e) => p.onChange({ content: e.target.value })}
              onPaste={onPaste}
              onDrop={(e) => {
                if (e.dataTransfer.files.length) {
                  e.preventDefault()
                  handleFiles(e.dataTransfer.files)
                }
              }}
              onKeyDown={(e) => {
                // Tab 缩进 / 反向缩进
                if (e.key === 'Tab') {
                  e.preventDefault()
                  const ta = taRef.current!
                  const { selectionStart: s, selectionEnd: end, value } = ta
                  if (s !== end && value.slice(s, end).includes('\n')) {
                    // 多行选中：整体缩进/反缩进
                    if (e.shiftKey) {
                      apply((t) => {
                        const start = t.value.lastIndexOf('\n', s - 1) + 1
                        const block = t.value.slice(start, end)
                        const cleaned = block.replace(/^( {2}|\t)/gm, '')
                        return { next: t.value.slice(0, start) + cleaned + t.value.slice(end), caret: s }
                      })
                    } else {
                      apply((t) => {
                        const start = t.value.lastIndexOf('\n', s - 1) + 1
                        const block = t.value.slice(start, end)
                        const padded = block.replace(/^/gm, '  ')
                        return { next: t.value.slice(0, start) + padded + t.value.slice(end), caret: s + 2 }
                      })
                    }
                  } else if (e.shiftKey) {
                    apply((t) => {
                      const lineStart = t.value.lastIndexOf('\n', s - 1) + 1
                      if (t.value.slice(lineStart, s).startsWith('  ')) {
                        return { next: t.value.slice(0, lineStart) + t.value.slice(lineStart + 2), caret: s - 2 }
                      }
                      return { next: t.value, caret: s }
                    })
                  } else {
                    apply((t) => surround(t, '  ', '', ''))
                  }
                  return
                }
                // Backspace 智能清空列表前缀
                if (e.key === 'Backspace') {
                  const ta = taRef.current!
                  if (ta.selectionStart !== ta.selectionEnd) return // 让原生行为处理选区
                  const { selectionStart: s, value } = ta
                  const lineStart = value.lastIndexOf('\n', s - 1) + 1
                  const lineBeforeCaret = value.slice(lineStart, s)
                  const m = /^( {0,4})([-*+] |[0-9]+\. |- \[[ x]\] |> |##+ )?$/.exec(lineBeforeCaret)
                  if (m && m[2] && lineBeforeCaret === (m[1] || '') + m[2]) {
                    e.preventDefault()
                    apply((t) => {
                      const ls = t.value.lastIndexOf('\n', s - 1) + 1
                      return { next: t.value.slice(0, ls) + t.value.slice(ls + m[1].length + m[2].length), caret: s - (m[1].length + m[2].length) }
                    })
                  }
                }
                // Enter：列表项自动延续
                if (e.key === 'Enter' && !e.shiftKey) {
                  const ta = taRef.current!
                  const { selectionStart: s, value } = ta
                  const lineStart = value.lastIndexOf('\n', s - 1) + 1
                  const lineBeforeCaret = value.slice(lineStart, s)
                  const lm = /^([-*+] )|([0-9]+\. )|(- \[[ x]\] )|(>+ ?)/.exec(lineBeforeCaret)
                  if (lm && (s === lineStart + lineBeforeCaret.length)) {
                    // 光标在列表前缀后 → 新行继续前缀
                    e.preventDefault()
                    const prefix = lm[0]
                    apply((t) => {
                      return { next: t.value.slice(0, s) + '\n' + prefix + t.value.slice(s), caret: s + 1 + prefix.length }
                    })
                  }
                }
              }}
            />
          </div>

          <div className="preview-wrap" ref={previewWrapRef}>
            <div
              className="md-body"
              onClick={(e) => {
                const el = (e.target as HTMLElement).closest('[data-wikilink]')
                if (el) {
                  e.preventDefault()
                  p.onOpenTitle(el.getAttribute('data-wikilink')!)
                  return
                }
                const tag = (e.target as HTMLElement).closest('[data-tag]')
                if (tag) {
                  p.onAddTag(tag.getAttribute('data-tag')!)
                  return
                }
                const copy = (e.target as HTMLElement).closest('.code-copy')
                if (copy) {
                  navigator.clipboard?.writeText(decodeURIComponent(copy.getAttribute('data-code') || ''))
                }
              }}
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(p.note.content, {
                  knownTitles: p.knownTitles,
                  highlight: p.highlightTerms,
                  resolveAsset: p.resolveAsset,
                }),
              }}
            />
          </div>

          {p.showBacklinks && (
            <BacklinkPanel
              backlinks={p.backlinks}
              outgoing={p.outgoing}
              onOpenNote={p.onOpenNote}
              onOpenTitle={p.onOpenTitle}
            />
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
    </>
  )
}
