import { readFile } from 'fs/promises'
import { load } from 'cheerio'

const src = await readFile(new URL('./grahamField.js', import.meta.url), 'utf8')
const fullCookie = src.match(/const cookie =\s*'([^']*)'/)?.[1]
const userAgent = src.match(/const userAgent =\s*'([^']*)'/)?.[1]
const pick = name =>
  (fullCookie.match(new RegExp(name.replace('.', '\\.') + '=([^;]+)')) || [])[1]

let jar = { CulturePref: 'en-US', cf_clearance: pick('cf_clearance') }
const cookieStr = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
const merge = (sc = []) => {
  for (const c of sc) {
    const p = c.split(';')[0]
    const i = p.indexOf('=')
    const k = p.slice(0, i).trim()
    const v = p.slice(i + 1).trim()
    if (v && v !== 'deleted') jar[k] = v
  }
}
const H = e => ({ 'User-Agent': userAgent, Cookie: cookieStr(), ...e })
const ORIGIN = 'https://shop.grahamfield.com'
const LOGON = `${ORIGIN}/Content/logon.aspx?ReturnUrl=%2fcontent%2fHome.aspx`

let res = await fetch(LOGON, { headers: H() })
merge(res.headers.getSetCookie?.() || [])
let $ = load(await res.text())
const form = {}
$('form input').each((_, el) => { const n = $(el).attr('name'); if (n) form[n] = $(el).attr('value') || '' })
form[Object.keys(form).find(n => /txtUsername$/.test(n))] = 'CTHH87D.Aziz'
form[Object.keys(form).find(n => /txtPassword$/.test(n))] = 'MESmay2026'
res = await fetch(LOGON, { method: 'POST', redirect: 'manual', headers: H({ 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN, Referer: LOGON }), body: new URLSearchParams(form).toString() })
merge(res.headers.getSetCookie?.() || [])

// multi-SKU page: 3-in-1 Aluminum Commode (p=2551) — inventory items 5150 & 19173
const productUrl = `${ORIGIN}/Medical_Product/3-in-1_Aluminum_Commode.aspx?b=0&s=0&c=0&g=0&p=2551&v=1`
res = await fetch(productUrl, { headers: H() })
$ = load(await res.text())

console.log('=== inventory rows (SKUs) on this page ===')
$('.inventory.ProductInventory').each((i, el) => {
  const code = $('input[id*="hdnStockCode"]', el).val()
  const id = $('input[id*="hdnInventoryItemID"]', el).val()
  console.log(`row ${i}: stockCode=${code} inventoryItemID=${id}`)
})

console.log('\n=== for each product/inventory image, walk up to nearest stock-code context ===')
$('img').each((_, el) => {
  const s = $(el).attr('src') || $(el).attr('data-src') || ''
  const m = s.match(/\/((?:ProductImageItem|InventoryItem)\d+)_\d+\.jpg/i)
  if (!m) return
  // walk ancestors to find a container that also holds a hdnStockCode
  let node = $(el)
  let foundCode = null
  let depth = 0
  while (node.length && depth < 12) {
    const code = node.find('input[id*="hdnStockCode"]').first().val()
    if (code) { foundCode = code; break }
    node = node.parent()
    depth++
  }
  console.log(`img ${m[1]} -> nearest stockCode: ${foundCode ?? '(none)'} (up ${depth} levels)`)
})

console.log('\n=== is there a per-SKU image container? show ancestry of one InventoryItem img ===')
const target = $('img').filter((_, e) => /InventoryItem19173_/.test($(e).attr('src') || '')).first()
let n = target, chain = []
for (let d = 0; n.length && d < 8; d++, n = n.parent()) {
  const tag = n[0]?.tagName
  const id = n.attr('id')
  const cls = n.attr('class')
  chain.push(`${tag}${id ? '#' + id : ''}${cls ? '.' + cls.split(' ').slice(0,2).join('.') : ''}`)
}
console.log(chain.join('  >  '))
