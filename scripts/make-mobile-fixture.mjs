// Generate a tiny CSPAPER mobile fixture in memory. The repository does not need a 10 MB binary sample.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let value = n
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[n] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function minimalPdf(title, paragraph) {
  const escapedTitle = title.replace(/([\\()])/g, '\\$1')
  const escapedParagraph = paragraph.replace(/([\\()])/g, '\\$1')
  const sentences = escapedParagraph.match(/[^.]+(?:\.|$)/g) ?? []
  const content = [
    'BT /F1 18 Tf 72 720 Td 38.0524 TL',
    `(${escapedTitle}) Tj T* 14 TL`,
    ...sentences.map(sentence => `(${sentence.trim()}) Tj T*`),
    '(This mobile fixture verifies offline rendering, text extraction, status memory, and bilingual reading.) Tj',
    'ET'
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
  ]
  let pdf = Buffer.from('%PDF-1.4\n%', 'latin1')
  const offsets = [0]
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf = Buffer.concat([pdf, Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1')])
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) tail += `${String(offset).padStart(10, '0')} 00000 n \n`
  tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.concat([pdf, Buffer.from(tail, 'latin1')])
}

function createZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data)
    const crc = crc32(data)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    locals.push(local, data)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)
    offset += local.length + data.length
  }
  const centralBuffer = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuffer, eocd])
}

export function createSamplePack() {
  const papers = Array.from({ length: 6 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0')
    const slug = `mobile-fixture-${number}`
    return {
      slug,
      title: `Mobile fixture paper ${number}`,
      authors: `Research Author ${number}`,
      year: 2024 + (index % 3),
      venue: 'CSPAPER Fixture Journal',
      category: 'Mobile regression',
      status: 'unread',
      pdf: `pdfs/${slug}.pdf`
    }
  })
  const entries = papers.map(paper => ({
    name: paper.pdf,
    data: minimalPdf(paper.title, `Paper ${paper.slug} contains a deterministic first paragraph with sufficient length to force the mobile bilingual reader to split extracted text into multiple sentence groups instead of collapsing the whole page into one block. The second sentence describes offline rendering, text extraction, status memory, translation caching, and zoom behavior. The third sentence adds deterministic vocabulary about portable libraries, page coordinates, archived highlights, deterministic assertions, and stable fixtures so the total extracted text safely exceeds the grouping threshold during the mobile regression.`)
  }))
  entries.push({
    name: 'library.json',
    data: Buffer.from(JSON.stringify({ format: 1, app: 'CSPAPER', exportedAt: 'mobile-regression', papers, highlights: [] }, null, 1), 'utf8')
  })
  return createZip(entries)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2]
  if (!output) {
    console.error('Usage: node scripts/make-mobile-fixture.mjs <output.cspack>')
    process.exit(1)
  }
  const pack = createSamplePack()
  fs.writeFileSync(output, pack)
  console.log(`mobile fixture OK: 6 papers, ${pack.length} bytes -> ${output}`)
}
