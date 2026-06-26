import { eachOfLimit } from 'async'
import { load } from 'cheerio'
import { writeFile } from 'fs/promises'
import { Parser } from 'json2csv'

const BASE = 'https://shop.drivemedical.com'

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'

// Drive Medical paginates category listings 18 products per page.
const PAGE_SIZE = 18

const fetchHtml = async url => {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status} for ${url}`)
  return load(await res.text())
}

// Collect every product category from the Drive Medical "PRODUCTS" mega-menu.
//
// This generalizes the browser-copied selector
//   #submenu > div.submenu-wrapper > div > div:nth-child(N) > a:nth-child(M)
// by iterating instead of hard-coding the nth-child numbers:
//   .sub-navigation-section        → every group  (the div:nth-child)
//     .title > a                   → the group heading (e.g. "Bath Safety")
//     ul.sub-navigation-list a     → every category link (the a:nth-child;
//                                     real categories have /c/ in the href)
// Returns { group, name, link }[].
const getCategoryLinks = async () => {
  const $ = await fetchHtml(`${BASE}/us/en`)

  const categories = []
  const seen = new Set()

  $('.sub-navigation-section').each((_, section) => {
    const group = $(section).find('.title > a').first().text().trim()

    $(section)
      .find('ul.sub-navigation-list a[href*="/c/"]')
      .each((_, a) => {
        const href = $(a).attr('href')
        if (!href || seen.has(href)) return
        seen.add(href)

        categories.push({
          group,
          name: $(a).text().trim().replace(/\s+/g, ' '),
          link: href.startsWith('http') ? href : `${BASE}${href}`
        })
      })
  })

  return categories
}

// Write all categories (group + name + link) to a CSV. Run this alone when you
// only want the category list; the full product scrape (run) doesn't need it.
const scrapeDriveMedicalCategories = async () => {
  const categories = await getCategoryLinks()

  const parser = new Parser({ fields: ['group', 'name', 'link'] })
  await writeFile(
    'Drive Medical categories.csv',
    '﻿' + parser.parse(categories)
  )

  console.info(
    `Wrote ${categories.length} categories to "Drive Medical categories.csv"`
  )
}

// Walk one category's paginated product grid and return one entry per SKU,
// each tagged with the product name from its listing tile.
//
// Each tile is a `.details` block with two parts:
//   .details > a > p   → the product name (the user's selector for name)
//   .details > div a   → one or more <a> variant SKU links
// All variants under a tile share the same product name. Listing pages use
// `?q=:relevance&page=N` (0-indexed); a page with fewer than PAGE_SIZE tiles
// is the last one.
const scrapeCategorySkus = async category => {
  const products = []
  const seen = new Set()

  for (let page = 0; ; page++) {
    const url = `${category.link}?q=%3Arelevance&page=${page}`

    // The listing backend occasionally returns an empty grid for an in-range
    // page, so retry a few times before treating empty as the end of the list.
    let tiles = 0
    let pageProducts = []
    for (let attempt = 0; attempt < 3 && tiles === 0; attempt++) {
      const $ = await fetchHtml(url)
      const $tiles = $('.product__list--wrapper .details')
      tiles = $tiles.length
      pageProducts = []
      $tiles.each((_, el) => {
        const name = $(el)
          .children('a')
          .children('p')
          .first()
          .text()
          .trim()
          .replace(/\s+/g, ' ')
        $(el)
          .find('> div a')
          .each((_, a) => {
            const sku = $(a).text().trim()
            if (sku) pageProducts.push({ sku, name })
          })
      })
    }

    if (tiles === 0) break // no products → past the last page

    for (const p of pageProducts) {
      if (!seen.has(p.sku)) {
        seen.add(p.sku)
        products.push(p)
      }
    }

    if (tiles < PAGE_SIZE) break // partial page → last page
  }

  return products
}

// Walk every category and gather the de-duplicated set of SKUs across the site.
// Writes a `Drive Medical skus.csv` checkpoint (so the product scrape can be
// rerun without re-crawling) and returns the flat SKU list for main().
const getAllSkus = async () => {
  const categories = await getCategoryLinks()
  console.info(`Found ${categories.length} categories. Collecting SKUs...`)

  const rows = []
  const seen = new Set()

  await eachOfLimit(categories, 3, async (category, i) => {
    try {
      const products = await scrapeCategorySkus(category)
      for (const { sku, name } of products) {
        if (!seen.has(sku)) {
          seen.add(sku)
          rows.push({
            sku,
            category: category.name,
            group: category.group,
            name
          })
        }
      }
      console.info(
        `[${Number(i) + 1}/${categories.length}] ${category.name}: ${
          products.length
        } skus`
      )
    } catch (err) {
      console.error(`Failed category "${category.name}":`, err.message)
    }
  })

  const parser = new Parser({ fields: ['sku', 'category', 'group', 'name'] })
  await writeFile('Drive Medical skus.csv', '﻿' + parser.parse(rows))
  console.info(
    `Collected ${rows.length} unique SKUs → "Drive Medical skus.csv"`
  )

  return rows
}

// Build category/name rows for only the SKUs we actually want to scrape.
// This keeps the final price scrape limited to the array below, while still
// using Drive Medical's listing pages to fill product metadata.
const getSkuInfoForSkus = async skus => {
  const targetSkus = [...new Set(skus)]
  const targetSet = new Set(targetSkus)
  const found = new Map()
  const categories = await getCategoryLinks()

  console.info(
    `Finding category/name for ${targetSkus.length} requested SKUs...`
  )

  for (let i = 0; i < categories.length && found.size < targetSkus.length; i++) {
    const category = categories[i]

    try {
      const products = await scrapeCategorySkus(category)
      let matches = 0

      for (const { sku, name } of products) {
        if (targetSet.has(sku) && !found.has(sku)) {
          found.set(sku, {
            sku,
            category: category.name,
            group: category.group,
            name
          })
          matches++
        }
      }

      if (matches > 0) {
        console.info(
          `[${i + 1}/${categories.length}] ${category.name}: found ${matches}`
        )
      }
    } catch (err) {
      console.error(`Failed category "${category.name}":`, err.message)
    }
  }

  const missing = targetSkus.filter(sku => !found.has(sku))
  if (missing.length > 0) {
    console.warn(
      `Could not find category/name for ${missing.length} SKUs: ${missing.join(
        ', '
      )}`
    )
  }

  return targetSkus.map(
    sku =>
      found.get(sku) || {
        sku,
        category: '',
        group: '',
        name: ''
      }
  )
}

const main = async items => {
  console.log("HELLOOOOO!!")
  const finalData = []

  const cookie =
    'us-cartCount=0; ROUTE=.accstorefront-55bf6bf78-pqlpv; JSESSIONID=22694CD1C39D97B3FF263BE106A34F30.accstorefront-55bf6bf78-pqlpv; acceleratorSecureGUID=5e512ce1d1495658b0f8e316fc7ab49fd148587b; us-userLoggedIn=true'

  await eachOfLimit(items, 3, async ({ sku, category, name }, i) => {
    console.info(
      `Checking sku ${Number(i.toString()) + 1} of ${items.length}: ${sku}`
    )

    try {
      const res = await fetch(
        `https://shop.drivemedical.com/us/en/quickOrder/productInfo?code=${encodeURIComponent(
          sku
        )}&addressCode=`,
        {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
            Cookie: cookie
          }
        }
      )

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`)
      }

      const data = await res.json()

      const product = data?.productData

      if (!product) {
        throw new Error('Product data not found in response')
      }

      const price = product.price?.value
      const surcharge = product.surcharge?.value
      const availability = product.stock.stockLevelStatus.code
      const unit = product.unit
      const productName = name || product.name || ''
      const productCategory =
        category || product.categories?.[0]?.name || product.category?.name || ''

      for (const unitKey in product.units) {
        if (unitKey === unit) {
          finalData.push({
            sku,
            category: productCategory,
            name: productName,
            price,
            surcharge,
            availability,
            unit,
            unitDetails: product.units[unitKey]
          })
        } else {
          const res = await fetch(
            `https://shop.drivemedical.com/us/en/quickOrder/${encodeURIComponent(
              sku
            )}/changeUnit?unit=${encodeURIComponent(
              unitKey
            )}&qty=1&addressCode=`,
            {
              method: 'GET',
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                Cookie: cookie
              }
            }
          )

          if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`)
          }

          const data = await res.json()

          const childProduct = data?.productData

          if (!childProduct) {
            throw new Error('Product data not found in response')
          }

          const price = childProduct.price?.value
          const surcharge = childProduct.surcharge?.value

          finalData.push({
            sku,
            category: productCategory,
            name: productName,
            price,
            surcharge,
            availability,
            unit: unitKey,
            unitDetails: product.units[unitKey]
          })
        }
      }
    } catch (err) {
      console.error(err)
      finalData.push({
        sku,
        category,
        name,
        error: err.message || 'Unknown error'
      })
    }
  })

  // Pin the column order so `category` always appears, even if the first row
  // we collected is an error row (json2csv would otherwise infer columns from
  // just the first row's keys and drop fields missing there).
  const parser = new Parser({
    fields: [
      'sku',
      'category',
      'name',
      'price',
      'surcharge',
      'availability',
      'unit',
      'unitDetails',
      'error'
    ]
  })
  const csvData = parser.parse(finalData)

  await writeFile(`Drive Medical Whole.csv`, '﻿' + csvData)

  process.exit()
}

// Pipeline: use the SKU array below, look up category/name for those SKUs,
// then scrape each product's price / stock / unit data. main hits an
// authenticated API, so paste a fresh login cookie into the `cookie` constant
// in main before running.
const run = async () => {
  const skus = [
    '477400252',
    'DB-BLUE-1000',
    'DB-COLORADO-1000',
    'DB-COLORADO-1100',
    'DB-COLORADO-1200',
    'DB-SARATOGA-SCALE',
    'DB-SARATOGA-1200',
    'DB-SARATOGA-1000',
    'DB-SARATOGA-1100',
    'DB-SARATOGA-1300',
    'DB-MARAMEC-1200',
    'DB-MARAMEC-1000',
    'DB-MARAMEC-1100',
    'DB-NIAGARA-1300',
    'DB-NIAGARA-1200',
    'DB-NIAGARA-1500',
    'DB-NIAGARA-1600',
    '785-340',
    '785-340',
    '785-350',
    '785-350',
    '770-980',
    '770-980',
    '770-537',
    '770-537',
    '770-500',
    '770-500',
    '770-525',
    '770-525',
    '770-510',
    '770-510',
    '770-514',
    '770-514',
    '770-535',
    '770-535',
    '785-108',
    '785-108',
    '785-106',
    '785-106',
    '785-102',
    '785-102',
    '785-104',
    '785-104',
    '785-100',
    '785-100',
    '12118RF',
    'RTL13083',
    'RTL13083',
    '12124-3',
    '12112-3',
    '12132-3',
    '785-132',
    '785-132',
    '785-130',
    '785-130',
    '785-138',
    '785-138',
    '785-136',
    '785-136',
    '785-134',
    '785-134',
    '770-617',
    '770-617',
    '770-618',
    '770-618',
    '770-630',
    '770-630',
    '770-610',
    '770-610',
    '770-631',
    '770-631',
    '12027RA-4BULK',
    '770-626',
    '770-626',
    '770-629',
    '770-629',
    '12063',
    '12062',
    '770-625',
    '770-625',
    '785-540',
    '785-540',
    '785-530',
    '785-530',
    'RTL12032KDR',
    '412100200',
    '785-500',
    '785-500',
    '12011KD-2',
    '770-406',
    '770-406',
    '770-665',
    '770-665',
    '770-660',
    '770-660',
    '12001-4',
    'RTL12079',
    'RTL12079',
    'P2002',
    'P750',
    'P750-WS',
    '15303LW-HR',
    '15302LW-HR',
    '15303LW',
    '15302LW',
    '15300LW',
    '15300LW-HR',
    '15003PN',
    '15235N',
    '15004PN',
    '15030N',
    '15005LPN',
    '15033NC',
    '15004P-FR',
    '15004P-HRPKG-TS',
    '15004P-HR',
    '15004P',
    '15004P-FRPKG',
    '15004P-HRPKG',
    '15003P-FR',
    '15003P-HRPKG-TS',
    '15003P',
    '15571',
    '15571FR-PKG-TM',
    '15571FR',
    '15571FR-PKG',
    '15571HR',
    '15571HR-PKG',
    '15571HR-PKG-FM',
    '15571HR-PKG-TM',
    '15561HR',
    '15561FR-PKG-FM',
    '15571FR-PKG-FM',
    '15561',
    '15561FR-PKG',
    '15571F',
    '15561HR-PKG',
    '15561HR-PKG-FM',
    '15571H',
    '15561FR',
    '15030BV-HR',
    '15030BV-PKG-1-T',
    '15030BV-PKG-12',
    '15030BV-FR',
    '15030BV-PKG-11',
    '15030BV-PKG-4',
    '15030BV-PKG-T',
    '15005LP-HR',
    '15005LP-FR',
    '15005LP',
    '15005LP-FRPKG-TS',
    '15005LP-HRPKG',
    '15005LP-FRPKG',
    '15005LP-HRPKG-TS',
    '15235BV-PKG-1-T',
    '15235BV-PKG-T',
    '15235BV-FR',
    '15235',
    '15235BV-HR',
    '15033BV-PKG-1-T',
    '15033BV-PKG-12',
    '15033BV-PKG-11',
    '15033',
    '15033BV-HR',
    '15033BV-FR',
    '15033BV-PKG-4',
    '15033BV-PKG-T',
    '15033BV-PKG-2',
    '15021BV-LW',
    '15561FRAIL',
    '15561HRAIL',
    'PLTCAR',
    'PLTCAB',
    '15021BV',
    'P503',
    'P703',
    'P903',
    '35BWBE-CUSTOM',
    '35BWBE-B',
    '42BLFB-CROWN',
    '35BWBE-A',
    '42MCBE-A',
    'PBABE-B',
    'PBABE-A',
    'PBABE-FM',
    '42MCBE-B',
    '35BLHB-ARCH',
    '35BWBE-FM',
    '35MCBE-B',
    '42MCBE-FM',
    '42MCBE-CUSTOM',
    '35MCBE-FM',
    '35MCBE-A',
    '42BWBE-B',
    '42BWBE-A',
    '35MCBE-CUSTOM',
    '42BWBE-CUSTOM',
    '42BLHB-CROWN',
    '35MCBE-FM-SC05',
    '35MCBE-FM-SC04',
    '35BWBE-FM-SC04',
    '35BWBE-FM-SC05',
    '35MCBE-A-SC05',
    '35MCBE-A-SC04',
    '42MCBE-B-SC04',
    '42MCBE-B-SC05',
    '42BWBE-B-SC05',
    '35MCBE-B-SC05',
    '42BWBE-B-SC04',
    '42BWBE-A-SC04',
    '35BWBE-B-SC05',
    '35MCBE-B-SC04',
    '35BWBE-B-SC04',
    '35BWBE-A-SC05',
    '42MCBE-FM-SC05',
    '35BWBE-A-SC04',
    '42BWBE-FM-SC01',
    '42BWBE-FM-SC04',
    '42MCBE-FM-SC04',
    '42MCBE-A-SC05',
    '42BWBE-FM-SC05',
    '42MCBE-A-SC04',
    '42MCBE-FM-SC02',
    '904C-TPZF25',
    '903C-SC01',
    '15030HBL-3684',
    '15030HBC',
    '15030HBL-3684',
    '15030HBC',
    '15005EXTKIT-L',
    '15030EXTKIT',
    'M3800-72',
    'M3800-36',
    'M3800-48',
    'PLTCDR',
    'P703LE',
    'P703-BBK',
    'P703WE',
    'P703SC04',
    'P750TPZ',
    'P903-T-BBK',
    'P903-T-BBK',
    'LTCTRP',
    'P903HP',
    'P903HP',
    'NRS18010',
    'NRS185007',
    '11148-PKG-1',
    '11148N-4',
    '11161N-1',
    '11150-1',
    '11109',
    'RTL10389G',
    'RTL10389G',
    'RTL10400',
    'RTL10400',
    '721-790',
    '721-790',
    '721-780',
    '721-780',
    '721-785',
    '721-785',
    '10431-8',
    '10432-8',
    '10401-1',
    'RTL10446',
    'FLEX-AUTO',
    'RTL10446',
    'VENTURA420CS',
    'VENTURA420CS',
    'PROWLER3410MG22CS',
    'SFSCOUT3',
    'SFSCOUT3',
    'PANTHER22CS',
    'ZOOME3',
    'SCOUTLT4',
    'SCOUTLT4-EXT',
    'PHOENIXLT4',
    'PHOENIXLT4-20',
    'AB1020',
    'AB2400',
    'AB2400',
    '730-495',
    '730-494',
    '730-495',
    '730-495',
    '730-494',
    '730-494',
    '730-492',
    '730-490',
    '730-492',
    '730-492',
    '730-491',
    '730-490',
    '730-490',
    '730-491',
    '730-491',
    '770-854',
    '770-854',
    '770-852',
    '770-852',
    '770-856',
    '770-856',
    '770-844',
    '770-844',
    '770-842',
    '770-842',
    '730-325',
    '730-325',
    '730-320',
    '730-320',
    '731-844',
    '731-844',
    '731-840',
    '731-840',
    '731-842',
    '731-842',
    '731-852',
    '731-852',
    '731-854',
    '731-854',
    '731-850',
    '731-850',
    '730-420',
    '730-420',
    '731-459',
    '731-459',
    '731-492',
    '731-490',
    '731-491',
    '731-492',
    '731-492',
    '731-490',
    '731-491',
    '731-491',
    '731-490',
    '731-470',
    '731-470',
    '731-472',
    '731-472',
    '731-466',
    '731-466',
    '731-462',
    '731-462',
    '10309BKW-6',
    'RTL10304BW',
    'RTL10304BW',
    'RTL10304DG',
    'RTL10304DG',
    '10304BF-1',
    '10304BF-1',
    'RTL10304GD',
    'RTL10304GD',
    'RTL10304BZ',
    'RTL10304BZ',
    'RTL10304',
    'RTL10304',
    'RTL10304PN',
    'RTL10304PN',
    'HCANE-BK-C2',
    'HCANE-BK-C2',
    'HCANE-BK-C2',
    'HCANE-BL-C2',
    'HCANE-PR-C2',
    'HCANE-PG-C2',
    'HCANE-PG-C2',
    'HCANE-BL-C2',
    'HCANE-PR-C2',
    'HCANE-PP-C2',
    'HCANE-BL-C2',
    'HCANE-PR-C2',
    'HCANE-PP-C2',
    'HCANE-RD-C2',
    'HCANE-PB-C2',
    'HCANE-RD-C2',
    'HCANE-PB-C2',
    'HCANE-RD-C2',
    'RTL10330MN',
    'RTL10330MN',
    'RTLCR22CANE',
    'MD20100GR',
    'MD20100GR',
    '730-450',
    '730-450',
    '730-448',
    '730-448',
    '730-446',
    '730-446',
    '730-456',
    '730-456',
    '730-444',
    '730-444',
    '730-454',
    '730-454',
    '730-442',
    '730-442',
    '730-859',
    '730-859',
    '730-858',
    '730-858',
    '730-472',
    '730-472',
    '730-462',
    '730-462',
    '730-470',
    '730-470',
    '730-466',
    '730-466',
    '730-464',
    '730-464',
    'RTL10336SF',
    'RTL10336SF',
    'RTL10336MA',
    'RTL10336MA',
    'RTL10336RG',
    'RTL10336RG',
    'RTL10336FG',
    'RTL10336FG',
    'RTL10336LM',
    'RTL10336LM',
    'RTL10336PA',
    'RTL10336PA',
    'RTL10336GR',
    'RTL10336GR',
    'RTL10336AN',
    'RTL10336AN',
    '731-859',
    '731-859',
    '731-858',
    '731-858',
    '731-857',
    '731-857',
    '731-450',
    '731-450',
    '731-460',
    '731-460',
    '731-444',
    '731-444',
    '731-458',
    '731-458',
    '731-446',
    '731-446',
    '731-452',
    '731-452',
    '731-454',
    '731-454',
    '731-442',
    '731-442',
    '10381SL-6',
    '10301F-4',
    'RTL10386GB',
    'RTL10386GB',
    'RTL10390GB',
    'RTL10390GB',
    '730-340',
    '730-340',
    'HTIP-BK',
    'HTIP-BK',
    'HCFEET-BK',
    'HCFEET-BK',
    'RTL10353',
    'RTL10353',
    '10247-4',
    'RTL799',
    'RTL799',
    '10225-4',
    '10226-4',
    '10227-4',
    '10201-4',
    '10200-4',
    '770-165',
    '770-126',
    '770-121',
    'RTL10256PK',
    'RTL10256PK',
    'RTL10255PK',
    'RTL10255PK',
    'RTL10256NV',
    'RTL10256NV',
    'RTL10255NV',
    'RTL10255NV',
    '10109',
    '10109',
    '10121',
    '10121',
    'RTL10254GR',
    'RTL10254GR',
    '10121',
    'RTL10254TFL',
    'RTL10254TFL',
    'RTL10254BFL',
    'RTL10254BFL',
    'CE 1045',
    'CE 1286',
    '10115',
    'RTL800KD-BK',
    'RTL800KD-BK',
    'R800KD-GY',
    '700-913',
    '700-913',
    '700-961',
    '700-961',
    '700-959',
    '700-959',
    'RTL199',
    '700-979',
    '700-979',
    'R726PR',
    'R726GR',
    '102662BK-H-ACC',
    '102662BL-T-ACC',
    '102662BK-T-ACC',
    '102662RD-ACC',
    '102662BL-H-ACC',
    '102662BL-ACC',
    '102662BK-ACC',
    '102662RD-T-ACC',
    '102662BK-HD',
    '102662RD-H-ACC',
    '793-943',
    '700-977',
    '700-977',
    'RTL10288BK',
    '10230SN',
    '730-944',
    '730-944',
    '102662-CELL',
    '102662-CELL',
    '102662-CUP',
    '102662-CUP',
    '9501S726BK',
    '9501A79501',
    '9502F1025705',
    '95108964225B',
    '9505W1026117',
    '730-942',
    '730-942',
    '730-947',
    '730-947',
    '10215S',
    '795SEAT',
    '795SEAT',
    '9505W1026103',
    '10208BRAKE',
    '9502F1025701',
    '9505W1026101',
    '102662-CANE',
    '102662-CANE',
    '102662-31G',
    '102662-TRAY',
    '102662-TRAY',
    'PM20BA',
    'PM20BA',
    '14700',
    '14700',
    'PM20GA',
    'PM20GA',
    '13023SV24',
    '13053-6PT',
    'FLSCALE',
    'FLSCALE',
    '13240SB',
    '13255',
    '13240C',
    '13232',
    '13260',
    '13019',
    '13019',
    '13046-HD',
    '13240BATT',
    '13016-2',
    '13070',
    '13045',
    '13035',
    '13071',
    '13001SV-2',
    '700-850',
    '700-855',
    'PLA418FBUARAD-ELR',
    'PLA422FBUARAD-SF',
    'PLA422FBUARAD-ELR',
    'PLA418FBUARAD-SF',
    'PLA416FBUARAD-ELR',
    'PLA420FBUARAD-ELR',
    'PLA420FBUARAD-SF',
    'PLA416FBUARAD-SF',
    'STD22RBDDA',
    'RTLREB18DDA-SF',
    'SL18',
    'EXP19LTBL',
    'RTLFW19RW-RD',
    'RTLFW19RW-RD',
    'K316ADFA-ELR',
    'K316ADFA-SF',
    'EXP19LTRD',
    'EXP19LTRD',
    'K318ADDA-ELR',
    'K316ADDA-SF',
    'K316DDA-ELR',
    'K318ADFA-SF',
    'K318DDA-ELR',
    'K318ADDA-SF',
    'K320ADDA-SF',
    'K320DFA-SF',
    'K316ADDA-ELR',
    'K320ADDA-ELR',
    'K320DFA-ELR',
    'K320DDA-ELR',
    'K318DDA-SF',
    'K316DFA-ELR',
    'K318DFA-ELR',
    'K318DFA-SF',
    'K320ADFA-SF',
    'K320DDA-SF',
    'K318ADFA-ELR',
    'K316DDA-SF',
    'K320ADFA-ELR',
    'K316DFA-SF',
    'ATC22-R',
    'BLS18FBD-ELR',
    'BLS20FBD-ELR',
    'BLS20FBD-ELR',
    'BLS20FBD-SF',
    'BLS20FBD-SF',
    'BLS18FBD-SF',
    'BLS16FBD-SF',
    'BLS16FBD-SF',
    'BLS16FBD-ELR',
    'BLS16FBD-ELR',
    'CX420ADFA-SF',
    'CX420ADDA-SF',
    'CX420ADFA-ELR',
    'CX418ADFA-ELR',
    'CX418ADFA-SF',
    'CX416ADDA-SF',
    'CX418ADDA-SF',
    'CX416ADDA-ELR',
    'CX416ADFA-SF',
    'CX420ADDA-ELR',
    'CX418ADDA-ELR',
    'CX416ADFA-ELR',
    'PLA416RBDDA',
    'PLA420RBDDA',
    'PLA416RBDFA',
    'PLA420RBDFA',
    'PLA418RBDDA',
    'PLA418RBDFA',
    'SSP18RBDFAV',
    'SSP18RBDDAV',
    'SSP20RBDFAV',
    'SSP16RBDDAV',
    'SSP16RBDFAV',
    'SSP20RBDDAV',
    'STD26ECDDA-ELR',
    'STD26ECDDA',
    'STD30ECDDA',
    'STD26ECDDA-SF',
    'STD26ECDFA',
    'STD26ECDFA-SF',
    'STD30ECDFA',
    'STD26ECDFA-ELR',
    'STD28ECDDA',
    'STD28ECDFA',
    'KG 1020',
    '700-830',
    '700-841',
    '700-841',
    '700-846',
    '700-846',
    '700-848',
    '700-848',
    'SSP218FA-ELR',
    'SSP218DFA-SF',
    'SSP220DFA-ELR',
    'SSP218DDA-SF',
    'SSP220DDA-SF',
    'SSP220DDA-ELR',
    'SSP216DDA-ELR',
    'SSP218DDA-ELR',
    'SSP216DFA-SF',
    'SSP218FA-SF',
    'SSP216DFA-ELR',
    'SSP220DFA-SF',
    'SSP218DFA-ELR',
    'SSP216DDA-SF',
    'L412DDA-SF',
    'L414DDA-ELR',
    'TC005GY',
    'TC005GY',
    'L412DDA-ELR',
    'L414DDA-SF',
    'SSP118FA-SF',
    'STD24DDA-ELR',
    'STD22DDA-ELR',
    'STD22DDA-SF',
    'STD24DDA-SF',
    'STD20DDA-ELR',
    'STD20ECDFAHD-ELR',
    'STD20DDA-SF',
    'STD20ECDFAHD-SF',
    'STD22ECDDA-SF',
    'STD22ECDFA-ELR',
    'STD20ECDDAHD-ELR',
    'STD22ECDDA-ELR',
    'STD20ECDDAHD-SF',
    'STD24ECDDA-ELR',
    'STD24ECDFA-ELR',
    'STD24ECDFA-SF',
    'STD22ECDFA-SF',
    'STD24ECDDA-SF',
    'TR18',
    'TR20',
    'TR37E-SV',
    'BTR22-R',
    'BTR20-B',
    'BTR20-R',
    'ATC19-BL',
    'ATC19-BK',
    'ATC17-RD',
    'ATC17-BK',
    'ATC17-BL',
    'ATC19-RD',
    'DFL19-BLK',
    'DFL19-RD',
    'K516FBADDA-ELR',
    'K518FBADDA-SF',
    'K520FBADDA-SF',
    'K516FBADDA-SF',
    'K518FBADDA-ELR',
    'TS19',
    'K520FBADDA-ELR',
    'PL414RBDDA',
    'AF18FDABK-SF',
    'PL412RBDDA',
    'AF18FDAGY-SF',
    'AF20FDAGY-SF',
    'AF20FDABK-SF',
    'AFT18BK-SF',
    'AFT18GY-SF',
    'STDSSSP2-PL',
    'STDSCS1618V',
    'STDSSSP2-PR',
    'STDS828GT',
    'STDS831',
    'STDS1002',
    'STDS1034',
    'JLELR-TF',
    'ALELR',
    'HDELR',
    'STDS820',
    'STDSNUT',
    'STDS803',
    'PHELR',
    'STDELR-TF',
    'STDS806-HD',
    'STDS806',
    'STDS2A4326',
    'STDS833N',
    'STDS833N',
    'STDS832',
    'STDS4Y4712',
    'STDS814',
    'STDS802',
    'STDS829',
    'STDS807',
    'STDS818',
    'PH-SF',
    'RTLREB-12',
    '10208K',
    '10208K',
    '9501A79504-2M',
    '1026610-G',
    '1026610-W',
    '9505W1026120',
    '1026610-R',
    'STDS834',
    'WASL',
    'WASR',
    'JL3-4SF-TF',
    'STDSK234-PTR',
    'STDS856',
    'STDS855',
    'STDS601',
    'STDS801',
    'STDS801GT',
    'STDSSHK-K3',
    'STDSSHK',
    'STDS840',
    'STDS840',
    'STDS6008-1',
    'STDS860',
    'STDS4056',
    'STDSCS1818V',
    'STDSSSP-AA',
    'FLNP500',
    'FLNP600',
    '13023CSET',
    '13240',
    '13023SV',
    'FLP500',
    'FLP600',
    '13023SV',
    'STSP450',
    'STSM450',
    '13244',
    'RS-BDSC-03',
    'RS-WDRB-24-10',
    '13244',
    'BW-CHST-03W',
    'BW-CHST-03',
    'BW-HUTC-1',
    'BW-WDRB-10',
    'BW-WDRB-12',
    'BW-BDSC-03',
    'RS-WDRB-36-20',
    'MC-CHST-06',
    'RS-WDRB-30-20',
    'CLN400-HPP',
    'CLN400-20',
    'MC-HUTC-1',
    'MC-CHST-04',
    'MC-BDSC-11',
    'NOC4D-C',
    'NOC4D-O',
    'NOC4D-FM',
    'NOBS3D-FM',
    'NOBS3D-O',
    'NOBS3D-C',
    'NOW2D-FM',
    'NOW2D-C',
    'NOW2D-O',
    'NOW2D2D-O',
    'NOW2D2D-FM',
    'NOW2D2D-C',
    'NOW1D2D-O',
    'NOW1D2D-C',
    'NOW1D2D-FM',
    'BW-CHST-06',
    'D574EW-CHAR',
    'D574EW-CHOC',
    'D574EW-TAN',
    'ET001-T',
    'BSF001',
    'BLS001',
    'DT002-R-1-BK',
    'BLC001',
    'DT001-42S',
    'DT001-48S',
    'DT001-36S',
    'DLS001',
    'DLC001',
    'ET002-R',
    'ET002-S',
    'DT002-R-4-BR',
    'DC002',
    'DT002-S-1-BK',
    'DT002-R-1-BR',
    'BW-CHST-04',
    'BW-WDRB-22',
    'BW-WDRB-22W',
    'BW-WDRB-20W',
    'NOBS1D1D-FM',
    'NOBS1D1D-C',
    'NOBS1D1D-O',
    'NOC3D-C',
    'NOC3D-O',
    'NOC3D-FM',
    'RS-WDRB-36-22',
    'MC-CHST-03W',
    'RS-WDRB-30-22',
    'MC-CHST-03',
    'MC-WDRB-20W',
    'RS-CHST-04',
    'D577-CHOC',
    'D577-CHAR',
    'D577-TAN',
    'D574-CHOC',
    'D574-TAN',
    'D574-CHAR',
    'DC001',
    'ET001-W',
    'TB001-36W',
    'TB001-W',
    'TB001-36',
    'TB001',
    'DT002-S-1-BR',
    'DSF001',
    'DT002-R-4-BK',
    'MC-BDSC-03',
    'MC-WDRB-12',
    'MC-WDRB-22W',
    'MC-WDRB-10',
    'MC-WDRB-22',
    'RS-BDSC-11',
    'RS-CHST-06',
    'RS-WDRB-24-12',
    'RS-CHST-03W',
    'RS-CHST-03',
    '16011-HCHM',
    '16011-HCFM',
    '16011-HCGN',
    '16011-HOQO',
    '16011-HOQOV',
    '16011-HCWC',
    '16011-HOWCV',
    '16011-HCWCV',
    '16011-HCGW',
    '16011-HCGWV',
    '16011-HOFMV',
    '16011-HOFM',
    '16011-HOGWV',
    '16011-HOWC',
    '16011-HCFMV',
    '16011-HOGW',
    '16011-HCQOV',
    '13080-HOSO',
    '13080-HOWC',
    '13080-HOBO',
    '13080-HOEO',
    '13080-HOQO',
    '13080-HODM',
    '13080-HONT',
    '13080-HOFM',
    '16005-UCEO',
    '16005-UONTV',
    '16005-UOQO',
    '16005-UOSO',
    '16005-UOWCV',
    '16005-UCGW',
    '16005-UCWCV',
    '16005-UCDMV',
    '16005-UOBO',
    '16005-UCEOV',
    '16005-UCSO',
    '16005-UODM',
    '16005-UCFMV',
    '16005-UOWC',
    '16005-UOQOV',
    '16005-UOSOV',
    '16005-UCSOV',
    '16005-UCQO',
    '16005-UCQOV',
    '16005-UCDM',
    '16005-UOFMV',
    '16005-UCWC',
    '16005-UCNT',
    '16005-UCFM',
    '16005-UCGWV',
    '16005-UONT',
    '16005-UOBOV',
    '16005-UOFM',
    '16005-UCBO',
    '16005-UOEOV',
    '16005-UCBOV',
    '16005-UODMV',
    '16005-UOGW',
    '16005-UOEO',
    '16005-UOGWV',
    '16005-UCNTV',
    '13602',
    '13605',
    '13606',
    '13608',
    '13034',
    '13017BV',
    '13009TRAPBV',
    '13060',
    '13061',
    '13012',
    '13026',
    '13025',
    '13262M',
    '13262L',
    '13263H',
    '13263F',
    '13263E',
    '13264A',
    '13263B',
    '13263A',
    '13221XL',
    '13224XL',
    '13223L',
    '13221XXL',
    '13221M',
    '13221L',
    '13222M',
    '13222L',
    '13223M',
    '13220XL',
    '13220S',
    '13220M',
    '13220L',
    'RTL9506',
    'RTL9506',
    'RTL5023',
    'RTL5023',
    'RTL5023',
    'RTL2010',
    'RTL5021F',
    'RTL5021F',
    'RTL2010',
    'RTL2010',
    'RTL19K005-2',
    'RTL19K005-2',
    'RTLPC23289',
    'RTL19D8BG-2',
    'RTL19D8BG-2',
    'RTLPC23289',
    'RTL6292',
    'RTL6292',
    'BP004',
    'BP004',
    'RTL19G007GR',
    'RTL19G007GR',
    'H19E008BK',
    'H19E008BK',
    'AGF-111N',
    'AGF-3X',
    'AGF-602',
    'RTLAGF-910',
    'RTLAGF-910',
    'AGF-3E',
    'AGF-101',
    'BP2610',
    'BP2610',
    'MQ8000S',
    'MQ8000S',
    'MQ8000L',
    'MQ8000L',
    'MQ8000M',
    'MQ8000M',
    '18090-BE',
    '18090-BE',
    '18090-BE',
    'MQ6002R',
    'MQ6002R',
    'MQ6006',
    'MQ6006',
    'MQ0081',
    'MQ0081',
    'MQ6005',
    'MQ6005',
    'MQ6004',
    'MQ6004',
    'MQ6003',
    'MQ6003',
    'MQ5800',
    'MQ5800',
    'MQ5900P',
    'MQ5900P',
    'MQ5900',
    'MQ5900',
    '15-RD',
    'MQ5600',
    'MQ5600',
    'MQ8100',
    'MQ8100',
    '18082',
    '18082',
    'NEB KIT 700',
    'NEB KIT 600',
    'MQ0385',
    'MQ0385',
    '18031',
    '18031',
    '18260-PDMASK',
    '18260-PDMASK',
    '7314P-D',
    '7314P-D',
    '18600-FILTER',
    '22330-12',
    '7305D-609',
    '7305D-607',
    '7305D-617',
    '7305D-605',
    '7305D-615',
    '7305D-616',
    '7305D-623',
    '7305D-610',
    '4650D-609',
    '7305P-620',
    '7305P-605',
    '7305P-605',
    '7305P-631',
    '7305P-610',
    'TUB NK 50',
    'TUB NK 07',
    'TUB NK 14',
    'TUB NK 25',
    'TUB NK 40',
    'CH4815-L-BLUE',
    'CH4808-L-BLUE',
    'IN3625-R-1',
    'IN3625-R-1',
    'CTOX-MN02',
    'CTOX-MN02',
    'IN3625-R',
    'IN3625-R',
    'IN3625-R-2',
    'IN3625-R-2',
    '1025DS',
    '125D',
    '125D-XB',
    '125D-BT-XB',
    '125D-BT',
    '5DECO2DS',
    'R217P62',
    'OM-975',
    'OM-975',
    'IN2800-R-2',
    'IN2800-R-2',
    'IN2925-R-2',
    'IN2925-R-2',
    'IN2925-R-1',
    'IN2925-R-1',
    'CYL E-P',
    'CYL D-P',
    'IN2925-R',
    'IN2925-R',
    'CYL M 90',
    'CYL M 60',
    'CYL MM',
    'CYL C/ M9 POST',
    'CYL M6/B-TOGGLE',
    'CYL E-T',
    'CYL D-T',
    'CYL M6/B-POST',
    'CYL C/ M9 T',
    'INT-812M6',
    '18302GDEL',
    '18304GN',
    '18303G',
    '18304GMN',
    '18302GMN',
    '18301GM',
    '18307G',
    '535D',
    '535D-E-870',
    '535D-D-870',
    '535D-D-CF',
    '535D-C-870',
    '535D-M6-870',
    '535D-E-CF',
    '525DS-EW',
    '525DS-Q',
    '525DS',
    '525DS',
    '525DS-QEW',
    'MASK 007A',
    '125D-674',
    '125D-674',
    'EK-1',
    'SOFT 204',
    'SOFT 207',
    'SOFT 250',
    'SOFT 200',
    'SOFT 207 P',
    'SOFT 214',
    '18141',
    'CON 700',
    '18149KD',
    '18149KD',
    'CON 550',
    'CON 400',
    'MASK 003A',
    'MASK 003P',
    'HS-2',
    'OP-150T',
    'OP-150T',
    'CON 900',
    '18111',
    'B10344-001',
    'B10344-001',
    'B10343-001',
    'B10343-001',
    '100NDEL-NH',
    '100NDEM-NH',
    '100NDES-NH',
    'C10200-018',
    '100NDEH',
    '100NDEL-CUSHION',
    '100NDES-CUSHION',
    '100NDEM-CUSHION',
    '100FDS-NH',
    '100FDL-NH',
    '15312',
    '15301-84',
    '15310-84',
    'M6026',
    '14025NS',
    '14006E',
    'M6026',
    '14003-EF',
    'BA9600-C-NP3580',
    'BA9600-P-42-TC',
    'BA9600-C-NP3584',
    '3870N',
    '14333-42',
    '14530',
    '15970-4280-RR',
    'BA9600-PUMP-KIT',
    'BA9600-PUMP-KIT-42',
    'BA9600-P-84',
    'BA9600-NP-84',
    'BA9600-P-42',
    'BA9600-NP',
    'BA9600-P',
    'BA9600-NP-42',
    '15014',
    '15006EF',
    '14026',
    '14026-A',
    '14027',
    '14029DP',
    '15076C',
    '14200N-42',
    '14200N-48',
    '14029-84',
    '14029',
    '14030',
    '14054',
    '14048'
  ]

  const items = await getSkuInfoForSkus(skus)

  console.info(`Scraping ${items.length} SKUs from the array...`)
  await main(items)
}

run()
