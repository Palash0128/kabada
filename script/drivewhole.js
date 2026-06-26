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

const main = async items => {
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

      for (const unitKey in product.units) {
        if (unitKey === unit) {
          finalData.push({
            sku,
            category,
            name,
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
            category,
            name,
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

// Full pipeline: crawl every category for SKUs, then scrape each product's
// price / stock / unit data (main). main hits an authenticated API, so paste a
// fresh login cookie into the `cookie` constant in main before running.
const run = async () => {
  // const items = [...new Set(skus)].map(sku => ({
  //   sku,
  //   category: '',
  //   name: ''
  // }))
  const items = await getAllSkus()

  console.info(`Scraping ${items.length} SKUs from the array...`)
  await main(items)
}

run()
