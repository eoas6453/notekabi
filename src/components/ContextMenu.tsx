import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  icon?: string
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  onSelect?: () => void
  /** 在该项之前画一条分隔线 */
  sepBefore?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  title?: string
  onClose: () => void
}

const MENU_W = 196
const ITEM_H = 30

/**
 * 轻量右键菜单（零依赖）
 * 在鼠标位置弹出，自动避开视口边缘；点击别处 / Esc / 滚动 / 失焦即关闭。
 */
export default function ContextMenu(p: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: p.x, top: p.y })

  // 越界时回收到视口内
  useLayoutEffect(() => {
    const h = (p.items.length || 1) * ITEM_H + (p.title ? 30 : 0) + 12
    const left = Math.min(p.x, Math.max(4, window.innerWidth - MENU_W - 8))
    const top = Math.min(p.y, Math.max(4, window.innerHeight - h - 8))
    setPos({ left, top })
  }, [p.x, p.y, p.items.length, p.title])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) p.onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        p.onClose()
      }
    }
    // 捕获阶段监听，先于业务 handler
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('contextmenu', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', p.onClose)
    window.addEventListener('blur', p.onClose)
    const scroller = document.querySelector('.note-list') || document.querySelector('.sidebar')
    scroller?.addEventListener('scroll', p.onClose)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('contextmenu', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', p.onClose)
      window.removeEventListener('blur', p.onClose)
      scroller?.removeEventListener('scroll', p.onClose)
    }
  }, [p.onClose])

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top, width: MENU_W }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {p.title && <div className="ctx-title">{p.title}</div>}
      {p.items.map((it, i) => (
        <div key={i}>
          {it.sepBefore && <div className="ctx-sep" />}
          <button
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              if (it.disabled) return
              it.onSelect?.()
              p.onClose()
            }}
          >
            <span className="ctx-ico">{it.icon || ''}</span>
            <span className="ctx-label">{it.label}</span>
            {it.hint && <span className="ctx-hint">{it.hint}</span>}
          </button>
        </div>
      ))}
    </div>
  )
}
