'use strict'

/**
 * Use case: ReadTextHead
 *
 * The first N bytes of a text file, decoded, for the preview pane. This exists so a
 * multi-gigabyte log opens instantly and a binary file never reaches the renderer.
 *
 * Ports used: FileReader (readHead).
 */

const DEFAULT_BYTES = 64 * 1024

/**
 * @param {{ fileReader: { readHead: (p: string, n: number) => Promise<{ buffer: Buffer, truncated: boolean }> } }} deps
 */
async function readTextHead({ fileReader }, filePath, maxBytes = DEFAULT_BYTES) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return { ok: false, error: 'A file path is required.' }
  }

  try {
    const { buffer, truncated } = await fileReader.readHead(filePath, maxBytes)
    const decoded = decode(buffer)

    return {
      ok: true,
      path: filePath,
      text: decoded.text,
      encoding: decoded.encoding,
      truncated: truncated || decoded.hadInvalidBytes,
      // `hadInvalidBytes` matters: a file that claims .txt but holds binary should be
      // reported as truncated rather than silently showing replacement characters.
      looksBinary: decoded.hadInvalidBytes
    }
  } catch (error) {
    return { ok: false, path: filePath, error: describeReadFailure(error, filePath) }
  }
}

/**
 * Decode as UTF-8. A UTF-8 BOM is stripped; invalid sequences are replaced rather
 * than throwing, and the fact that they appeared is reported to the caller.
 */
function decode(buffer) {
  let bytes = buffer
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bytes = bytes.subarray(3) // UTF-8 BOM
  }

  // A NUL byte in the first block is the cheapest reliable binary signal.
  const sample = bytes.subarray(0, 8192)
  let nulCount = 0
  for (const byte of sample) if (byte === 0) nulCount += 1
  const hadInvalidBytes = nulCount > 0

  return {
    text: bytes.toString('utf8').replace(/\uFFFD/g, ''),
    encoding: 'utf-8',
    hadInvalidBytes
  }
}

function describeReadFailure(error, filePath) {
  switch (error?.code) {
    case 'ENOENT':
      return `That file no longer exists: ${filePath}`
    case 'EACCES':
    case 'EPERM':
      return `You do not have permission to read: ${filePath}`
    case 'EISDIR':
      return `That is a folder, not a file: ${filePath}`
    case 'EBUSY':
      return `That file is in use by another program: ${filePath}`
    default:
      return `Could not read that file (${error?.code || 'unknown error'}): ${filePath}`
  }
}

module.exports = { readTextHead, decode, DEFAULT_BYTES }
