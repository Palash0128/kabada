import fsp from 'fs/promises'
import fs from 'fs'
import https from 'https'
import path from 'path'
import { fileURLToPath } from 'url'

// ─── ES Module __dirname ─────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ─── CLI Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const getArg = flag => {
  const idx = args.indexOf(flag)
  return idx !== -1 ? args[idx + 1] : null
}

const INPUT_FILE = getArg('--input') || path.join(__dirname, 'yt.json')
const OUTPUT_FILE =
  getArg('--output') || path.join(__dirname, 'invalid_links_report.json')
const CONCURRENCY = 10 // simultaneous requests

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract YouTube video ID from various URL formats:
 *  - https://www.youtube.com/embed/VIDEO_ID
 *  - https://www.youtube.com/embed/VIDEO_ID?si=...
 *  - https://youtu.be/VIDEO_ID
 *  - https://www.youtube.com/watch?v=VIDEO_ID
 */
function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null

  try {
    const parsed = new URL(url.trim())
    const host = parsed.hostname.replace('www.', '')

    if (host === 'youtube.com') {
      // /embed/VIDEO_ID
      const embedMatch = parsed.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})/)
      if (embedMatch) return embedMatch[1]

      // /watch?v=VIDEO_ID
      const v = parsed.searchParams.get('v')
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v

      // /shorts/VIDEO_ID
      const shortsMatch = parsed.pathname.match(
        /^\/shorts\/([a-zA-Z0-9_-]{11})/
      )
      if (shortsMatch) return shortsMatch[1]
    }

    if (host === 'youtu.be') {
      const idMatch = parsed.pathname.match(/^\/([a-zA-Z0-9_-]{11})/)
      if (idMatch) return idMatch[1]
    }
  } catch {
    return null // not a valid URL at all
  }

  return null
}

/**
 * Validate structural/format issues before making any network request.
 * Returns { valid: true } or { valid: false, reason: "..." }
 */
function validateFormat(url) {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return { valid: false, reason: 'URL is empty or missing' }
  }

  let parsed
  try {
    parsed = new URL(url.trim())
  } catch {
    return { valid: false, reason: 'Malformed URL (cannot be parsed)' }
  }

  const host = parsed.hostname.replace('www.', '')
  const validHosts = ['youtube.com', 'youtu.be']
  if (!validHosts.includes(host)) {
    return {
      valid: false,
      reason: `Not a YouTube URL (host: ${parsed.hostname})`
    }
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    return { valid: false, reason: `Invalid protocol: ${parsed.protocol}` }
  }

  const videoId = extractVideoId(url)
  if (!videoId) {
    return {
      valid: false,
      reason: 'Could not extract a valid YouTube video ID from URL'
    }
  }

  return { valid: true, videoId }
}

/**
 * Check if a YouTube video is accessible via the oEmbed API.
 * oEmbed returns 404 for unavailable/private/deleted videos without needing an API key.
 */
function checkVideoAvailability(videoId) {
  return new Promise(resolve => {
    const oEmbedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`

    const req = https.get(oEmbedUrl, { timeout: 10000 }, res => {
      // Consume response body to free socket
      res.resume()

      if (res.statusCode === 200) {
        resolve({ available: true })
      } else if (res.statusCode === 401) {
        resolve({ available: false, reason: 'Video is private' })
      } else if (res.statusCode === 403) {
        resolve({
          available: false,
          reason: 'Video is restricted / embedding disabled'
        })
      } else if (res.statusCode === 404) {
        resolve({
          available: false,
          reason: 'Video not found (deleted or never existed)'
        })
      } else {
        resolve({
          available: false,
          reason: `Unexpected HTTP status: ${res.statusCode}`
        })
      }
    })

    req.on('timeout', () => {
      req.destroy()
      resolve({ available: false, reason: 'Request timed out' })
    })

    req.on('error', err => {
      resolve({ available: false, reason: `Network error: ${err.message}` })
    })
  })
}

/**
 * Run tasks with limited concurrency.
 */
async function runWithConcurrency(tasks, limit) {
  const results = []
  let index = 0

  async function worker() {
    while (index < tasks.length) {
      const current = index++
      results[current] = await tasks[current]()
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker)
  await Promise.all(workers)
  return results
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load JSON
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌  Input file not found: ${INPUT_FILE}`)
    process.exit(1)
  }

  let data
  try {
    data = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'))
  } catch (e) {
    console.error(`❌  Failed to parse JSON: ${e.message}`)
    process.exit(1)
  }

  if (!Array.isArray(data)) {
    console.error('❌  Expected a JSON array at the root of the file.')
    process.exit(1)
  }

  console.log(`\n📂  Loaded ${data.length} records from ${INPUT_FILE}`)
  console.log(`🔍  Validating links (concurrency: ${CONCURRENCY})...\n`)

  const invalid = []
  let checked = 0

  // 2. Build tasks
  const tasks = data.map(entry => async () => {
    const { productId, youtubeUrl } = entry
    checked++

    process.stdout.write(`\r⏳  Progress: ${checked}/${data.length}`)

    // ── Format validation (no network) ──────────────────────────────────────
    const formatCheck = validateFormat(youtubeUrl)
    if (!formatCheck.valid) {
      return {
        productId: productId ?? '(missing productId)',
        youtubeUrl: youtubeUrl ?? null,
        errorReason: formatCheck.reason,
        errorType: 'FORMAT_ERROR'
      }
    }

    // ── Availability check (network) ─────────────────────────────────────────
    const availability = await checkVideoAvailability(formatCheck.videoId)
    if (!availability.available) {
      return {
        productId: productId ?? '(missing productId)',
        youtubeUrl,
        videoId: formatCheck.videoId,
        errorReason: availability.reason,
        errorType: 'AVAILABILITY_ERROR'
      }
    }

    return null // valid
  })

  const results = await runWithConcurrency(tasks, CONCURRENCY)

  // 3. Filter invalid
  for (const r of results) {
    if (r !== null) invalid.push(r)
  }

  process.stdout.write('\n\n')

  // 4. Report
  const report = {
    generatedAt: new Date().toISOString(),
    inputFile: INPUT_FILE,
    totalRecords: data.length,
    validCount: data.length - invalid.length,
    invalidCount: invalid.length,
    invalidLinks: invalid
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2), 'utf8')

  // ── Console summary ─────────────────────────────────────────────────────────
  console.log('═'.repeat(55))
  console.log('  VALIDATION REPORT SUMMARY')
  console.log('═'.repeat(55))
  console.log(`  Total records  : ${data.length}`)
  console.log(`  ✅ Valid        : ${data.length - invalid.length}`)
  console.log(`  ❌ Invalid      : ${invalid.length}`)
  console.log('─'.repeat(55))

  if (invalid.length > 0) {
    console.log('\n  INVALID ENTRIES:\n')
    invalid.forEach((entry, i) => {
      console.log(`  ${i + 1}. Product ID  : ${entry.productId}`)
      console.log(`     URL         : ${entry.youtubeUrl}`)
      console.log(`     Error Type  : ${entry.errorType}`)
      console.log(`     Reason      : ${entry.errorReason}`)
      console.log()
    })
  } else {
    console.log('\n  🎉 All YouTube links are valid!\n')
  }

  console.log(`📄  Full report saved to: ${OUTPUT_FILE}\n`)
}

main().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
