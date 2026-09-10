/**
 * 非破坏性打包：直接压缩已就绪的 build/工作笔记/ 为便携版 zip。
 * 与 scripts/build-portable.mjs 的区别：不重置/删除 build/，
 * 因此 build/ 下已有的发布 zip（v1.0.0 / v1.1.0）原样保留，符合「zip 一律保留」规则。
 *
 * 用法：node scripts/zip-current.mjs [输出名后缀]
 *   默认输出：build/工作笔记-v1.1.0-Windows-x64-便携版-YYYYMMDD.zip
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const STAGE = path.join(ROOT, 'build', '工作笔记')
const OUT_DIR = path.join(ROOT, 'build')

if (!fs.existsSync(STAGE)) {
  console.error('未找到 build/工作笔记/，请先确保便携版目录已就绪')
  process.exit(1)
}

// ---------------- CRC32 ----------------
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
  constructor() { this.chunks = []; this.len = 0 }
  push(b) { this.chunks.push(b); this.len += b.length }
  u16(v) { this.push(Buffer.from([v & 0xff, (v >>> 8) & 0xff])) }
  u32(v) { this.push(Buffer.from([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])) }
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
    const useStore = raw.length > 512 * 1024 * 1024
    const comp = useStore ? raw : zlib.deflateRawSync(raw, { level: 5 })
    const method = useStore ? 0 : 8
    const offset = w.len

    w.u32(0x04034b50); w.u16(20); w.u16(0x0800); w.u16(method)
    w.u16(dosTime); w.u16(dosDate); w.u32(crc)
    w.u32(comp.length); w.u32(raw.length); w.u16(nameBuf.length); w.u16(0)
    w.push(nameBuf); w.push(comp)

    const c = new Writer()
    c.u32(0x02014b50); c.u16(20); c.u16(20); c.u16(0x0800); c.u16(method)
    c.u16(dosTime); c.u16(dosDate); c.u32(crc)
    c.u32(comp.length); c.u32(raw.length); c.u16(nameBuf.length)
    c.u16(0); c.u16(0); c.u16(0); c.u16(0); c.u32(0); c.u32(offset)
    c.push(nameBuf)
    central.push(c)
  }

  const centralStart = w.len
  for (const c of central) w.push(Buffer.concat(c.chunks))
  const centralSize = w.len - centralStart

  w.u32(0x06054b50); w.u16(0); w.u16(0)
  w.u16(files.length); w.u16(files.length)
  w.u32(centralSize); w.u32(centralStart); w.u16(0)

  fs.writeFileSync(outFile, Buffer.concat(w.chunks))
  return files.length
}

const d = new Date()
const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
const suffix = process.argv[2] || ymd
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const zipPath = path.join(OUT_DIR, `工作笔记-v${pkg.version}-Windows-x64-便携版-${suffix}.zip`)

const n = zipDir(STAGE, zipPath)
const size = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)
console.log(`✅ 打包完成：${zipPath}`)
console.log(`   文件数 ${n} · 压缩包 ${size} MB`)
console.log('   既有的 v1.0.0 / v1.1.0 zip 未改动')
