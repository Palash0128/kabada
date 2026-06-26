import { eachOfLimit } from 'async'
import axios from 'axios'
import { load } from 'cheerio'
import fs, { writeFile } from 'fs/promises'
import { Parser } from 'json2csv'

const cookie = ''

const client = axios.create({
  baseURL: 'https://mms.mckesson.com',
  headers: {
    cookie
  }
})

const main = async () => {
  const allCategories = []

  const productIdSet = new Set()

  const products = []
  const finalProducts = []
  const match = [
    'EA',
    'CS',
    'PK',
    'BX',
    'PR',
    'ST',
    'CT',
    'KT',
    'RL',
    'BG',
    'DZ'
  ]

  try {
    const { data: catalogPage } = await client.get(
      '/catalog/category?node=40606'
    )

    const $ = load(catalogPage)

    $('a', '.refine').each((_, a) => {
      allCategories.push({
        name: $(a).text().trim(),
        url: $(a).attr('href') || '',
        visited: false
      })
    })

    console.log('allCategories', allCategories)

    console.log('first level categories length:', allCategories.length)

    const getCategoriesRecursive = async categories => {
      await eachOfLimit(categories, 10, async category => {
        const { data: categoryPageData } = await client.get(category.url)
        const $ = load(categoryPageData)
        category.visited = true
        if (categoryPageData.includes('narrow-results-top')) {
          const subCategories = []
          $('li > a', '#collapse0').each((_, a) => {
            subCategories.push({
              name: $(a).text().trim(),
              url: $(a).attr('href') || '',
              visited: false
            })
          })
          allCategories.push(...subCategories)
          await getCategoriesRecursive(subCategories)
        } else {
          await getProducts($, productIdSet, products, category.url)
        }
      })
    }

    await getCategoriesRecursive(allCategories)

    console.log('after recursive categories get:', allCategories.length)
    console.log('products length:', products.length)

    productIdSet.clear()
    const variantAddedIdSet = new Set()

    await eachOfLimit(products, 10, async (productInfo, idx) => {
      const pct = ((Number(idx) + 1) / products.length) * 100
      if (Number(idx) % 1000 === 0) {
        console.log(`${Number(idx) + 1} out of ${products.length} : ${pct}%`)
      }

      if (productIdSet.has(productInfo.id)) return
      productIdSet.add(productInfo.id)

      const { data: productPageData } = await client.get(productInfo.url)
      const $ = load(productPageData)

      const title = $('.prod-title').text().trim()
      const shortTitle = $('.prod-invoice-title').text().trim()
      const brandName = $(
        'div:nth-child(2) > div > div.item-header > ul > li:nth-child(3)'
      )
        .text()
        .trim()
      const uomsWithPrices = []

      $('div.product-select-unit-of-measure select > option').each(
        (_, uomOption) => {
          uomsWithPrices.push({
            uom: $(uomOption).attr('data-uom'),
            uomToEach: $(uomOption).attr('data-eaches'),
            price: $(uomOption).attr('data-price')
          })
        }
      )

      const specifications = {}
      $('#specifications table tr').each((_, spec) => {
        const key = $('th', spec).text().trim()
        const value = $('td', spec).text().trim()
        specifications[key] = value
      })

      const stockMessage = $('.product-availability')
        .text()
        .trim()
        .split('\n')
        .map(ss => ss.trim())
        .filter(ss => ss !== '')

      uomsWithPrices.forEach(uomEntry => {
        const { uom, uomToEach, price } = uomEntry
        if (!uom || !price) return

        const cleanUom = uom.trim()
        const cleanUomToEach = parseInt(uomToEach || 'NaN')
        const cleanPrice = parseFloat(price.replace(/[^0-9.]/g, ''))

        if (match.includes(cleanUom) && !isNaN(cleanPrice)) {
          finalProducts.push({
            url: productInfo.url,
            id: parseInt(productInfo.id),
            mfr: productInfo['Manufacturer #'] || '',
            name: title,
            shortTitle: shortTitle || '',
            brandName: brandName.replace(/\s*#.*$/, '') || '',
            stockStatus: stockMessage[0] || '',
            stockMessage: stockMessage[stockMessage.length - 1] || '',
            uom: cleanUom || 'NaN',
            uomToEach: cleanUomToEach,
            price: cleanPrice
          })
        }
      })
    })

    await writeFile('test.json', JSON.stringify(finalProducts))

    const parser = new Parser()

    const csvData = parser.parse(data)

    await fs.writeFile('test.csv', csvData)
  } catch (error) {
    console.error(error)
    await writeFile('test-Catch.json', JSON.stringify(finalProducts))
  }
}

const getProducts = async ($, productIdSet, products, pageUrl) => {
  const totalPages = parseInt($('#catalog').attr('data-total-pages') || '1')
  await eachOfLimit(
    Array.from({ length: totalPages }, (_, i) => i + 1),
    5,
    async page => {
      if (page !== 1) {
        const { data: nextPageProductsData } = await client.get(
          `${pageUrl}&pageOffset=${page - 1}`
        )

        $ = load(nextPageProductsData)
      }
      $('.product-item').each((_, el) => {
        const productId = $(el).attr('data-item-id')
        if (!productId || productIdSet.has(productId)) return
        productIdSet.add(productId)
        products.push({
          id: productId,
          url: $('.item-title > a', el).attr('href')?.trim() || ''
        })
      })
    }
  )
}

main()
