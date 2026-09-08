import type { Backlink } from '../types'

interface Props {
  backlinks: Backlink[]
  outgoing: { title: string; exists: boolean }[]
  onOpenNote: (id: string) => void
  onOpenTitle: (title: string) => void
}

export default function BacklinkPanel({ backlinks, outgoing, onOpenNote, onOpenTitle }: Props) {
  return (
    <div className="backlink-panel">
      <p className="bl-title">反向链接（{backlinks.length}）</p>
      {backlinks.length === 0 && <div className="bl-empty">还没有其它笔记引用本篇</div>}
      {backlinks.map((b) => (
        <div key={b.id} className="bl-item" onClick={() => onOpenNote(b.id)} title="点击打开">
          <div className="t">{b.title}</div>
          <div className="c">{b.context}</div>
        </div>
      ))}

      {outgoing.length > 0 && (
        <>
          <p className="bl-title" style={{ marginTop: 18 }}>
            本篇引用（{outgoing.length}）
          </p>
          {outgoing.map((o) => (
            <div key={o.title} className="bl-item" onClick={() => onOpenTitle(o.title)} title="点击跳转">
              <div className="t">
                {o.exists ? '' : '➕ '}
                {o.title}
              </div>
              <div className="c">{o.exists ? '已存在，点击打开' : '尚未创建，点击创建'}</div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
