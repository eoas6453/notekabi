/**
 * 零依赖 ZIP 打包器
 * ---------------------------------------------------------------
 * 用途：生成 .docx（本质就是 zip 包）、批量导出 Markdown 压缩包。
 * 优先使用浏览器/Chromium 内置的 CompressionStream('deflate-raw')，
 * 不可用时降级为 store（不压缩），保证任何环境都能产出可打开的文档。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** deflate（无 zlib 头）：优先原生 CompressionStream，失败则原样返回（store） */
export async function deflateRaw(data: Uint8Array): Promise<{ out: Uint8Array; method: number }> {
  try {
    const CS = (globalThis as any).CompressionStream
    if (CS) {
      const cs = new CS('deflate-raw')
      const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(cs)
      const buf = new Uint8Array(await new Response(stream).arrayBuffer())
      return { out: buf, method: 8 }
    }
  } catch {
    /* 降级 */
  }
  return { out: data, method: 0 }
}

export interface ZipEntry {
  name: string
  data: Uint8Array | string
}

function toBytes(d: Uint8Array | string): Uint8Array {
  return typeof d === 'string' ? new TextEncoder().encode(d) : d
}

class ByteWriter {
  private chunks: Uint8Array[] = []
  private len = 0
  push(bytes: Uint8Array) {
    this.chunks.push(bytes)
    this.len += bytes.length
  }
  u16(v: number) {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]))
  }
  u32(v: number) {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]))
  }
  get length() {
    return this.len
  }
  concat(): Uint8Array {
    const out = new Uint8Array(this.len)
    let p = 0
    for (const c of this.chunks) {
      out.set(c, p)
      p += c.length
    }
    return out
  }
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/** 打包成 ZIP 字节流 */
export async function makeZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const { time, date } = dosDateTime(new Date())
  const w = new ByteWriter()
  const central: Uint8Array[] = []
  let count = 0

  for (const entry of entries) {
    const raw = toBytes(entry.data)
    const nameBytes = new TextEncoder().encode(entry.name)
    const crc = crc32(raw)
    const { out: comp, method } = await deflateRaw(raw)
    const offset = w.length

    // Local file header
    w.u32(0x04034b50)
    w.u16(20)
    w.u16(0x0800) // UTF-8 文件名
    w.u16(method)
    w.u16(time)
    w.u16(date)
    w.u32(crc)
    w.u32(comp.length)
    w.u32(raw.length)
    w.u16(nameBytes.length)
    w.u16(0)
    w.push(nameBytes)
    w.push(comp)

    // Central directory header
    const c = new ByteWriter()
    c.u32(0x02014b50)
    c.u16(20)
    c.u16(20)
    c.u16(0x0800)
    c.u16(method)
    c.u16(time)
    c.u16(date)
    c.u32(crc)
    c.u32(comp.length)
    c.u32(raw.length)
    c.u16(nameBytes.length)
    c.u16(0)
    c.u16(0)
    c.u16(0)
    c.u16(0)
    c.u32(0)
    c.u32(offset)
    c.push(nameBytes)
    central.push(c.concat())
    count++
  }

  const centralStart = w.length
  for (const c of central) w.push(c)
  const centralSize = w.length - centralStart

  // End of central directory
  w.u32(0x06054b50)
  w.u16(0)
  w.u16(0)
  w.u16(count)
  w.u16(count)
  w.u32(centralSize)
  w.u32(centralStart)
  w.u16(0)

  return w.concat()
}
