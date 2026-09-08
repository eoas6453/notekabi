import { useMemo } from 'react'
import type { Note } from '../types'
import { formatRelative } from '../lib/date'
import { highlightParts } from '../lib/search'
import { makeExcerpt } from '../lib/note'

export interface ListItem {
  note: Note
  terms: string[]
  snippet?: string
}

interface Props {
  items: ListItem[]
  currentId: string | null
  onOpen: (id: string) => void
  query: string
  onQuery: (q: string) => void
  sortBy: string
  onSort: (s: string) => void
  activeTags: string[]
  onClearTag: (t: string) => void
  onClearAll: () => void
  searchRef: React.RefObject<HTMLInputElement>
  group: boolean
  emptyText: string
  /** 列表呈现形式：行式列表 或 边上的卡片网格 */
  mode?: 'list' | 'cards'
}

/** 高亮文本片段 */
function HL({ text, terms }: { text: string; terms: string[] }) {
  const parts = useMemo(() => highlightParts(text, terms), [text, terms.join('|')])
  return (
    <>
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  )
}

export default function NoteList(p: Props) {
  const grouped = useMemo(() => {
    if (!p.group || p.query) return null
    const map = new Map<string, ListItem[]>()
    for (const it of p.items) {
      const d = new Date(it.note.updated)
      const today = new Date()
      const y = new Date(Date.now() - 86400000)
      const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
      const key = same(d, today)
        ? '今天'
        : same(d, y)
          ? '昨天'
          : d.getFullYear() === today.getFullYear()
            ? `${d.getMonth() + 1}月`
            : `${d.getFullYear()}年`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(it)
    }
    return [...map.entries()]
  }, [p.items, p.group, p.query])

  const renderItem = (it: ListItem) => {
    const n = it.note
    const active = n.id === p.currentId
    return (
      <div key={n.id} className={`note-item ${active ? 'active' : ''}`} onClick={() => p.onOpen(n.id)}>
        <div className="note-item-top">
          <div className="note-item-title">
            <HL text={n.title || '未命名笔记'} terms={it.terms} />
          </div>
          <div className="note-item-date">{formatRelative(n.updated)}</div>
        </div>
        <div className="note-item-excerpt">
          <HL text={it.snippet || makeExcerpt(n.content, 100) || '空白笔记'} terms={it.terms} />
        </div>
        {(n.tags.length > 0 || n.pinned || n.favorite) && (
          <div className="note-item-foot">
            {n.pinned && <span className="mini-flag" title="置顶">📌</span>}
            {n.favorite && <span className="mini-flag" title="收藏">⭐</span>}
            {n.tags.slice(0, 4).map((t) => (
              <span key={t} className="mini-tag">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  /** 卡片形式：笔记以网格卡片排布在侧边 */
  const renderCard = (it: ListItem) => {
    const n = it.note
    const active = n.id === p.currentId
    return (
      <div key={n.id} className={`note-card ${active ? 'active' : ''}`} onClick={() => p.onOpen(n.id)}>
        <div className="note-card-top">
          <div className="note-card-title">
            <HL text={n.title || '未命名笔记'} terms={it.terms} />
          </div>
          <div className="note-card-date">{formatRelative(n.updated)}</div>
        </div>
        <div className="note-card-excerpt">
          <HL text={it.snippet || makeExcerpt(n.content, 140) || '空白笔记'} terms={it.terms} />
        </div>
        {(n.tags.length > 0 || n.pinned || n.favorite) && (
          <div className="note-card-foot">
            {n.pinned && <span className="mini-flag" title="置顶">📌</span>}
            {n.favorite && <span className="mini-flag" title="收藏">⭐</span>}
            {n.tags.slice(0, 4).map((t) => (
              <span key={t} className="mini-tag">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  const isCards = p.mode === 'cards'

  return (
    <div className={`list-pane ${isCards ? 'cards' : ''}`}>
      <div className="list-head">
        <div className="search-box">
          <span className="ico">🔍</span>
          <input
            ref={p.searchRef}
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            placeholder="搜索笔记（Ctrl+K，支持 tag:工作）"
          />
          {p.query && (
            <button className="clear" onClick={() => p.onQuery('')} title="清空">
              ✕
            </button>
          )}
        </div>
        <div className="list-toolbar">
          <select value={p.sortBy} onChange={(e) => p.onSort(e.target.value)}>
            <option value="updated">按更新时间</option>
            <option value="created">按创建时间</option>
            <option value="title">按标题</option>
          </select>
          <span className="spacer" />
          <span>{p.items.length} 篇</span>
        </div>
      </div>

      {p.activeTags.length > 0 && (
        <div className="active-filters">
          {p.activeTags.map((t) => (
            <button key={t} className="tag-chip active" onClick={() => p.onClearTag(t)}>
              #{t} ✕
            </button>
          ))}
          {p.activeTags.length > 1 && (
            <button className="tag-chip" onClick={p.onClearAll}>
              清除全部
            </button>
          )}
        </div>
      )}

      <div className="note-list">
        {p.items.length === 0 && <div className="empty-hint">{p.emptyText}</div>}
        {isCards ? (
          <div className="note-cards">
            {p.items.map(renderCard)}
          </div>
        ) : grouped ? (
          grouped.map(([label, list]) => (
            <div key={label}>
              <div className="group-label">{label}</div>
              {list.map(renderItem)}
            </div>
          ))
        ) : (
          p.items.map(renderItem)
        )}
      </div>
    </div>
  )
}
