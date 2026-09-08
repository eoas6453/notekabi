/**
 * 零依赖 Markdown 渲染器
 * ---------------------------------------------------------------
 * 支持范围（覆盖个人工作笔记的真实场景）：
 *   - 标题、段落、换行、分割线
 *   - 强调：粗体 / 斜体 / 删除线 / 行内代码
 *   - 列表：无序、有序、任务清单（- [ ] / - [x]），支持一层嵌套
 *   - 引用块、围栏代码块（带语言标签与轻量语法高亮）
 *   - GFM 表格
 *   - 图片、链接、自动链接
 *   - 扩展：[[双向链接]] 与 #标签
 *
 * 安全：所有用户输入先做 HTML 转义，再生成标签，避免脚本注入。
 */

// ---------------------------------------------------------------- 工具
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const KEYWORDS: Record<string, string[]> = {
  javascript: 'const let var function return if else for while class new import export from default async await try catch finally typeof instanceof this null undefined true false switch case break continue extends super yield delete in of throw'.split(' '),
  typescript: 'const let var function return if else for while class new import export from default async await try catch finally typeof instanceof this null undefined true false interface type enum implements public private readonly extends super yield delete in of throw string number boolean any void'.split(' '),
  python: 'def class return if elif else for while import from as with try except finally raise lambda None True False and or not in is pass yield global async await'.split(' '),
  go: 'func package import return if else for range var const type struct interface map chan go defer nil true false switch case default'.split(' '),
  java: 'public private protected class interface extends implements static final void int long double boolean return if else for while new try catch finally import package null true false this super'.split(' '),
  sql: 'select from where insert into values update set delete create table drop alter join left right inner on group by order limit offset as and or not null count sum avg distinct'.split(' '),
  css: 'color background margin padding border font width height display flex position absolute relative top left right bottom z-index'.split(' '),
  json: ['true', 'false', 'null'],
  bash: 'if then else fi for do done echo cd ls rm mkdir cp mv cat grep sudo export'.split(' '),
}
const ALIAS: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', golang: 'go', sh: 'bash', shell: 'bash', zsh: 'bash',
  yml: 'python', html: 'xml', vue: 'xml',
}

/** 极简语法着色：注释 → 字符串 → 数字 → 关键字，逐 token 转义 */
function highlight(code: string, lang: string): string {
  const key = ALIAS[lang] || lang
  const kw = KEYWORDS[key]
  if (!kw) return escapeHtml(code)

  const patterns: { type: string; re: RegExp }[] = [
    { type: 'cm', re: /\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*/y },
    { type: 'st', re: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/y },
    { type: 'nu', re: /\b\d+(\.\d+)?\b/y },
    { type: 'kw', re: /\b[A-Za-z_$][\w$]*\b/y },
  ]
  let out = ''
  let i = 0
  while (i < code.length) {
    let matched = false
    for (const p of patterns) {
      p.re.lastIndex = i
      const m = p.re.exec(code)
      if (m && m.index === i && m[0].length) {
        const text = m[0]
        if (p.type === 'kw' && !kw.includes(text)) continue
        out += `<span class="tok-${p.type}">${escapeHtml(text)}</span>`
        i += text.length
        matched = true
        break
      }
    }
    if (!matched) {
      out += escapeHtml(code[i])
      i += 1
    }
  }
  return out
}

// ---------------------------------------------------------------- 行内渲染
const WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
const INLINE_TAG = /(^|[\s(（，,。;；、])#([^\s#\[\]()（）,，。;；、]{1,24})/g

export interface RenderOptions {
  /** 已存在的笔记标题集合：存在则双向链接渲染为可用链接，否则标记为「待创建」 */
  knownTitles?: Set<string>
  /** 关键词高亮（搜索命中） */
  highlight?: string[]
  /** 把相对附件路径转换为可访问地址 */
  resolveAsset?: (src: string) => string
}

function inline(text: string, opts: RenderOptions): string {
  let s = escapeHtml(text)

  // 行内代码优先保护（内部不再做其它解析）
  const codes: string[] = []
  s = s.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c)
    return `\u0000CODE${codes.length - 1}\u0000`
  })

  // 图片
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_m, alt, src, title) => {
    const url = opts.resolveAsset ? opts.resolveAsset(src) : src
    return `<img src="${url}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy" />`
  })
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
    const url = opts.resolveAsset ? opts.resolveAsset(src) : src
    return `<img src="${url}" alt="${alt}" loading="lazy" />`
  })

  // 链接
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const safe = /^(https?:|mailto:|file:|data:image|#|\.)/.test(href) ? href : '#'
    const external = /^https?:/.test(href)
    return `<a href="${safe}"${external ? ' target="_blank" rel="noreferrer"' : ''}>${label}</a>`
  })

  // 双向链接 [[标题]] / [[标题|别名]]
  s = s.replace(WIKI_LINK, (_m, target, alias) => {
    const t = String(target).trim()
    const known = opts.knownTitles ? opts.knownTitles.has(t.toLowerCase()) : true
    const cls = known ? 'wikilink' : 'wikilink wikilink-new'
    return `<a class="${cls}" data-wikilink="${escapeHtml(t)}" href="#">${alias || target}</a>`
  })

  // #标签
  s = s.replace(INLINE_TAG, (_m, pre, tag) => `${pre}<span class="inline-tag" data-tag="${tag}">#${tag}</span>`)

  // 强调
  s = s
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')

  // 自动链接
  s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)"']+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')

  // 还原行内代码
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => `<code class="inline-code">${codes[Number(i)]}</code>`)

  // 搜索关键词高亮（放在最后，避免破坏标签结构）
  if (opts.highlight && opts.highlight.length) {
    for (const kw of opts.highlight) {
      if (!kw.trim()) continue
      const re = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
      s = s.replace(re, (m0, g1, offset: number, whole: string) => {
        // 跳过标签内部（<> 之间）
        const before = whole.slice(0, offset)
        if (before.lastIndexOf('<') > before.lastIndexOf('>')) return m0
        return `<mark class="search-hit">${g1}</mark>`
      })
    }
  }
  return s
}

// ---------------------------------------------------------------- 块级渲染
export function renderMarkdown(src: string, opts: RenderOptions = {}): string {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  const flushList = (items: string[], ordered: boolean, start = 1) => {
    const tag = ordered ? 'ol' : 'ul'
    const attr = ordered && start !== 1 ? ` start="${start}"` : ''
    out.push(`<${tag}${attr}>${items.join('')}</${tag}>`)
  }

  while (i < lines.length) {
    const line = lines[i]

    // 空行
    if (!line.trim()) {
      i++
      continue
    }

    // 围栏代码块
    const fence = /^```+\s*([A-Za-z0-9+#_-]*)\s*$/.exec(line)
    if (fence) {
      const lang = (fence[1] || '').toLowerCase()
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```+\s*$/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++ // 跳过闭合围栏
      const code = buf.join('\n')
      out.push(
        `<div class="code-block"><div class="code-head"><span class="code-lang">${
          lang ? escapeHtml(lang) : 'text'
        }</span><button class="code-copy" type="button" data-code="${encodeURIComponent(code)}">复制</button></div>` +
          `<pre><code class="language-${escapeHtml(lang || 'text')}">${highlight(code, lang)}</code></pre></div>`,
      )
      continue
    }

    // 分割线
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line) && !/^\s*[-*+]\s+/.test(line)) {
      out.push('<hr />')
      i++
      continue
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2], opts)}</h${level}>`)
      i++
      continue
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'), opts)}</blockquote>`)
      continue
    }

    // 表格
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const splitRow = (r: string) =>
        r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
      const header = splitRow(line)
      const align = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':')
        const r = c.endsWith(':')
        return l && r ? 'center' : r ? 'right' : l ? 'left' : ''
      })
      i += 2
      const body: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        body.push(splitRow(lines[i]))
        i++
      }
      const th = header
        .map((c, k) => `<th${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c, opts)}</th>`)
        .join('')
      const tb = body
        .map(
          (row) =>
            `<tr>${header
              .map(
                (_c, k) =>
                  `<td${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(row[k] ?? '', opts)}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('')
      out.push(`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`)
      continue
    }

    // 列表（含任务清单与一层嵌套）
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const startNum = ordered ? parseInt(line.trim(), 10) || 1 : 1
      const items: string[] = []
      while (i < lines.length) {
        const l = lines[i]
        if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
          const indent = l.match(/^\s*/)![0].length
          let content = l.replace(/^\s*([-*+]|\d+[.)])\s+/, '')
          // 任务清单
          const task = /^\[([ xX])\]\s+(.*)$/.exec(content)
          if (task) {
            const checked = task[1].toLowerCase() === 'x'
            items.push(
              `<li class="task-item"><input type="checkbox" disabled ${checked ? 'checked' : ''} data-line="${i}" /> ${inline(task[2], opts)}</li>`,
            )
          } else {
            items.push(`<li>${inline(content, opts)}</li>`)
          }
          // 嵌套子项
          i++
          const sub: string[] = []
          while (i < lines.length && /^\s{2,}([-*+]|\d+[.)])\s+/.test(lines[i]) && (lines[i].match(/^\s*/)![0].length > indent)) {
            const subContent = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')
            const subTask = /^\[([ xX])\]\s+(.*)$/.exec(subContent)
            if (subTask) {
              const checked = subTask[1].toLowerCase() === 'x'
              sub.push(
                `<li class="task-item"><input type="checkbox" disabled ${checked ? 'checked' : ''} data-line="${i}" /> ${inline(subTask[2], opts)}</li>`,
              )
            } else {
              sub.push(`<li>${inline(subContent, opts)}</li>`)
            }
            i++
          }
          if (sub.length) {
            items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, '') // 打开嵌套容器
            items[items.length - 1] += `<${ordered ? 'ol' : 'ul'}>${sub.join('')}</${ordered ? 'ol' : 'ul'}></li>`
          }
          continue
        }
        if (l.trim() && /^\s{2,}\S/.test(l) && items.length) {
          // 续行：并入上一个列表项
          items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, ' ' + inline(l.trim(), opts) + '</li>')
          i++
          continue
        }
        break
      }
      flushList(items, ordered, startNum)
      continue
    }

    // 段落（连续非空行合并，行尾双空格或 \ 视为换行）
    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|>|[-*_]{3,}\s*$)/.test(lines[i]) &&
      !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])
    ) {
      buf.push(lines[i])
      i++
    }
    if (buf.length) {
      out.push(`<p>${buf.map((l) => inline(l, opts)).join('<br />')}</p>`)
    } else {
      i++
    }
  }

  return out.join('\n')
}

/** 提取纯文本（用于搜索摘要、导出） */
export function markdownToText(src: string): string {
  return String(src || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$2$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
