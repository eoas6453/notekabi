import { useEffect, useMemo, useRef, useState } from 'react'
import type { Note } from '../types'
import { extractLinks, extractTasks } from '../lib/note'

// ================================================================ 关系图谱
interface Node {
  id: string
  title: string
  x: number
  y: number
  deg: number
}

/** 简易力导向布局：斥力 + 连线引力 + 边界约束 */
function forceLayout(nodes: Node[], links: { s: number; t: number }[], w: number, h: number) {
  const N = nodes.length
  if (!N) return
  const r = Math.min(w, h) * 0.32
  nodes.forEach((n, i) => {
    const a = (i / N) * Math.PI * 2
    n.x = w / 2 + Math.cos(a) * r
    n.y = h / 2 + Math.sin(a) * r
  })
  const k = Math.sqrt((w * h) / Math.max(N, 1)) * 0.55
  for (let it = 0; it < 260; it++) {
    const disp = nodes.map(() => ({ x: 0, y: 0 }))
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let dx = nodes[i].x - nodes[j].x
        let dy = nodes[i].y - nodes[j].y
        let d = Math.hypot(dx, dy) || 0.01
        const f = (k * k) / d
        disp[i].x += (dx / d) * f
        disp[i].y += (dy / d) * f
        disp[j].x -= (dx / d) * f
        disp[j].y -= (dy / d) * f
      }
    }
    for (const l of links) {
      const s = nodes[l.s]
      const t = nodes[l.t]
      let dx = t.x - s.x
      let dy = t.y - s.y
      let d = Math.hypot(dx, dy) || 0.01
      const f = (d * d) / k
      const fx = ((dx / d) * f) / 2
      const fy = ((dy / d) * f) / 2
      disp[l.s].x += fx
      disp[l.s].y += fy
      disp[l.t].x -= fx
      disp[l.t].y -= fy
    }
    const temp = Math.max(0.6, 18 * (1 - it / 260))
    nodes.forEach((n, i) => {
      const d = Math.hypot(disp[i].x, disp[i].y) || 0.01
      n.x += (disp[i].x / d) * Math.min(d, temp)
      n.y += (disp[i].y / d) * Math.min(d, temp)
      n.x = Math.max(46, Math.min(w - 46, n.x))
      n.y = Math.max(30, Math.min(h - 30, n.y))
    })
  }
}

export function GraphView({
  notes,
  currentId,
  onOpen,
}: {
  notes: Note[]
  currentId: string | null
  onOpen: (id: string) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 900, h: 600 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    // 尺寸变化做防抖：力导向计算较重，避免拖动窗口时反复重排
    let t: number | undefined
    const ro = new ResizeObserver(() => {
      if (t) clearTimeout(t)
      t = window.setTimeout(() => setSize({ w: el.clientWidth, h: el.clientHeight }), 250)
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => {
      ro.disconnect()
      if (t) clearTimeout(t)
    }
  }, [])

  const { nodes, links } = useMemo(() => {
    const titleToId = new Map<string, string>()
    notes.forEach((n) => titleToId.set(n.title.trim().toLowerCase(), n.id))

    const deg = new Map<string, number>()
    const raw: { s: string; t: string }[] = []
    notes.forEach((n) => {
      for (const link of extractLinks(n.content)) {
        const targetId = titleToId.get(link.trim().toLowerCase())
        if (targetId && targetId !== n.id) {
          raw.push({ s: n.id, t: targetId })
          deg.set(n.id, (deg.get(n.id) || 0) + 1)
          deg.set(targetId, (deg.get(targetId) || 0) + 1)
        }
      }
    })

    // 节点过多时只保留最相关的部分，保证可读性与性能
    let keep = new Set(deg.keys())
    if (currentId) keep.add(currentId)
    if (keep.size > 120) {
      keep = new Set([...deg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 120).map(([k]) => k))
      if (currentId) keep.add(currentId)
    }

    const list = notes.filter((n) => keep.has(n.id)) || []
    const nodes: Node[] = list.map((n) => ({ id: n.id, title: n.title, x: 0, y: 0, deg: deg.get(n.id) || 0 }))
    const index = new Map(nodes.map((n, i) => [n.id, i]))
    const links = raw
      .filter((l) => index.has(l.s) && index.has(l.t))
      .map((l) => ({ s: index.get(l.s)!, t: index.get(l.t)! }))
    return { nodes, links }
  }, [notes, currentId])

  const positioned = useMemo(() => {
    if (!nodes.length) return { nodes: [], links: [] }
    const copy = nodes.map((n) => ({ ...n }))
    forceLayout(copy, links, size.w, size.h)
    return { nodes: copy, links }
  }, [nodes, links, size.w, size.h])

  const neighbors = useMemo(() => {
    const set = new Set<string>()
    if (!currentId) return set
    positioned.links.forEach((l) => {
      const s = positioned.nodes[l.s]
      const t = positioned.nodes[l.t]
      if (s.id === currentId) set.add(t.id)
      if (t.id === currentId) set.add(s.id)
    })
    return set
  }, [positioned, currentId])

  return (
    <div className="graph-wrap">
      <div className="editor-head" style={{ padding: '12px 24px' }}>
        <div className="editor-meta" style={{ marginTop: 0 }}>
          <span>关系图谱</span>
          <span>·</span>
          <span>{positioned.nodes.length} 个节点</span>
          <span>·</span>
          <span>{positioned.links.length} 条链接</span>
          <span style={{ marginLeft: 'auto' }}>点击节点打开笔记，紫色为当前笔记及其关联</span>
        </div>
      </div>
      <div className="graph-canvas" ref={wrapRef}>
        <svg viewBox={`0 0 ${size.w} ${size.h}`}>
          {positioned.links.map((l, i) => {
            const s = positioned.nodes[l.s]
            const t = positioned.nodes[l.t]
            const active = currentId && (s.id === currentId || t.id === currentId)
            return (
              <line
                key={i}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={active ? 'var(--accent)' : 'var(--border-strong)'}
                strokeWidth={active ? 1.8 : 1}
                opacity={active ? 0.9 : 0.5}
              />
            )
          })}
          {positioned.nodes.map((n) => {
            const isCur = n.id === currentId
            const near = neighbors.has(n.id)
            const r = Math.min(16, 5 + n.deg * 1.6)
            return (
              <g key={n.id} className="graph-node" onClick={() => onOpen(n.id)}>
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={isCur ? r + 3 : r}
                  fill={isCur ? 'var(--accent)' : near ? 'var(--accent-soft)' : 'var(--bg-hover)'}
                  stroke={isCur || near ? 'var(--accent)' : 'var(--border-strong)'}
                  strokeWidth={1.5}
                />
                <text x={n.x} y={n.y + r + 12} textAnchor="middle" fill={isCur ? 'var(--accent)' : undefined}>
                  {n.title.length > 12 ? n.title.slice(0, 12) + '…' : n.title}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ================================================================ 待办看板
export function KanbanView({
  notes,
  onOpen,
  onToggle,
}: {
  notes: Note[]
  onOpen: (id: string) => void
  onToggle: (noteId: string, line: number) => void
}) {
  const groups = useMemo(() => {
    return notes
      .map((n) => ({ note: n, tasks: extractTasks(n.content) }))
      .filter((g) => g.tasks.length > 0)
  }, [notes])

  const total = groups.reduce((s, g) => s + g.tasks.length, 0)
  const done = groups.reduce((s, g) => s + g.tasks.filter((t) => t.done).length, 0)

  return (
    <div className="graph-wrap">
      <div className="editor-head" style={{ padding: '12px 24px' }}>
        <div className="editor-meta" style={{ marginTop: 0 }}>
          <span>待办看板</span>
          <span>·</span>
          <span>
            已完成 {done} / {total}
          </span>
          <span style={{ marginLeft: 'auto' }}>汇总所有笔记中的 - [ ] 待办项，可直接勾选</span>
        </div>
      </div>
      <div className="kanban">
        {groups.length === 0 && (
          <div className="empty-hint">
            还没有待办项
            <br />
            在笔记中用 <code>- [ ] 任务内容</code> 创建
          </div>
        )}
        {groups.map((g) => {
          const undone = g.tasks.filter((t) => !t.done).length
          return (
            <div className="kanban-group" key={g.note.id}>
              <h4 onClick={() => onOpen(g.note.id)}>
                {g.note.title}（{g.tasks.length - undone}/{g.tasks.length}）
              </h4>
              {g.tasks.map((t) => (
                <div key={t.line} className={`task-line ${t.done ? 'done' : ''}`}>
                  <input type="checkbox" checked={t.done} onChange={() => onToggle(g.note.id, t.line)} />
                  <span>{t.text}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
