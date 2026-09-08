/**
 * Just enough ZIP to read the exports people actually send.
 *
 * Swordfish's action report is forty-six megabytes, which means it arrives zipped roughly every
 * time — and .xlsx is itself a zip, so one reader covers both. Written rather than installed
 * because the requirement is narrow: list the entries, inflate one of them. A library would
 * bring encryption, spanning, ZIP64 writing and a hundred kilobytes of code for a job that is
 * two headers and a DecompressionStream.
 *
 * What it does NOT do: encrypted archives, multi-part archives, or compression methods other
 * than store and deflate. Each is rejected by name rather than producing wrong bytes quietly.
 */

export interface ZipEntry {
  name: string
  compressedSize: number
  uncompressedSize: number
  /** 0 = stored, 8 = deflate. Anything else is refused. */
  method: number
  offset: number
}

const EOCD = 0x06054b50
const EOCD64_LOCATOR = 0x07064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

/**
 * The entries in an archive, read from its central directory.
 *
 * The directory lives at the END of a zip, which is what makes the format streamable to write
 * and awkward to read: the end-of-central-directory record has to be found by scanning backwards
 * for its signature, because it is followed by a comment of arbitrary length.
 */
export function readZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer)

  // The comment can be up to 64KB, so that is how far back the signature can be.
  let eocd = -1
  const from = Math.max(0, buffer.byteLength - 0x10000 - 22)
  for (let i = buffer.byteLength - 22; i >= from; i--) {
    if (view.getUint32(i, true) === EOCD) { eocd = i; break }
  }
  if (eocd === -1) throw new Error('Not a zip file, or the archive is truncated.')

  let count = view.getUint16(eocd + 10, true)
  let directoryOffset = view.getUint32(eocd + 16, true)

  /*
   * ZIP64. An archive with more than 65,535 entries, or one crossing 4GB, stores the real counts
   * in a second record and leaves 0xFFFF / 0xFFFFFFFF as sentinels in the original fields.
   * Reading the sentinel as a real offset lands in the middle of the file and produces a
   * confusing failure some way further on, so it is resolved here.
   */
  if (count === 0xffff || directoryOffset === 0xffffffff) {
    let locator = -1
    for (let i = eocd - 20; i >= 0; i--) {
      if (view.getUint32(i, true) === EOCD64_LOCATOR) { locator = i; break }
    }
    if (locator === -1) throw new Error('This archive needs ZIP64 and its ZIP64 record is missing.')
    const eocd64 = Number(view.getBigUint64(locator + 8, true))
    count = Number(view.getBigUint64(eocd64 + 32, true))
    directoryOffset = Number(view.getBigUint64(eocd64 + 48, true))
  }

  const entries: ZipEntry[] = []
  let p = directoryOffset
  const decoder = new TextDecoder('utf-8')
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CENTRAL) break
    const method = view.getUint16(p + 10, true)
    const compressedSize = view.getUint32(p + 20, true)
    const uncompressedSize = view.getUint32(p + 24, true)
    const nameLength = view.getUint16(p + 28, true)
    const extraLength = view.getUint16(p + 30, true)
    const commentLength = view.getUint16(p + 32, true)
    const offset = view.getUint32(p + 42, true)
    const name = decoder.decode(new Uint8Array(buffer, p + 46, nameLength))
    entries.push({ name, method, compressedSize, uncompressedSize, offset })
    p += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** One entry's bytes, decompressed. */
export async function readZipEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buffer)
  if (view.getUint32(entry.offset, true) !== LOCAL) {
    throw new Error(`"${entry.name}" is not where the archive says it is.`)
  }
  // The local header repeats the name and may carry a different extra field to the central one,
  // so its own lengths decide where the data starts.
  const nameLength = view.getUint16(entry.offset + 26, true)
  const extraLength = view.getUint16(entry.offset + 28, true)
  const start = entry.offset + 30 + nameLength + extraLength
  const raw = new Uint8Array(buffer, start, entry.compressedSize)

  if (entry.method === 0) return raw
  if (entry.method !== 8) {
    throw new Error(`"${entry.name}" uses compression method ${entry.method}, which is not deflate or stored.`)
  }
  // 'deflate-raw' rather than 'deflate': a zip entry has no zlib header around it.
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * The single CSV inside an archive.
 *
 * Deliberately refuses an archive holding more than one, rather than picking the first: which
 * export was meant is not something to guess about when the answer decides what gets imported.
 * Directory entries and the junk macOS puts in zips (__MACOSX, .DS_Store) are ignored.
 */
export async function readSingleCsvFromZip(buffer: ArrayBuffer): Promise<string> {
  const candidates = readZipEntries(buffer).filter(
    (e) => /\.csv$/i.test(e.name) && !e.name.endsWith('/') && !e.name.startsWith('__MACOSX/'),
  )
  if (candidates.length === 0) throw new Error('That zip has no .csv file in it.')
  if (candidates.length > 1) {
    throw new Error(
      `That zip holds ${candidates.length} CSVs (${candidates.map((c) => c.name).join(', ')}). `
      + 'Unzip it and pick the one you want.',
    )
  }
  const bytes = await readZipEntry(buffer, candidates[0])
  return new TextDecoder('utf-8').decode(bytes)
}
