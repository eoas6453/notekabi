import { useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import type { CalendarEvent, EventColor, EventKind, Note } from '../types'
import {
  addMonth,
  buildMonthGrid,
  formatDayCN,
  groupEventsByDate,
  monthLabel,
  pendingReminders,
  WEEK_HEAD,
} from '../lib/calendar'

const COLOR_ORDER: EventColor[] = ['purple', 'blue', 'green', 'amber', 'red']
const COLOR_LABELS: Record<EventColor, string> = {
  purple: '紫',
  blue: '蓝',
  green: '绿',
  amber: '橙',
  red: '红',
}

interface Props {
  events: CalendarEvent[]
  notes: Note[]
  todayKey: string
  onSaveEvents: (list: CalendarEvent[]) => void
  onOpenNote: (id: string) => void
  onOpenDaily: (dateKey: string) => void
}

interface EventPatch {
  title: string
  date: string
  kind: EventKind
  color: EventColor
  noteId?: string
  noteTitle?: string
}

/** 事件编辑/新建对话框 */
function EventDialog({
  initial,
  notes,
  onSave,
  onDelete,
  onClose,
}: {
  initial: CalendarEvent
  notes: Note[]
  onSave: (p: EventPatch) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(initial.title)
  const [date, setDate] = useState(initial.date)
  const [kind, setKind] = useState<EventKind>(initial.kind)
  const [color, setColor] = useState<EventColor>(initial.color)
  const [noteId, setNoteId] = useState(initial.noteId || '')

  const noteTitle = noteId ? notes.find((n) => n.id === noteId)?.title : undefined

  const submit = () => {
    if (!title.trim()) return
    onSave({ title: title.trim(), date, kind, color, noteId: noteId || undefined, noteTitle })
  }

  return (
    <div className="dialog-mask" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">{initial.id.startsWith('new-') ? '新建节点 / 提醒' : '编辑节点'}</div>
        <div className="field">
          <span className="field-label">标题</span>
          <input
            className="text-input"
            autoFocus
            value={title}
            placeholder="例如：Q3 需求评审 / 提交版本审查"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        </div>
        <div className="field">
          <span className="field-label">日期</span>
          <input className="text-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <span className="field-label">类型</span>
          <div className="row">
            <button
              className={`btn ${kind === 'milestone' ? 'primary' : ''}`}
              onClick={() => setKind('milestone')}
            >
              工作节点
            </button>
            <button
              className={`btn ${kind === 'reminder' ? 'primary' : ''}`}
              onClick={() => setKind('reminder')}
            >
              提醒
            </button>
          </div>
        </div>
        <div className="field">
          <span className="field-label">颜色</span>
          <div className="row">
            {COLOR_ORDER.map((c) => (
              <button
                key={c}
                className={`color-dot ev-${c} ${color === c ? 'sel' : ''}`}
                title={COLOR_LABELS[c]}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">关联笔记</span>
          <select className="text-input" value={noteId} onChange={(e) => setNoteId(e.target.value)}>
            <option value="">（不关联）</option>
            {notes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </select>
        </div>
        <div className="dialog-actions">
          {onDelete && (
            <button className="btn danger" onClick={onDelete}>
              删除
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={!title.trim()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

export function CalendarView({ events, notes, todayKey, onSaveEvents, onOpenNote, onOpenDaily }: Props) {
  const now = useMemo(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  }, [])

  const [cursor, setCursor] = useState(now)
  const [selected, setSelected] = useState(todayKey)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor])
  const grouped = useMemo(() => groupEventsByDate(events), [events])
  const pending = useMemo(() => pendingReminders(events, todayKey), [events, todayKey])

  const selectedEvents = grouped.get(selected) || []
  const selectedDaily = notes.find((n) => n.type === 'daily' && n.title.startsWith(selected))

  const openNew = (kind: EventKind) => {
    setEditing({
      id: 'new-' + Date.now().toString(36),
      date: selected,
      title: '',
      kind,
      color: kind === 'reminder' ? 'amber' : 'purple',
      done: false,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    })
  }

  const saveEvent = (patch: EventPatch) => {
    if (!editing) return
    const ts = new Date().toISOString()
    let list: CalendarEvent[]
    if (editing.id.startsWith('new-')) {
      const ev: CalendarEvent = {
        id: 'ev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        date: patch.date,
        title: patch.title,
        kind: patch.kind,
        color: patch.color,
        noteId: patch.noteId,
        noteTitle: patch.noteTitle,
        done: false,
        created: ts,
        updated: ts,
      }
      list = [...events, ev]
    } else {
      list = events.map((e) =>
        e.id === editing.id
          ? { ...e, ...patch, updated: ts }
          : e,
      )
    }
    onSaveEvents(list)
    setEditing(null)
  }

  const toggleDone = (ev: CalendarEvent) => {
    onSaveEvents(events.map((e) => (e.id === ev.id ? { ...e, done: !e.done, updated: new Date().toISOString() } : e)))
  }

  const removeEvent = (ev: CalendarEvent) => {
    onSaveEvents(events.filter((e) => e.id !== ev.id))
    setEditing(null)
  }

  const onDrop = (e: DragEvent, dateKey: string) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/event-id')
    if (!id || id === 'new') return
    onSaveEvents(events.map((ev) => (ev.id === id ? { ...ev, date: dateKey, updated: new Date().toISOString() } : ev)))
  }

  const jumpToNextReminder = () => {
    if (!pending.length) return
    const d = pending[0]
    const [y, m] = d.date.split('-').map(Number)
    setCursor({ year: y, month: m - 1 })
    setSelected(d.date)
  }

  return (
    <div className="calendar-view">
      <div className="calendar-head">
        <div className="cal-nav">
          <button className="icon-btn" title="上一月" onClick={() => setCursor(addMonth(cursor.year, cursor.month, -1))}>
            ‹
          </button>
          <span className="cal-month">{monthLabel(cursor.year, cursor.month)}</span>
          <button className="icon-btn" title="下一月" onClick={() => setCursor(addMonth(cursor.year, cursor.month, 1))}>
            ›
          </button>
          <button className="btn" onClick={() => { setCursor(now); setSelected(todayKey) }}>
            今天
          </button>
        </div>
        <div className="cal-legend">
          <span><i className="ev-dot ev-purple" /> 工作节点</span>
          <span><i className="ev-dot ev-amber" /> 提醒</span>
        </div>
        <div className="cal-actions">
          {pending.length > 0 && (
            <button className="btn warn" onClick={jumpToNextReminder} title="跳到最早一条待处理提醒">
              待提醒 {pending.length}
            </button>
          )}
          <button className="btn" onClick={() => openNew('milestone')}>
            + 节点
          </button>
          <button className="btn" onClick={() => openNew('reminder')}>
            + 提醒
          </button>
        </div>
      </div>

      <div className="cal-grid">
        {WEEK_HEAD.map((w) => (
          <div key={w} className="cal-col-head">
            周{w}
          </div>
        ))}
        {grid.map((c) => {
          const evs = grouped.get(c.date) || []
          return (
            <div
              key={c.date}
              className={[
                'cal-cell',
                c.inMonth ? '' : 'out',
                c.isToday ? 'today' : '',
                c.date === selected ? 'selected' : '',
              ].join(' ')}
              onClick={() => setSelected(c.date)}
              onDoubleClick={() => openNew('milestone')}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, c.date)}
            >
              <div className="cal-day">{c.day}</div>
              <div className="cal-events">
                {evs.slice(0, 3).map((ev) => (
                  <div
                    key={ev.id}
                    className={`cal-ev ev-${ev.color} ${ev.done ? 'done' : ''}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/event-id', ev.id)}
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing(ev)
                    }}
                    title={ev.title}
                  >
                    {ev.kind === 'reminder' ? '⏰' : '◆'} {ev.title}
                  </div>
                ))}
                {evs.length > 3 && <div className="cal-more">+{evs.length - 3} 项</div>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="cal-body">
      <aside className="cal-side">
        <div className="cal-side-head">
          <div className="cal-side-date">
            {formatDayCN(selected)}
            {selected === todayKey && <span className="tag-today">今天</span>}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => onOpenDaily(selected)}>
              {selectedDaily ? '打开当日笔记' : '写当日笔记'}
            </button>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn" onClick={() => openNew('milestone')}>
              + 节点
            </button>
            <button className="btn" onClick={() => openNew('reminder')}>
              + 提醒
            </button>
          </div>
        </div>

        <div className="cal-side-list">
          {selectedDaily && (
            <div className="cal-daily" onClick={() => onOpenNote(selectedDaily.id)}>
              📅 当日笔记：{selectedDaily.title}
            </div>
          )}

          {selectedEvents.length === 0 && !selectedDaily && (
            <div className="empty-hint">这一天还没有工作节点</div>
          )}

          {selectedEvents.map((ev) => (
            <div key={ev.id} className={`cal-ev-row ${ev.done ? 'done' : ''}`}>
              <input type="checkbox" checked={ev.done} onChange={() => toggleDone(ev)} />
              <div className="cal-ev-main">
                <div className="cal-ev-title">
                  <span className={`ev-dot ev-${ev.color}`} />
                  {ev.title}
                </div>
                <div className="cal-ev-meta">
                  {ev.kind === 'reminder' ? '提醒' : '工作节点'}
                  {ev.noteTitle && (
                    <span
                      className="cal-ev-link"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (ev.noteId) onOpenNote(ev.noteId)
                      }}
                    >
                      · 关联：{ev.noteTitle}
                    </span>
                  )}
                </div>
              </div>
              <button
                className="icon-btn"
                title="编辑"
                onClick={() => setEditing(ev)}
              >
                ✎
              </button>
            </div>
          ))}
        </div>
      </aside>
      </div>

      {editing && (
        <EventDialog
          initial={editing}
          notes={notes}
          onSave={saveEvent}
          onDelete={editing.id.startsWith('new-') ? undefined : () => removeEvent(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
