import axios from 'axios'
import { load } from 'cheerio'
import csv from 'csvtojson'
import { rm, writeFile } from 'fs/promises'
import { Parser } from 'json2csv'
import puppeteer from 'puppeteer'

let callStack = 0
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export const DriveMedicalUpdate = async ({ fileName, url }) => {
  // const { cookieString } = await getAuthCookie(
  //   'cs@medicaleshop.com',
  //   'Ab1098Zx++'
  // )

  const cookieString =
    'us-cartCount=0; ROUTE=.accstorefront-74647c5bc-tcswd; JSESSIONID=29503C30E1BC6EC2B3A2FF8F551389EC.accstorefront-74647c5bc-tcswd; acceleratorSecureGUID=389075a6f078baf8fa0120b16ffe0e66e55318b1; us-userLoggedIn=true'

  const client = axios.create({
    headers: {
      cookie: cookieString
    }
  })

  let data = []
  if (fileName) {
    data = await csv().fromFile(fileName)
  } else if (url) {
    data = await csv().fromString((await axios.get(url)).data)
  }

  const finalData = []

  for (let i = 0; i < data.length; i++) {
    console.log(i + 1)

    const d = data[i]

    if (!d['Display Name']) continue

    try {
      const res = await client.get(
        `https://shop.drivemedical.com/us/en/search/?text=${d['Display Name']}`
      )

      const page = res.data

      if (page.includes('Search Results For')) {
        finalData.push({
          ...d,
          isFound: false
        })
        continue
      }

      const $ = load(page)

      if (!$('.new-items-section').text().trim().includes(d['Display Name'])) {
        finalData.push({
          ...d,
          isFound: false
        })
        continue
      }

      const values = []
      const UPC = $('.new-hcpcClass').text().trim().split('UPC #')[1].trim()

      $('.selectUnit.qty-unit > option').each((_, el) => {
        values.push({
          text: $(el).text().split('/')[0],
          value: $(el).attr('value'),
          packaging: $(el).text().split('/')[1],
          unit: $(el).text(),
          UPC
        })
      })

      console.log({ values })

      let url = 'https://shop.drivemedical.com' + res.request.path.split('?')[0]

      $('link[rel="canonical"]').each((i, el) => {
        if (i !== 0) return
        if ($(el).attr('href')) url = $(el).attr('href')
      })

      for (const val of values) {
        const priceString = (
          await client.get(url + `/changeUnit?unit=${val.value}&qty=1`)
        ).data
        const obj = priceString.split('&').reduce((acc, cur) => {
          const [key, value] = cur.split('-')
          acc[key] = value
          return acc
        }, {})
        let futureStock = []
        if (obj.stock && obj.stock === '0') {
          const futureStockData = (
            await client.get(
              `https://shop.drivemedical.com/us/en/p/${d['Display Name']}/futureStock`
            )
          ).data
          const $ = load(futureStockData)
          $('span').each((_, el) => {
            futureStock.push($(el).text().trim())
          })
        }

        finalData.push({
          ...d,
          error: false,
          ...val,
          ...obj,
          stockStatus: $('div.stock-status').text().trim(),
          futureStock: futureStock.join(', ')
        })
      }
    } catch (err) {
      finalData.push({
        ...d,
        error: true
      })
    }
  }
  const parser = new Parser()
  const csvData = parser.parse(finalData)

  await writeFile(
    `Drive Medical updated - ${Date.now()}.csv`,
    '\ufeff' + csvData
  )

  // const uploadedFile = await uploadFileS3(
  //   `Drive Medical updated - ${Date.now()}.csv`,
  //   '\ufeff' + csvData,
  //   'Drive Medical Cron'
  // )

  try {
    await rm(fileName, { force: true, recursive: true })
  } catch (error) {}
}

const getAuthCookie = async (username, password) => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ignoreDefaultArgs: ['--enable-automation'],
    executablePath: '/usr/bin/brave'
  })

  const page = await browser.newPage()

  let cookieString

  try {
    await page.goto('https://shop.drivemedical.com/us/en/login', {
      timeout: 200000,
      waitUntil: 'networkidle2'
    })
    await page.waitForNetworkIdle()
    await page.type('#j_username', username)
    await page.type('#j_password', password)
    await page.click('#loginForm > button')
    await page.waitForNavigation()

    await delay(5000)

    const cookies = (await page._client().send('Network.getCookies')).cookies

    cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ')
  } catch (err) {
    console.error(err)
  }

  await browser.close()

  callStack++

  if (callStack > 3) {
    throw new Error('Max Call Stacks reached for authentication')
  }

  if (!cookieString) return getAuthCookie(username, password)
  else return { cookieString }
}

// if (process.argv.length >= 3)
//   DriveMedicalUpdate({
//     fileName: process.argv[2],
//     url: process.argv.length === 4 ? process.argv[3] : undefined
//   })
//     .then(() => {
//       if (process.argv[2]) {
//         rm(process.argv[2], { force: true, recursive: true })
//       }
//     })
//     .catch(console.error)

DriveMedicalUpdate({ fileName: 'Drive medical.csv', url: undefined })
