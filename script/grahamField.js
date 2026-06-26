import { Parser } from 'json2csv'
import { eachOfLimit } from 'async'
import { load } from 'cheerio'
import csv from 'csvtojson'
import { writeFile } from 'fs/promises'

const BASE = 'https://shop.grahamfield.com'

// ─── Auth ──────────────────────────────────────────────────────────────────
// Only the Cloudflare cf_clearance cookie below is essential — the script logs
// itself in (form POST) to obtain a fresh .ASPXAUTH session each run, so stale
// auth cookies here don't matter. Paste a fresh cookie from your logged-in
// browser (DevTools → Network → any request → Request Headers → Cookie).
// cf_clearance is short-lived and bound to the SAME User-Agent + your IP, so
// when requests start coming back as Cloudflare challenge HTML, refresh it.
const USERNAME = 'CTHH87D.Aziz'
const PASSWORD = 'MESmay2026'

const cookie =
  'CulturePref=en-US; cf_clearance=pux9A4dB94ucqeE0JNRx26jV8aZObtAaKqrfOP06Sqw-1780050102-1.2.1.1-VqEyRuZiqs8vh2fLXoD3iXyEEWggey_QFbapi0kHXk6XWMRMmQsj9uxqEMG1ZQ64TBxWmNDl_mXXFETGTZX_f9mAZBbjUDpZf8B_wBrrBndIEr6xrg014X5OT.moYwanyJnHUQINdx6k7vkGjD_2hmzoH98u1XWphk_1TOYufo6bRC1eq31RQEo_rkfEwKJ_Nzu.cNeXQvhzSfhV1n9Ak0f9KjFv5Bp4jYpCJuimYtcr_s2I2I3HL45WxRKkZHyU1qGDyKAu2kObhTA5VRpfAE45zMwz4t.mM.sy_usPiOf6Q1jRfRiPcGAyriqGiGRBjiODX.twkWMx_U7r3afNSYM3bc7B1x8u_UCB3hsyGCytb2W1qEyaW31PHJucmeF52IsqMvyBz3jDgcVzxQ2EHVuSnSV.pSle9135HJ9k3.k; ASP.NET_SessionId=xshvgtrmrbxfwrffqv4ar455; .ASPXAUTH=4E1C452CE450787730E5D8D93D2023C17A1FDA1E29F58BD246B99F5D6647983E96FED51C3874D9C961EC6BB2801557E2F97B1DF06DB4E833AC97BA7682459F2FC314AAD1CB67FF4E65E29E9D1687693F86141536B5CBAD668DD89D44842F9007780F2A07B4F904FF701290B440BFFF6A74DCDF0C; username=CTHH87D.Aziz'

const userAgent =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

// ── cookie jar ──────────────────────────────────────────────────────────────
// Seed from the pasted cookie (we keep cf_clearance / __cf_* / session), but
// drop any stale auth — login() sets a fresh .ASPXAUTH.
const jar = {}
const addCookies = str => {
  for (const part of str.split(';')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k) jar[k] = v
  }
}
addCookies(cookie)
delete jar['.ASPXAUTH']
delete jar['username']

const cookieHeader = () =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')

const mergeSetCookie = (setCookies = []) => {
  for (const sc of setCookies) {
    const pair = sc.split(';')[0]
    const i = pair.indexOf('=')
    if (i === -1) continue
    const k = pair.slice(0, i).trim()
    const v = pair.slice(i + 1).trim()

    if (k && v && v !== 'deleted') jar[k] = v
  }
}

const H = extra => ({
  'User-Agent': userAgent,
  Cookie: cookieHeader(),
  ...extra
})

// ? format the string and remove shit
const formatString = str =>
  str
    .replaceAll('\t', ' ')
    .replaceAll('\n', ' ')
    .replaceAll('&nbsp;', ' ')
    .trim()
    .replaceAll(/[\s]{2,}/g, '<->')

const fetchHtml = async url => {
  const res = await fetch(url, { headers: H() })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return load(await res.text())
}

// Log in via the ASP.NET WebForms form-post and capture the .ASPXAUTH cookie.
const login = async () => {
  const url = `${BASE}/Content/logon.aspx?ReturnUrl=%2fcontent%2fHome.aspx`
  let res = await fetch(url, { headers: H() })
  mergeSetCookie(res.headers.getSetCookie?.() ?? [])
  const $ = load(await res.text())

  // carry every hidden field (__VIEWSTATE etc.) through, then fill credentials
  const form = {}
  $('form input').each((_, el) => {
    const name = $(el).attr('name')
    if (name) form[name] = $(el).attr('value') ?? ''
  })
  const uName = Object.keys(form).find(n => /txtUsername$/.test(n))
  const pName = Object.keys(form).find(n => /txtPassword$/.test(n))
  if (!uName || !pName) {
    throw new Error(
      'Login form not found — Cloudflare is likely blocking the request. Refresh cf_clearance in the cookie above.'
    )
  }
  form[uName] = USERNAME
  form[pName] = PASSWORD

  res = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: H({
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BASE,
      Referer: url
    }),
    body: new URLSearchParams(form).toString()
  })
  mergeSetCookie(res.headers.getSetCookie?.() ?? [])

  if (!jar['.ASPXAUTH']) {
    throw new Error(
      `Login failed (status ${res.status}) — check USERNAME/PASSWORD and that cf_clearance is fresh.`
    )
  }
}

// Price + inventory are served by an ASP.NET ScriptService (.asmx). The product
// page calls MplaceV2.GetPriceInfo / GetInventoryInfo; both POST JSON and return
// { d: { PriceInfoHTML | InventoryInfoHTML, ... } }.
const callMplace = async (method, inventoryItemId, quantity, referer) => {
  const res = await fetch(`${BASE}/ContentSecureWS/Mplacev2.asmx/${method}`, {
    method: 'POST',
    headers: H({
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: BASE,
      Referer: referer
    }),
    body: JSON.stringify({
      InventoryItemID: Number(inventoryItemId),
      Quantity: String(quantity),
      GenericWebServiceInput: { NameValuePairs: { MessageControlID: 'lbl' } }
    })
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${method}`)
  return (await res.json())?.d
}

const getProductPriceAndInventory = async mpn => {
  // 1) search by MPN → product link
  const $search = await fetchHtml(
    `${BASE}/content/search.aspx?searchtext=${encodeURIComponent(mpn)}`
  )

  const link = $search('#ctl00_cphContent_dlStockCodeMatches a')
    .first()
    .attr('href')

  if (!link) return null

  const productUrl = BASE + link

  // 2) product page → packaging + the inventory row that matches this MPN, and
  //    its InventoryItemID (hidden field the price/inventory web service needs)
  const $ = await fetchHtml(productUrl)

  let inventoryItemId = null
  let packaging = ''
  let upc = ''
  let hcpcs = ''

  $('.inventory.ProductInventory').each((_, el) => {
    if (inventoryItemId) return
    const stockCode = $('input[id*="hdnStockCode"]', el).val()
    const displayName = formatString($(el).text()).split('<->')[0]
    if (stockCode === mpn || displayName === mpn) {
      inventoryItemId = $('input[id*="hdnInventoryItemID"]', el).val()
      hcpcs = $('div:nth-child(4)', el).text().trim()
      upc = $('div:nth-child(5)', el).text().trim()
      packaging = $('div:nth-child(6)', el).text().trim()
    }
  })
  if (!inventoryItemId) return null

  // 3) price + stock status via the secure ScriptService (.asmx)
  let price = ''
  let stockStatus = ''
  try {
    const priceData = await callMplace(
      'GetPriceInfo',
      inventoryItemId,
      1,
      productUrl
    )
    const $price = load(priceData?.PriceInfoHTML ?? '')
    // price sits in the last <b> that carries a currency amount, e.g. "$218.50 CS"
    price =
      $price('b')
        .map((_, e) => formatString($price(e).text()))
        .get()
        .reverse()
        .find(t => t.includes('$')) ?? ''
  } catch (err) {
    console.error(`price ${mpn}:`, err.message)
  }
  try {
    const invData = await callMplace(
      'GetInventoryInfo',
      inventoryItemId,
      1,
      productUrl
    )
    const $inv = load(invData?.InventoryInfoHTML ?? '')
    const rows = $inv('table.InventoryTableInPopup tr')
      .map((_, e) => formatString($inv(e).text()))
      .get()
    const firstDataRow = rows[1]?.split('<->')[0] ?? '' // rows[0] is the header
    if (firstDataRow) {
      stockStatus = firstDataRow.includes('Backorder')
        ? 'Out of Stock'
        : 'Available'
    }
  } catch (err) {
    console.error(`inventory ${mpn}:`, err.message)
  }

  // packaging → UOM split
  let packagingUom = ''
  const splitted1 = packaging.split(' ')
  const splitted2 = packaging.split('/')
  if (splitted1.length > 1) {
    packagingUom = splitted1[0]
    packaging = splitted1[1]
  } else if (splitted2.length > 1) {
    packagingUom = splitted2[0]
    packaging = splitted2[1]
  }

  // PDFs
  const pdfs = new Set()
  $('.product-tab a').each((_, el) => {
    const href = $(el).attr('href')
    if (href && href.toLowerCase().includes('.pdf')) pdfs.add(`${BASE}${href}`)
  })

  // Product images: the gallery (ProductImageItem*) + main image (InventoryItem*)
  // inside #cBody. The page shows small thumbnails (_75/_100), but the server
  // also serves a full-size _2000 of each, so we normalize every image to that.
  // (ProductAdditionalInfoItem thumbnails are skipped — those are the PDF icons.)
  const imageKeys = new Set()
  $('#cBody img').each((_, el) => {
    const s = $(el).attr('src') || $(el).attr('data-src') || ''
    const m = s.match(/\/((?:ProductImageItem|InventoryItem)\d+)_\d+\.jpg/i)
    if (m) imageKeys.add(m[1])
  })
  const images = [...imageKeys].map(
    key => `${BASE}/nosync/productimagesV2/2000/${key}_2000.jpg`
  )

  return {
    url: productUrl,
    packaging,
    packagingUom,
    upc,
    hcpcs,
    stockStatus,
    price,
    pdfs: Array.from(pdfs),
    images
  }
}

export const grahamFieldUpdate = async ({ fileName, url }) => {
  console.time('main')
  let data = []
  if (fileName) {
    data = await csv().fromFile(fileName)
  } else if (url) {
    data = await csv().fromString(
      await (await fetch(url, { headers: H() })).text()
    )
  }

  await login()
  console.log(`Logged in. Processing ${data.length} items...`)

  // Keep concurrency modest — too many parallel requests is what trips
  // Cloudflare rate limiting. Bump it once you confirm requests get through.
  await eachOfLimit(data, 3, async (item, i) => {
    console.log(`${i + 1} / ${data.length}: ${item['Graham Field ITEM #']}`)
    try {
      item.error = false
      // ? For getting url and inventory code for new products in csv
      if (!item.url) {
        const result = await getProductPriceAndInventory(
          item['Graham Field ITEM #']
        )
        if (result) {
          item.url = result.url
          item['Packaging'] = result.packaging
          item['Packaging UOM'] = result.packagingUom
          item['UPC'] = result.upc
          item['HCPCS'] = result.hcpcs
          item['Stock Status'] = result.stockStatus
          item['Price'] = result.price
          result.pdfs.forEach((pdf, idx) => {
            item[`PDF ${idx + 1}`] = pdf
          })
          // Only the first (main) image goes into a single Image column.
          if (result.images.length) {
            item['Image'] = result.images[0]
          }
        }
      }
    } catch (err) {
      console.error(err)
      item.error = true
    }
  })

  // Build a stable column order: base fields first (in first-seen order), then
  // all PDF columns. Without this, json2csv interleaves them per-row since
  // items have different PDF counts. (Image is a single base column now.)
  const isIndexed = k => /^PDF \d+$/.test(k)
  const baseFields = []
  for (const item of data) {
    for (const key of Object.keys(item)) {
      if (!isIndexed(key) && !baseFields.includes(key)) baseFields.push(key)
    }
  }
  const countOf = prefix =>
    Math.max(
      0,
      ...data.map(
        item =>
          Object.keys(item).filter(k => new RegExp(`^${prefix} \\d+$`).test(k))
            .length
      )
    )
  const seq = (prefix, n) =>
    Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`)
  const fields = [...baseFields, ...seq('PDF', countOf('PDF'))]

  const parser = new Parser({ fields })
  const csvFile = parser.parse(data)

  await writeFile(`graham_field_updated_price-${Date.now()}.csv`, csvFile)
  console.timeEnd('main')
}

grahamFieldUpdate({ fileName: 'grahamfield.csv' })
