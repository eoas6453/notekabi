import type { Note } from '../types'
import { renderMarkdown } from './markdown'
import { makeZip } from './zip'
import { formatDateTime } from './date'

/**
 * 导出能力
 * ---------------------------------------------------------------
 * Markdown：直接输出纯文本（单篇）/ zip 包（多篇，保留一篇一文件）
 * Word    ：手写最小 OOXML + 自研 zip 打包，不依赖 docx 库，WPS / Word 均可打开
 * PDF     ：渲染为打印视图后调用 Chromium 内置 printToPDF，无需 pandoc
 */

// ---------------------------------------------------------------- Markdown
export function noteToMarkdown(note: Note): string {
  const tags = note.tags.length ? `\n\n标签：${note.tags.map((t) => `#${t}`).join(' ')}` : ''
  return `# ${note.title}\n\n${note.content || ''}${tags}\n`
}

export function notesToMarkdown(notes: Note[]): string {
  return notes
    .map((n) => `<!-- 标题：${n.title} | 更新：${formatDateTime(n.updated)} -->\n\n${noteToMarkdown(n)}`)
    .join('\n\n---\n\n')
}

export async function notesToMarkdownZip(notes: Note[]): Promise<Uint8Array> {
  const used = new Set<string>()
  const entries = notes.map((n) => {
    let name = (n.title || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
    while (used.has(name)) name += '_'
    used.add(name)
    return { name: `${name}.md`, data: noteToMarkdown(n) }
  })
  return makeZip(entries)
}

// ---------------------------------------------------------------- Word (docx)
function escXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 将行内 HTML 转换为 Word 的 run 集合 */
function inlineToRuns(html: string): string {
  let out = ''
  const stack: string[] = []
  const flushStyle = () => {
    if (!stack.length) return ''
    const props: string[] = []
    if (stack.includes('b')) props.push('<w:b/>')
    if (stack.includes('i')) props.push('<w:i/>')
    if (stack.includes('del')) props.push('<w:strike/>')
    if (stack.includes('code'))
      props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/><w:shd w:val="clear" w:fill="F2F2F2"/>')
    if (stack.includes('mark')) props.push('<w:shd w:val="clear" w:fill="FFF3A3"/>')
    if (stack.includes('a')) props.push('<w:color w:val="2563EB"/><w:u w:val="single"/>')
    return props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''
  }

  const re = /<(\/)?([a-zA-Z]+)[^>]*>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[3] !== undefined) {
      const text = m[3]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
      if (text) out += `<w:r>${flushStyle()}<w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`
      continue
    }
    const closing = !!m[1]
    const tag = (m[2] || '').toLowerCase()
    if (closing) {
      const i = stack.lastIndexOf(tag)
      if (i >= 0) stack.splice(i, 1)
      continue
    }
    if (tag === 'br') {
      out += '<w:r><w:br/></w:r>'
    } else if (['b', 'strong'].includes(tag)) stack.push('b')
    else if (['i', 'em'].includes(tag)) stack.push('i')
    else if (['del', 's'].includes(tag)) stack.push('del')
    else if (tag === 'code') stack.push('code')
    else if (tag === 'mark') stack.push('mark')
    else if (tag === 'a') stack.push('a')
  }
  return out
}

const P = (props: string, runs: string) => `<w:p><w:pPr>${props}</w:pPr>${runs}</w:p>`

/** 把 Markdown 渲染出的 HTML 转成 Word 正文 XML */
function htmlToDocumentBody(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild!
  let out = ''

  for (const el of Array.from(root.children)) {
    const tag = el.tagName.toLowerCase()
    if (tag === 'p') {
      out += P('<w:spacing w:after="120"/>', inlineToRuns(el.innerHTML))
    } else if (/^h[1-6]$/.test(tag)) {
      const lv = Math.min(Number(tag[1]), 4)
      out += P(
        `<w:pStyle w:val="Heading${lv}"/><w:spacing w:before="240" w:after="120"/>`,
        inlineToRuns(el.innerHTML),
      )
    } else if (tag === 'blockquote') {
      for (const inner of Array.from(el.children)) {
        out += P(
          '<w:ind w:left="480"/><w:spacing w:after="120"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="CBD5E1"/></w:pBdr>',
          `<w:r><w:rPr><w:i/><w:color w:val="64748B"/></w:rPr>${inlineToRuns(inner.innerHTML).replace(/<w:r>/g, '<w:r>')}</w:r>`,
        )
      }
    } else if (tag === 'div' && el.querySelector('pre')) {
      const code = el.querySelector('code')
      const text = code ? (code.textContent || '') : ''
      for (const line of text.split('\n')) {
        out += P(
          '<w:shd w:val="clear" w:fill="F5F6F8"/><w:spacing w:after="0"/>',
          `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/><w:sz w:val="19"/></w:rPr><w:t xml:space="preserve">${escXml(line)}</w:t></w:r>`,
        )
      }
      out += P('<w:spacing w:after="120"/>', '')
    } else if (tag === 'pre') {
      for (const line of (el.textContent || '').split('\n')) {
        out += P(
          '<w:shd w:val="clear" w:fill="F5F6F8"/><w:spacing w:after="0"/>',
          `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/></w:rPr><w:t xml:space="preserve">${escXml(line)}</w:t></w:r>`,
        )
      }
    } else if (tag === 'ul' || tag === 'ol') {
      let index = 1
      for (const li of Array.from(el.children)) {
        const isTask = li.classList.contains('task-item')
        const bullet = isTask
          ? (li.querySelector('input') as HTMLInputElement)?.checked
            ? '☑ '
            : '☐ '
          : tag === 'ol'
            ? `${index++}. `
            : '• '
        const runs = inlineToRuns(li.innerHTML.replace(/<input[^>]*>/g, ''))
        out += P('<w:ind w:left="360"/><w:spacing w:after="60"/>', `<w:r><w:t xml:space="preserve">${bullet}</w:t></w:r>${runs}`)
        // 嵌套列表
        const nested = li.querySelector(':scope > ul, :scope > ol')
        if (nested) {
          for (const nli of Array.from(nested.children)) {
            const nb = (nli.querySelector('input') as HTMLInputElement)?.checked ? '☑ ' : '☐ '
            const subRuns = inlineToRuns(nli.innerHTML.replace(/<input[^>]*>/g, ''))
            out += P(
              '<w:ind w:left="720"/><w:spacing w:after="60"/>',
              `<w:r><w:t xml:space="preserve">- ${nb}</w:t></w:r>${subRuns}`,
            )
          }
        }
      }
    } else if (tag === 'div' && el.querySelector('table')) {
      out += tableToXml(el.querySelector('table')!)
    } else if (tag === 'table') {
      out += tableToXml(el)
    } else if (tag === 'hr') {
      out += P('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pBdr>', '')
    } else if (tag === 'img') {
      out += P(
        '<w:spacing w:after="120"/>',
        `<w:r><w:rPr><w:i/><w:color w:val="64748B"/></w:rPr><w:t xml:space="preserve">[图片：${escXml(
          el.getAttribute('alt') || '附件',
        )}]</w:t></w:r>`,
      )
    } else {
      out += P('<w:spacing w:after="120"/>', inlineToRuns(el.innerHTML))
    }
  }
  return out
}

function tableToXml(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr'))
  if (!rows.length) return ''
  let xml = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>'
  for (const side of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
    xml += `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>`
  }
  xml += '</w:tblBorders></w:tblPr>'
  for (const tr of rows) {
    xml += '<w:tr>'
    for (const cell of Array.from(tr.children)) {
      const isHead = cell.tagName.toLowerCase() === 'th'
      xml += `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${
        isHead ? '<w:shd w:val="clear" w:fill="F1F5F9"/>' : ''
      }</w:tcPr>${P(
        '<w:spacing w:after="40"/>',
        inlineToRuns(isHead ? `<b>${cell.innerHTML}</b>` : cell.innerHTML),
      )}</w:tc>`
    }
    xml += '</w:tr>'
  }
  return xml + '</w:tbl>' + P('<w:spacing w:after="120"/>', '')
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:pPr><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>
</w:styles>`

/** 生成 .docx 字节流 */
export async function notesToDocx(notes: Note[]): Promise<Uint8Array> {
  let body = ''
  notes.forEach((note, i) => {
    if (notes.length > 1) {
      body += P(
        '<w:pStyle w:val="Heading1"/><w:spacing w:before="240" w:after="120"/>',
        `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escXml(note.title)}</w:t></w:r>`,
      )
      body += P(
        '<w:spacing w:after="160"/>',
        `<w:r><w:rPr><w:color w:val="94A3B8"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">更新于 ${escXml(
          formatDateTime(note.updated),
        )}${note.tags.length ? ' · 标签：' + escXml(note.tags.join('、')) : ''}</w:t></w:r>`,
      )
    } else {
      body += P(
        '<w:pStyle w:val="Heading1"/><w:spacing w:after="160"/>',
        `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escXml(note.title)}</w:t></w:r>`,
      )
    }
    body += htmlToDocumentBody(renderMarkdown(note.content))
    if (i < notes.length - 1) body += P('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="E2E8F0"/></w:pBdr>', '')
  })

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`

  return makeZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: RELS },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: STYLES },
  ])
}

// ---------------------------------------------------------------- PDF / 打印
/** 生成用于打印（PDF）的完整 HTML 文档片段 */
export function buildPrintHtml(notes: Note[], resolveAsset?: (s: string) => string): string {
  const parts = notes.map((n) => {
    const head =
      notes.length > 1
        ? `<div class="pm-meta">${escXml(n.title)} · 更新于 ${formatDateTime(n.updated)}${
            n.tags.length ? ' · ' + n.tags.map((t) => '#' + escXml(t)).join(' ') : ''
          }</div>`
        : `<div class="pm-meta">更新于 ${formatDateTime(n.updated)}${
            n.tags.length ? ' · ' + n.tags.map((t) => '#' + escXml(t)).join(' ') : ''
          }</div>`
    return `<section class="pm-note"><h1>${escXml(n.title)}</h1>${head}${renderMarkdown(n.content, {
      resolveAsset,
    })}</section>`
  })
  return parts.join(notes.length > 1 ? '<div class="pm-sep"></div>' : '')
}

/** 触发浏览器下载（作为无对话框环境的兜底） */
export function downloadBytes(name: string, bytes: Uint8Array, mime: string) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
