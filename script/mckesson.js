import { eachOfLimit } from 'async'
import axios from 'axios'
import { load } from 'cheerio'
import fs, { writeFile } from 'fs/promises'
import { Parser } from 'json2csv'

const cookie = `community-alert-expanded=false; MMS_SEGMENT=HME; _ga=GA1.1.549840908.1751879365; _mkto_trk=id:837-LBN-556&token:_mch-mckesson.com-95040a59297024ea1a2d7af2f731da8d; _pendo_visitorId.1291695225=_PENDO_T_c0SRFFc9EIS; visid_incap_1802153=eEzcpQ4XTR2E/l+RWeQsKzz3cGgAAAAAQUIPAAAAAAACYVUXrbrQE8M07G0PfWIt; _gcl_au=1.1.1448732776.1751879364.1144836338.1755073823.1755073846; nlbi_2754305=JWzZZzjzajSgb526+tP4sQAAAAAJPvi9Ek7s/Qdk4cGePcrB; rxVisitor=1757137332986LPKRMQMEU37OHJ63G6GHNJPM7JOG09LF; _pendo_unsentEvents.13c233e2-295d-454b-406e-7fb811695c5a=; _pendo_visitorId.13c233e2-295d-454b-406e-7fb811695c5a=; _pendo_accountId.13c233e2-295d-454b-406e-7fb811695c5a=; _pendo_meta.13c233e2-295d-454b-406e-7fb811695c5a=; _pendo_sessionId.13c233e2-295d-454b-406e-7fb811695c5a=; _pendo_oldVisitorId.13c233e2-295d-454b-406e-7fb811695c5a=; nlbi_734530=NMP/B9/dqSK9+oIs3o+ICwAAAAB8xMq2Kaf9Q3hWLiyKzjd+; session-expiration-logged-in=true; community-alert-expanded=false; liveagent_sid=d4eab111-86b0-46c9-b9bb-dd29ec3f7b1a; nlbi_379597=Q/gJVEtuGhcDTGQejnyz5wAAAADPcs4O4kq1uT6hotX3Wij9; dtCookie=v_4_srv_4_sn_2DF3E0C021A52B99F6A17AA7ECEB4000_perc_100000_ol_0_mul_1_app-3A508ede8ee0d1bd82_1; nlbi_2420321=LiqtdGy7I30mvuARUIWeDQAAAADiUYR43KLmQFkkIWA68gIe; liveagent_vc=1; visid_incap_2754305=qV/UFZqcSD26GVSPvZUAQAsj1WgAAAAAQUIPAAAAAADYtfforpU22f4Q6J5uKtKM; incap_ses_937_2754305=z1IJb4b2LTURThAol+QADQwj1WgAAAAABROJ5+JNbte/hRMVXBgV3g==; visid_incap_2258952=7xjQ/lq3T3mAxTLtDcAJYAwj1WgAAAAAQUIPAAAAAADYhBEh3M/1ItQt+byaojjC; incap_ses_932_2258952=TyiqYv48PVHy+AE1NSHvDAwj1WgAAAAALP1/vOsVf9IXLroBeiUQaQ==; _pendo_meta.1291695225=1464149501; _pendo_utm.1291695225=%7B%22channel%22%3A%22Direct%22%7D; _pendo_guides_blocked.13c233e2-295d-454b-406e-7fb811695c5a=0; nlbi_2754305_2147483392=7NXKUcZHa0BjyrZD+tP4sQAAAADVeCoR0dCGzFv1cfKRzfUA; _pendo_utm.13c233e2-295d-454b-406e-7fb811695c5a=%7B%22referrer%22%3A%22portal.mms.mckesson.com%22%7D; _pendo_sessionId.1291695225=%7B%22sessionId%22%3A%22R1OIQ2fMIO03DbJG%22%2C%22timestamp%22%3A1758798622431%7D; _br_uid_2=uid%3D3229826637124%3Av%3D15.0%3Ats%3D1751879368086%3Ahc%3D149; bWNrZXNzb24uY29t-_lr_tabs_-autd9h%2Fprod-supplymanager={%22recordingID%22:%226-01998090-f318-72f7-9e4f-ebb623d58ae1%22%2C%22sessionID%22:0%2C%22lastActivity%22:1758798622577%2C%22hasActivity%22:true%2C%22confirmed%22:true%2C%22clearsIdentifiedUser%22:false}; bWNrZXNzb24uY29t-_lr_hb_-autd9h%2Fprod-supplymanager={%22heartbeat%22:1758798622577}; SIMONESESSIONID=OTIwMDlmOTgtMDM4My00N2JiLWI2YmItYjJkNzEzNTQ3NTVm; visid_incap_734530=zEXkXK8zRF6Qsc94AYO0oB4j1WgAAAAAQUIPAAAAAABnhIroGaZEwbrkuu7FAEv9; incap_ses_937_734530=TN73Zr/FETN8cRAol+QADR8j1WgAAAAAG38xsQKOwUVY4mMKFGFb9Q==; _ga_5DWL0JSNDR=GS2.1.s1758798607$o67$g1$t1758798625$j42$l0$h0; _ga_4XF20JDM68=GS2.1.s1758798607$o85$g1$t1758798625$j42$l0$h0; visid_incap_379597=0ihz3ynvRjO9PqDYnZdTbyEj1WgAAAAAQUIPAAAAAACb2jEwcEhNNrqrCtIP8fyI; visid_incap_2420321=AyxhZxnzR1a2nLD9HxKPWCEj1WgAAAAAQUIPAAAAAACFqpzAvdQjnhcUgLUQ2T8U; incap_ses_937_2420321=zLSVb2+xegZTdxAol+QADSEj1WgAAAAADQ6FY9Ztl2gXHIF68JpA4A==; incap_ses_939_379597=TMjJBjhxv30tomVxlP8HDSEj1WgAAAAAyJ0lngWBqEVqxfa3pY4XcA==; liveagent_oref=https://portal.mms.mckesson.com/; reese84=3:ZKIqB2hyhj3Rp//tZRjSpw==:CzQEWHCT0kiv8A6GLZB3Au3q3HVFLyGXMrzssOUKh3lwqT5Vj40x7LQG+fpaE9HoVzFSJf+G2pVIAyGOXtf3NlSkZr/DfTf4BpmA3pJkdx3TphGqWNF/zLjK7a+pmQlDGOffI3u+4d+5IV9zfCo9mjybYcvgeGkyRoQ8U/Boi+Y8K2Wg30Z0IUYkjjiGp5NnDFuxWpLtX39CIfo8/DLMoXDrbQIVFH5b7IK5byKmhknCOwDur5z26KJVL48Jt9lqG6bDhVpbXeei+NlJy0A0NIhTZQDqR7BxpoUh7dLTEJX+bGuvmX9EzSaRbaeEBicjhg6uUcLp3OEUaua0NwqTCvg3clD0e3vcjtL6mCbDX3WKzzY5G9dY1WHemhYeJFFQcN17JmZKUufOa4CLQxwh7cRO/qH5QPwLxlx9jcxM67nGnDdn0WNfW5fF8aokbwn2JYIeUQiWazph/LiT+SVmqSX46S6G/pOafnb0LiWUro1KRkDY/RbeFPmpF2KaIu8V:eWWX/tS7CQswLZOJKM5OMMFQ8sHpzivjtm8tAZmm0hc=; dtSa=-; session-expiration-client-time-offset=1021; nlbi_734530_2147483392=JhapD/SNXnOzx6EK3o+ICwAAAAAWrvPNFsNhkMSi2jy2lNug; session-expiration-server-time=1758798642409; session-expiration-timeout-time=1758800442409; rxvt=1758800443533|1758798604842; dtPC=4$198641884_248h-vRTCQDOFNUJHGMMGOHUOBAVCNPMHVHBRE-0e0`

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
