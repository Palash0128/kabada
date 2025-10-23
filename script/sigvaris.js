import axios from 'axios'
import { load } from 'cheerio'
import csv from 'csvtojson'
import fs from 'fs/promises'
import { Parser } from 'json2csv'
import puppeteer from 'puppeteer'

export const main = async ({ fileName, url }) => {
  let data = []
  if (fileName) {
    data = await csv().fromFile(fileName)
  } else if (url) {
    data = await csv().fromString((await axios.get(url)).data)
  }

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
  })

  const page = await browser.newPage()
  page.setDefaultNavigationTimeout(0)

  await page.goto('https://www.sigvaris-online.com/cust_logon.aspx')
  await page.type('#user_id', 'chrism')
  await page.type('#pwd', 'Sigvaris1')
  await page.click('#Button1')

  const products = []

  let i = 0

  await page.waitForNavigation()
  await page.close()
  for (
    let start = data.length <= 100 ? data.length : 100;
    start <= data.length;
    start + 100 >= data.length
      ? (start = start + (data.length % 100))
      : (start = start + 100)
  ) {
    console.log(i)
    const newPage = await browser.newPage()
    try {
      await newPage.goto('https://www.sigvaris-online.com/cart.aspx')
    } catch (error) {
      console.error(error)
      throw error
    }

    try {
      await newPage.click('#BtnClear')
      await newPage.waitForNavigation()
    } catch (err) {}

    if (products.length) {
      const chunk = products.slice(Math.max(0, products.length - 500))

      const parser = new Parser()

      const csvData = parser.parse(chunk)

      await fs.writeFile(`sigvarisOutputNew-${i % 500}.csv`, csvData)
    }

    for (; i < start; i++) {
      if (data[i].done === 'TRUE') continue
      try {
        await newPage.goto('https://www.sigvaris-online.com/quick_entry.aspx')
        await newPage.waitForSelector('#qeitem0')
        await newPage.click('#qeitem0', {
          clickCount: 2
        })
        await newPage.keyboard.press('Backspace')
        await newPage.type('#qeitem0', data[i]['Display Name'])
        await newPage.click('#qeqty0', {
          clickCount: 2
        })
        await newPage.keyboard.press('Backspace')
        await newPage.type('#qeqty0', '1')
        await newPage.keyboard.press('Enter')
        await newPage.waitForNavigation()
      } catch (err) {
        console.log(err)
      }
    }

    await newPage.goto('https://www.sigvaris-online.com/cart.aspx')
    const $ = load(await newPage.content())
    let product
    $('#cartHeader > table > tbody')
      .children()
      .each((index, el) => {
        if (!(index % 2)) {
          product = {
            ...data.find(
              d =>
                d['Display Name'] ===
                $(el).children('td:nth-child(2)')?.text().trim()
            ),
            itemCode: $(el).children('td:nth-child(2)')?.text(),
            price: $(el).children('td:nth-child(3)')?.text(),
            sigvarisUOM: $(el).children('td:nth-child(5)')?.text(),
            extPrice: $(el).children('td:nth-child(6)')?.text(),
            cartError:
              $(el)
                .children('td:nth-child(2)')
                .children('.form-error')
                .text() || ''
          }
        } else {
          product.cartError =
            $(el).children('td:nth-child(2)').children('.form-error').text() ||
            ''
          products.push(product)
        }
      })
    try {
      await newPage.click('#BtnClear')
      await newPage.waitForNavigation()
    } catch (err) {
      console.error(err)
    }
    await newPage.close()
  }

  await browser.close()

  // const file = await uploadFileS3(
  //   `SigvarisUpdatedPrice-${Date.now()}.csv`,
  //   csvFile,
  //   'Sigvaris Cron'
  // )

  // cronLog.fileId = file.resource.id
  // cronLog.endTime = new Date()
  // cronLog.progress = 100
  // cron.lastCronLogId = cronLog.id
  // cron.isRunning = false

  // await cronLog.save()
  // await cron.save()
}

// if (process.argv.length >= 3)
//   main({
//     fileName: process.argv[2],
//     url: process.argv.length === 4 ? process.argv[3] : undefined
//   })
//     .then(() => {
//       dataSource.destroy()
//       if (process.argv[2]) {
//         fs.unlink(process.argv[2])
//       }
//     })
//     .catch(console.error)

main({ fileName: 'Sigvaris.csv' })
