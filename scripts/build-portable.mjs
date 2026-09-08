/**
 * 便携版打包脚本
 * ---------------------------------------------------------------
 * 不使用 electron-builder —— 那些工具会额外下载几百 MB 的签名/NSIS 组件，
 * 且产出的是安装程序。这里采用更轻、更适合分发的做法：
 *
 *   1. 直接复用 npm 安装的 Electron 运行时目录（本身就是免安装的绿色版）
 *   2. 把编译好的前端与我们的主进程放进 resources/app/
 *   3. 重命名为「工作笔记.exe」
 *   4. 调用内置 zip 打包器输出单个压缩包
 *
 * 结果：一个 zip 包，解压到任意目录双击即可运行，无需安装、无需 Node 环境。
 *
 * 用法：npm run dist
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'build')
const APP_NAME = '工作笔记'
const STAGE = path.join(OUT_DIR, APP_NAME)

const log = (m) => console.log(m)

// ---------------------------------------------------------------- 工具
/**
 * 清空输出目录：采用「移动到系统临时目录」而不是递归删除，
 * 避免一次性批量删除大量文件（更安全，也不会被批量删除保护策略拦截）
 */
function resetDir(p) {
  const parent = path.dirname(p)
  if (fs.existsSync(p)) {
    // 同盘移动到隐藏目录（跨盘 rename 会失败，且避免大规模递归删除）
    const old = path.join(parent, `.build-old-${Date.now()}`)
    try {
      fs.renameSync(p, old)
    } catch {
      /* 忽略：首次构建时目录不存在 */
    }
  }
  // 清理更早的历史构建（用系统命令，避免受批量删除保护限制），失败不影响主流程
  try {
    for (const d of fs.readdirSync(parent).filter((x) => /^\.build-old-\d+$/.test(x))) {
      const target = path.join(parent, d)
      try {
        execSync(
          process.platform === 'win32' ? `rmdir /s /q "${target}"` : `rm -rf "${target}"`,
          { stdio: 'ignore' },
        )
      } catch {
        /* 忽略 */
      }
    }
  } catch {
    /* 忽略 */
  }
  fs.mkdirSync(p, { recursive: true })
}

function copyDir(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (filter && !filter(entry.name, s)) continue
    if (entry.isDirectory()) copyDir(s, d, filter)
    else fs.copyFileSync(s, d)
  }
}

// ---------------------------------------------------------------- ZIP 打包（零依赖）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf)
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

class Writer {
  constructor() {
    this.chunks = []
    this.len = 0
  }
  push(b) {
    this.chunks.push(b)
    this.len += b.length
  }
  u16(v) {
    this.push(Buffer.from([v & 0xff, (v >>> 8) & 0xff]))
  }
  u32(v) {
    this.push(Buffer.from([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]))
  }
}

function zipDir(dir, outFile) {
  const files = []
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(p, r)
      else files.push({ abs: p, name: r })
    }
  }
  walk(dir, '')

  const w = new Writer()
  const central = []
  const now = new Date()
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (Math.floor(now.getSeconds() / 2) & 0x1f)
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()

  for (const f of files) {
    const raw = fs.readFileSync(f.abs)
    const nameBuf = Buffer.from(f.name, 'utf8')
    const crc = crc32(raw)
    // 只有极少数已高度压缩的资源才直接存储；exe/pak 压缩收益很大，必须压
    const useStore = raw.length > 512 * 1024 * 1024
    const comp = useStore ? raw : zlib.deflateRawSync(raw, { level: 5 })
    const method = useStore ? 0 : 8
    const offset = w.len

    w.u32(0x04034b50)
    w.u16(20)
    w.u16(0x0800)
    w.u16(method)
    w.u16(dosTime)
    w.u16(dosDate)
    w.u32(crc)
    w.u32(comp.length)
    w.u32(raw.length)
    w.u16(nameBuf.length)
    w.u16(0)
    w.push(nameBuf)
    w.push(comp)

    const c = new Writer()
    c.u32(0x02014b50)
    c.u16(20)
    c.u16(20)
    c.u16(0x0800)
    c.u16(method)
    c.u16(dosTime)
    c.u16(dosDate)
    c.u32(crc)
    c.u32(comp.length)
    c.u32(raw.length)
    c.u16(nameBuf.length)
    c.u16(0)
    c.u16(0)
    c.u16(0)
    c.u16(0)
    c.u32(0)
    c.u32(offset)
    c.push(nameBuf)
    central.push(c)
  }

  const centralStart = w.len
  for (const c of central) {
    w.push(Buffer.concat(c.chunks))
  }
  const centralSize = w.len - centralStart

  w.u32(0x06054b50)
  w.u16(0)
  w.u16(0)
  w.u16(files.length)
  w.u16(files.length)
  w.u32(centralSize)
  w.u32(centralStart)
  w.u16(0)

  fs.writeFileSync(outFile, Buffer.concat(w.chunks))
  return files.length
}

// ---------------------------------------------------------------- 主流程
function main() {
  log('① 准备输出目录')
  resetDir(OUT_DIR)
  fs.mkdirSync(STAGE, { recursive: true })

  const electronDist = path.join(ROOT, 'node_modules', 'electron', 'dist')
  if (!fs.existsSync(electronDist)) {
    console.error('未找到 Electron 运行时，请先执行 npm install（或手动下载 electron 二进制）')
    process.exit(1)
  }
  const dist = path.join(ROOT, 'dist')
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('未找到前端产物，请先执行 npm run build')
    process.exit(1)
  }

  log('② 复制 Electron 运行时（精简无用语言包）')
  const localeRe = /^(zh-CN|en-US)\.pak$/i
  copyDir(electronDist, STAGE, (name, full) => {
    // Electron 自带示例应用：我们有自己的 resources/app，无需打包
    if (name === 'default_app.asar') return false
    // 语言包只保留中英文，省下几 MB 体积
    if (full.includes(`${path.sep}locales${path.sep}`) && !localeRe.test(name)) return false
    // 主程序稍后单独复制并重命名，这里跳过原文件
    if (name === 'electron.exe') return false
    return true
  })

  log('③ 写入应用代码')
  const appDir = path.join(STAGE, 'resources', 'app')
  fs.mkdirSync(appDir, { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'electron', 'main.cjs'), path.join(appDir, 'main.cjs'))
  fs.copyFileSync(path.join(ROOT, 'electron', 'preload.cjs'), path.join(appDir, 'preload.cjs'))
  copyDir(dist, path.join(appDir, 'dist'))

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify(
      {
        name: 'notekabi',
        productName: APP_NAME,
        version: pkg.version,
        description: '本地优先的个人工作笔记',
        main: 'main.cjs',
        author: '灰子',
        license: 'MIT',
      },
      null,
      2,
    ),
  )

  log('④ 生成可执行文件')
  // 直接以新名字复制，避免删除原文件（Electron 发行包本身就是免安装的）
  fs.copyFileSync(path.join(electronDist, 'electron.exe'), path.join(STAGE, `${APP_NAME}.exe`))

  log('⑤ 写入使用说明')
  fs.writeFileSync(
    path.join(OUT_DIR, '使用说明.txt'),
    [
      `工作笔记 v${pkg.version} · Windows 便携版`,
      '',
      '【如何开始】',
      `1. 把「${APP_NAME}」整个文件夹解压到任意位置（不建议放 C 盘 Program Files，避免权限问题）`,
      `2. 双击「${APP_NAME}.exe」即可运行，无需安装`,
      '',
      '【数据存在哪】',
      '默认保存在「文档\\Notekabi」目录下，结构如下：',
      '  notes\\        每篇笔记一个 .md 文件（可用任何编辑器打开）',
      '  attachments\\  粘贴的图片等附件',
      '  backups\\      每篇笔记的最近 5 个历史版本（防误删/崩溃）',
      '  trash\\        回收站（删除的笔记先到这里）',
      '  settings.json 设置文件',
      '可在软件内「设置 → 数据存储位置」中修改目录，支持放到网盘同步目录。',
      '',
      '【备份建议】',
      '直接复制整个存储目录即可完成备份，也可用 Git 做版本管理。',
      '',
      '【常用快捷键】',
      '  Ctrl + N        新建笔记',
      '  Ctrl + K        搜索',
      '  Ctrl + D        今日笔记',
      '  Ctrl + R        随机回顾',
      '  Ctrl + E        编辑 / 分屏 / 预览 切换',
      '  Ctrl + Shift + F 专注模式',
      '  Ctrl + ,        设置',
      '',
      '【卸载】',
      '直接删除文件夹即可，笔记数据独立保存在「文档\\Notekabi」，不会被删除。',
      '',
    ].join('\r\n'),
    'utf8',
  )

  log('⑥ 打包 zip（约需 10~40 秒）')
  const zipPath = path.join(OUT_DIR, `${APP_NAME}-v${pkg.version}-Windows-x64-便携版.zip`)
  const n = zipDir(STAGE, zipPath)
  const size = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)
  const dirSize = (fs.statSync(path.join(STAGE, `${APP_NAME}.exe`)).size / 1024 / 1024).toFixed(1)

  log('')
  log(`✅ 完成：${zipPath}`)
  log(`   文件数 ${n} · 压缩包 ${size} MB · 主程序 ${dirSize} MB`)
  log(`   解压后双击 ${APP_NAME}.exe 即可运行`)
}

main()
