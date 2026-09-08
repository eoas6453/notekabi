import { useEffect } from 'react'
import { api } from '../lib/api'

/**
 * 打印视图
 * ---------------------------------------------------------------
 * PDF 导出策略：先把要导出的内容渲染成打印样式，
 * 桌面端调用 Chromium 内置的 printToPDF 直接落盘；
 * 浏览器端退化为调用系统打印对话框（可在其中选择「另存为 PDF」）。
 */
export default function PrintView({
  html,
  name,
  onDone,
}: {
  html: string
  name: string
  onDone: (ok: boolean, path?: string | null) => void
}) {
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const path = await api.exportPdf({ defaultName: name })
        if (!cancelled) onDone(true, path)
      } catch (e) {
        if (!cancelled) onDone(false)
      }
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="print-root">
      <div className="print-actions">
        <button className="btn" onClick={() => window.print()}>
          打开打印对话框
        </button>
        <button className="btn" onClick={() => onDone(false)}>
          取消
        </button>
      </div>
      <div className="print-doc md-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
