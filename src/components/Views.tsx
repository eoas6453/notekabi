import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Note } from '../types'
import { extractLinks, extractTasks } from '../lib/note'

// ================================================================ 关系图谱
/**
 * 图谱节点：笔记（圆形）和标签（圆角方形）两类
 * 默认展示**全部**笔记与标签，孤立笔记也可单独关掉
 */
interface GNode {
  /** note:<id> 或 tag:<名称> */
  id: string
  kind: 'note' | 'tag'
  /** 笔记 id 或标签名 */
  refId: string
  label: string
  /** 连接数（笔记：双链+标签数；标签：使用次数） */
  deg: number
  x: number
  y: number
  vx: number
  vy: number
  /** 用户拖动后钉住，重新布局才解开 */
  fixed: boolean
  r: number
}

interface GLink {
  s: number
  t: number
  /** note-note 双链 / note-tag 归属 */
  kind: 'link' | 'tag'
}

interface Sim {
  nodes: GNode[]
  links: GLink[]
  alpha: number
}

/** 一次力导向迭代：斥力 + 连线引力 + 中心引力 */
function stepSim(sim: Sim, w: number, h: number) {
  const nodes = sim.nodes
  const N = nodes.length
  if (!N) return
  const k = Math.sqrt((w * h) / Math.max(N, 1)) * 0.5
  const alpha = sim.alpha
  const disp = nodes.map(() => ({ x: 0, y: 0 }))

  // 斥力：节点少时全量两两计算，多时随机采样，保证不卡
  if (N <= 240) {
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let dx = nodes[i].x - nodes[j].x
        let dy = nodes[i].y - nodes[j].y
        let d = Math.hypot(dx, dy)
        if (d < 0.01) {
          dx = Math.random() - 0.5
          dy = Math.random() - 0.5
          d = 0.01
        }
        const f = (k * k) / d
        disp[i].x += (dx / d) * f
        disp[i].y += (dy / d) * f
        disp[j].x -= (dx / d) * f
        disp[j].y -= (dy / d) * f
      }
    }
  } else {
    for (let i = 0; i < N; i++) {
      for (let m = 0; m < 70; m++) {
        const j = Math.floor(Math.random() * N)
        if (j === i) continue
        let dx = nodes[i].x - nodes[j].x
        let dy = nodes[i].y - nodes[j].y
        let d = Math.hypot(dx, dy) || 0.01
        const f = (k * k) / d
        disp[i].x += (dx / d) * f
        disp[i].y += (dy / d) * f
      }
    }
  }

  // 连线引力
  for (const l of sim.links) {
    const s = nodes[l.s]
    const t = nodes[l.t]
    let dx = t.x - s.x
    let dy = t.y - s.y
    let d = Math.hypot(dx, dy) || 0.01
    const strength = l.kind === 'tag' ? 0.55 : 1
    const f = ((d * d) / k) * strength
    const fx = ((dx / d) * f) / 2
    const fy = ((dy / d) * f) / 2
    disp[l.s].x += fx
    disp[l.s].y += fy
    disp[l.t].x -= fx
    disp[l.t].y -= fy
  }

  // 中心引力 + 积分
  const temp = 16 * alpha
  for (let i = 0; i < N; i++) {
    const n = nodes[i]
    if (n.fixed) continue
    disp[i].x += (w / 2 - n.x) * 0.012
    disp[i].y += (h / 2 - n.y) * 0.012
    const d = Math.hypot(disp[i].x, disp[i].y) || 0.01
    const step = Math.min(d, temp)
    n.x += (disp[i].x / d) * step
    n.y += (disp[i].y / d) * step
    const pad = n.r + 6
    n.x = Math.max(pad, Math.min(w - pad, n.x))
    n.y = Math.max(pad, Math.min(h - pad, n.y))
  }
}

export function GraphView({
  notes,
  currentId,
  onOpenNote,
  onFilterTag,
}: {
  notes: Note[]
  currentId: string | null
  /** 点击笔记节点：打开该笔记并回到编辑页 */
  onOpenNote: (id: string) => void
  /** 点击标签节点：按该标签过滤并回到列表 */
  onFilterTag: (tag: string) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 900, h: 600 })
  const [mode, setMode] = useState<'graph' | 'cloud'>('graph')
  const [showTags, setShowTags] = useState(true)
  const [showOrphans, setShowOrphans] = useState(true)
  const [q, setQ] = useState('')
  const [hover, setHover] = useState<string | null>(null)
  const [, setFrame] = useState(0)

  // 画布变换：平移 + 缩放
  const [view, setView] = useState({ tx: 0, ty: 0, k: 1 })
  const simRef = useRef<Sim | null>(null)
  const rafRef = useRef<number | null>(null)
  const dragRef = useRef<{
    mode: 'none' | 'node' | 'pan'
    idx: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    moved: boolean
  }>({ mode: 'none', idx: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false })

  /** 由笔记列表构建节点与连线（全部笔记 + 全部标签） */
  const graph = useMemo(() => {
    const titleToId = new Map<string, string>()
    notes.forEach((n) => titleToId.set(n.title.trim().toLowerCase(), n.id))

    const tagCount = new Map<string, number>()
    notes.forEach((n) => n.tags.forEach((t) => tagCount.set(t, (tagCount.get(t) || 0) + 1)))

    const nodes: GNode[] = []
    const index = new Map<string, number>()
    const links: GLink[] = []
    /** 有连接（双链或标签）的笔记，用于「隐藏孤立笔记」 */
    const connected = new Set<string>()

    notes.forEach((n) => {
      const deg = extractLinks(n.content).length + n.tags.length
      if (deg > 0) connected.add(n.id)
      const id = 'note:' + n.id
      index.set(id, nodes.length)
      nodes.push({
        id,
        kind: 'note',
        refId: n.id,
        label: n.title || '未命名笔记',
        deg,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        fixed: false,
        r: 5 + Math.min(9, deg * 1.1),
      })
    })

    if (showTags) {
      ;[...tagCount.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
        .forEach(([name, count]) => {
          const id = 'tag:' + name
          index.set(id, nodes.length)
          nodes.push({
            id,
            kind: 'tag',
            refId: name,
            label: name,
            deg: count,
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            fixed: false,
            r: 7 + Math.min(12, count * 0.9),
          })
        })
    }

    // 笔记 → 标签
    if (showTags) {
      notes.forEach((n) => {
        const s = index.get('note:' + n.id)
        if (s == null) return
        for (const t of n.tags) {
          const ti = index.get('tag:' + t)
          if (ti == null) continue
          links.push({ s, t: ti, kind: 'tag' })
        }
      })
    }
    // 笔记 → 笔记（[[双链]]）
    notes.forEach((n) => {
      const s = index.get('note:' + n.id)
      if (s == null) return
      for (const lk of extractLinks(n.content)) {
        const targetId = titleToId.get(lk.trim().toLowerCase())
        if (!targetId || targetId === n.id) continue
        const ti = index.get('note:' + targetId)
        if (ti == null) continue
        links.push({ s, t: ti, kind: 'link' })
      }
    })

    let finalNodes = nodes
    if (!showOrphans) {
      const keep = new Set<string>()
      notes.forEach((n) => {
        if (connected.has(n.id)) keep.add('note:' + n.id)
      })
      if (showTags) tagCount.forEach((_c, name) => keep.add('tag:' + name))
      finalNodes = nodes.filter((n) => keep.has(n.id))
    }

    // 重新索引
    const remap = new Map<number, number>()
    const list: GNode[] = []
    finalNodes.forEach((n) => {
      remap.set(index.get(n.id)!, list.length)
      list.push(n)
    })
    const finalLinks = links
      .filter((l) => remap.has(l.s) && remap.has(l.t))
      .map((l) => ({ s: remap.get(l.s)!, t: remap.get(l.t)!, kind: l.kind }))

    return {
      nodes: list,
      links: finalLinks,
      tagList: [...tagCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh')),
    }
  }, [notes, showTags, showOrphans])

  // ---------------------------------------------------------------- 尺寸
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let t: number | undefined
    const ro = new ResizeObserver(() => {
      if (t) clearTimeout(t)
      t = window.setTimeout(() => setSize({ w: Math.max(320, el.clientWidth), h: Math.max(320, el.clientHeight) }), 250)
    })
    ro.observe(el)
    setSize({ w: Math.max(320, el.clientWidth), h: Math.max(320, el.clientHeight) })
    return () => {
      ro.disconnect()
      if (t) clearTimeout(t)
    }
  }, [])

  // ---------------------------------------------------------------- 力导向动画
  const stopSim = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  const tick = useCallback(() => {
    const sim = simRef.current
    if (!sim) return
    stepSim(sim, size.w, size.h)
    sim.alpha *= 0.982
    setFrame((f) => f + 1)
    if (sim.alpha > 0.006) {
      rafRef.current = requestAnimationFrame(tick)
    } else {
      rafRef.current = null
    }
  }, [size.w, size.h])

  const restart = useCallback(
    (alpha = 1) => {
      const sim = simRef.current
      if (!sim) return
      sim.alpha = alpha
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick)
    },
    [tick],
  )

  // 图数据变化：保留已有节点的位置，新节点放到圆上
  useEffect(() => {
    if (mode !== 'graph') return
    const prev = new Map((simRef.current?.nodes || []).map((n) => [n.id, n]))
    const N = graph.nodes.length
    const cx = size.w / 2
    const cy = size.h / 2
    const rad = Math.min(size.w, size.h) * 0.36
    graph.nodes.forEach((n, i) => {
      const old = prev.get(n.id)
      if (old) {
        n.x = old.x
        n.y = old.y
        n.fixed = old.fixed
      } else {
        const a = (i / Math.max(N, 1)) * Math.PI * 2
        n.x = cx + Math.cos(a) * rad * (0.75 + Math.random() * 0.35)
        n.y = cy + Math.sin(a) * rad * (0.75 + Math.random() * 0.35)
      }
    })
    // 已有布局时只轻微扰动（笔记内容变化不该让整张图重新炸开）
    const had = (simRef.current?.nodes.length || 0) > 0
    simRef.current = { nodes: graph.nodes, links: graph.links, alpha: had ? 0.32 : 1 }
    restart(had ? 0.32 : 1)
    return stopSim
  }, [graph, mode, size.w, size.h, restart, stopSim])

  useEffect(() => stopSim, [stopSim])

  // ---------------------------------------------------------------- 交互
  const toGraph = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) return { x: 0, y: 0 }
      const rect = svg.getBoundingClientRect()
      const sx = rect.width / size.w
      const sy = rect.height / size.h
      return {
        x: (clientX - rect.left) / sx / view.k - view.tx / view.k,
        y: (clientY - rect.top) / sy / view.k - view.ty / view.k,
      }
    },
    [size.w, size.h, view.k, view.tx, view.ty],
  )

  const onNodeDown = (e: React.PointerEvent, i: number) => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = {
      mode: 'node',
      idx: i,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    }
  }

  const onBgDown = (e: React.PointerEvent) => {
    dragRef.current = {
      mode: 'pan',
      idx: -1,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    }
  }

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (d.mode === 'none') return
    const dx = e.clientX - d.lastX
    const dy = e.clientY - d.lastY
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 4) d.moved = true
    d.lastX = e.clientX
    d.lastY = e.clientY
    if (d.mode === 'pan') {
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }))
      return
    }
    const sim = simRef.current
    if (!sim) return
    const n = sim.nodes[d.idx]
    if (!n) return
    const pos = toGraph(e.clientX, e.clientY)
    n.x = pos.x
    n.y = pos.y
    n.fixed = true
    restart(0.35)
  }

  const onUp = () => {
    const d = dragRef.current
    if (d.mode === 'node' && !d.moved) {
      const sim = simRef.current
      const n = sim?.nodes[d.idx]
      if (n) {
        if (n.kind === 'note') onOpenNote(n.refId)
        else onFilterTag(n.refId)
      }
    }
    dragRef.current = { mode: 'none', idx: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false }
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    setView((v) => {
      const k = Math.max(0.25, Math.min(3, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
      // 以鼠标位置为锚点缩放
      return { k, tx: mx - ((mx - v.tx) * k) / v.k, ty: my - ((my - v.ty) * k) / v.k }
    })
  }

  /** 重新布局：解开所有钉住的节点，重新撒点 */
  const relayout = () => {
    const sim = simRef.current
    if (!sim) return
    const N = sim.nodes.length
    const cx = size.w / 2
    const cy = size.h / 2
    const rad = Math.min(size.w, size.h) * 0.36
    sim.nodes.forEach((n, i) => {
      const a = (i / Math.max(N, 1)) * Math.PI * 2
      n.x = cx + Math.cos(a) * rad * (0.75 + Math.random() * 0.35)
      n.y = cy + Math.sin(a) * rad * (0.75 + Math.random() * 0.35)
      n.fixed = false
    })
    setView({ tx: 0, ty: 0, k: 1 })
    restart(1)
  }

  /** 适应窗口：按当前节点包围盒缩放居中 */
  const fit = () => {
    const sim = simRef.current
    if (!sim || !sim.nodes.length) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    sim.nodes.forEach((n) => {
      minX = Math.min(minX, n.x - n.r)
      minY = Math.min(minY, n.y - n.r)
      maxX = Math.max(maxX, n.x + n.r)
      maxY = Math.max(maxY, n.y + n.r)
    })
    const pad = 40
    const kw = size.w / Math.max(maxX - minX + pad * 2, 1)
    const kh = size.h / Math.max(maxY - minY + pad * 2, 1)
    const k = Math.max(0.25, Math.min(2, Math.min(kw, kh)))
    setView({
      k,
      tx: size.w / 2 - ((minX + maxX) / 2) * k,
      ty: size.h / 2 - ((minY + maxY) / 2) * k,
    })
  }

  // ---------------------------------------------------------------- 渲染数据
  const sim = simRef.current
  const nodes = sim?.nodes || []
  const key = q.trim().toLowerCase()
  const dim = (n: GNode) => !!key && !n.label.toLowerCase().includes(key)

  const neighbors = useMemo(() => {
    const set = new Set<string>()
    if (!currentId || !sim) return set
    sim.links.forEach((l) => {
      const s = sim.nodes[l.s]
      const t = sim.nodes[l.t]
      if (s.id === 'note:' + currentId) set.add(t.id)
      if (t.id === 'note:' + currentId) set.add(s.id)
    })
    return set
  }, [sim, currentId])

  const tagMax = graph.tagList[0]?.[1] || 1

  return (
    <div className="graph-wrap">
      <div className="graph-bar">
        <div className="graph-tabs">
          <button className={`g-tab ${mode === 'graph' ? 'active' : ''}`} onClick={() => setMode('graph')}>
            关系图谱
          </button>
          <button className={`g-tab ${mode === 'cloud' ? 'active' : ''}`} onClick={() => setMode('cloud')}>
            标签云
          </button>
        </div>
        <div className="graph-stat">
          {notes.length} 篇笔记 · {graph.tagList.length} 个标签 · {graph.links.filter((l) => l.kind === 'link').length} 条双链
        </div>
        <div className="search-box small">
          <span className="ico">🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === 'cloud' ? '筛选标签' : '高亮节点'} />
          {q && (
            <button className="clear" onClick={() => setQ('')} title="清空">
              ✕
            </button>
          )}
        </div>
        {mode === 'graph' && (
          <>
            <label className="g-check" title="把标签也画成节点">
              <input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} />
              标签节点
            </label>
            <label className="g-check" title="显示既没有双链也没有标签的笔记">
              <input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} />
              孤立笔记
            </label>
            <span className="spacer" />
            <button className="btn tiny" onClick={relayout} title="重新计算布局">
              重新布局
            </button>
            <button className="btn tiny" onClick={fit} title="缩放到全部可见">
              适应窗口
            </button>
          </>
        )}
        {mode === 'cloud' && <span className="spacer" />}
      </div>

      {mode === 'cloud' ? (
        <div className="tag-cloud">
          {graph.tagList.length === 0 && <div className="empty-hint">还没有标签，在笔记里写 #标签 即可</div>}
          {graph.tagList
            .filter(([name]) => !key || name.toLowerCase().includes(key))
            .map(([name, count]) => {
              const ratio = count / tagMax
              const size = 13 + ratio * 24
              const opacity = 0.55 + ratio * 0.45
              return (
                <button
                  key={name}
                  className="cloud-item"
                  style={{ fontSize: size, opacity }}
                  onClick={() => onFilterTag(name)}
                  title={`${count} 篇笔记 · 点击筛选`}
                >
                  {name}
                  <span className="cloud-n">{count}</span>
                </button>
              )
            })}
        </div>
      ) : (
        <div className="graph-canvas" ref={wrapRef}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${size.w} ${size.h}`}
            onWheel={onWheel}
            onPointerDown={onBgDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
          >
            <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
              {sim?.links.map((l, i) => {
                const s = nodes[l.s]
                const t = nodes[l.t]
                if (!s || !t) return null
                const isCur =
                  !!currentId && (s.id === 'note:' + currentId || t.id === 'note:' + currentId)
                return (
                  <line
                    key={i}
                    x1={s.x}
                    y1={s.y}
                    x2={t.x}
                    y2={t.y}
                    stroke={isCur ? 'var(--accent)' : 'var(--border-strong)'}
                    strokeWidth={isCur ? 1.8 : 1}
                    strokeDasharray={l.kind === 'tag' ? '3 3' : undefined}
                    opacity={isCur ? 0.95 : l.kind === 'tag' ? 0.4 : 0.55}
                  />
                )
              })}
              {nodes.map((n, i) => {
                const isCur = n.id === 'note:' + currentId
                const near = neighbors.has(n.id)
                const isHover = hover === n.id
                const faded = dim(n)
                const op = faded ? 0.16 : 1
                const showLabel = !faded && (isHover || isCur || n.deg > 0 || view.k > 1.3)
                return (
                  <g
                    key={n.id}
                    className="graph-node"
                    opacity={op}
                    onPointerDown={(e) => onNodeDown(e, i)}
                    onPointerEnter={() => setHover(n.id)}
                    onPointerLeave={() => setHover(null)}
                    onDoubleClick={() => {
                      n.fixed = false
                      restart(0.5)
                    }}
                  >
                    <title>
                      {n.label}（{n.kind === 'tag' ? `${n.deg} 篇笔记` : `${n.deg} 条关联`}）· 单击打开，拖动可摆放，双击解除固定
                    </title>
                    {n.kind === 'tag' ? (
                      <rect
                        x={n.x - n.r}
                        y={n.y - n.r}
                        width={n.r * 2}
                        height={n.r * 2}
                        rx={5}
                        fill={near || isCur ? 'var(--accent-soft)' : 'var(--bg-elevated)'}
                        stroke={isCur || near || isHover ? 'var(--accent)' : 'var(--border-strong)'}
                        strokeWidth={isCur || isHover ? 2 : 1.4}
                      />
                    ) : (
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={(isCur || isHover ? n.r + 2.5 : n.r) as number}
                        fill={isCur ? 'var(--accent)' : near ? 'var(--accent-soft)' : 'var(--bg-hover)'}
                        stroke={isCur || near || isHover ? 'var(--accent)' : 'var(--border-strong)'}
                        strokeWidth={isCur || isHover ? 2 : 1.4}
                      />
                    )}
                    {showLabel && (
                      <text
                        x={n.x}
                        y={n.y + n.r + 12}
                        textAnchor="middle"
                        fill={isCur ? 'var(--accent)' : 'var(--text-dim)'}
                        fontWeight={isCur || near ? 600 : 400}
                      >
                        {n.label.length > 14 ? n.label.slice(0, 14) + '…' : n.label}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
          <div className="graph-tip">
            拖动节点可自行摆放（双击解除固定）· 拖空白处平移 · 滚轮缩放 · 点笔记进入，点标签筛选
          </div>
        </div>
      )}
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
