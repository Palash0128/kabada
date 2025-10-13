import { eachOfLimit } from 'async'
import { load } from 'cheerio'
import fs, { readFile, writeFile } from 'fs/promises'

const headers = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  Cookie:
    'MMS_SEGMENT=HME; _ga=GA1.1.549840908.1751879365; _mkto_trk=id:837-LBN-556&token:_mch-mckesson.com-95040a59297024ea1a2d7af2f731da8d; _pendo_visitorId.1291695225=_PENDO_T_c0SRFFc9EIS; visid_incap_1802153=eEzcpQ4XTR2E/l+RWeQsKzz3cGgAAAAAQUIPAAAAAAACYVUXrbrQE8M07G0PfWIt; visid_incap_2258952=zxkycSgBR5CngDxp3yl1AuJX42gAAAAAQUIPAAAAAAD25EF5cyEbMkb9v/axeSzh; _gcl_au=1.1.1627710876.1759729638.608540455.1759729777.1759729799; visid_incap_734530=yAFqq19yS+Oi6DgMbNoHno1Y42gAAAAAQUIPAAAAAABchnl6CW7Ozl5MYaOHCGZ3; visid_incap_2420321=xIaDxNmqTqaZjRQL8KTOFpBY42gAAAAAQUIPAAAAAAA3358LDfT180d6qz4KVThT; visid_incap_379597=CJIfCH5YTOSv0Mg9Is/8PK5a42gAAAAAQUIPAAAAAAB6rhO1AHY93Jd8e0QzDGUL; visid_incap_2754305=xBbuFbkfSvGLlBUgMCIAY8uD42gAAAAAQUIPAAAAAACzVtcGYnyUHxHDx6F9V0sp; dtCookie=v_4_srv_8_sn_05B1431356409ADD80910FE70BFC47E8_perc_100000_ol_0_mul_1_app-3A508ede8ee0d1bd82_1; nlbi_2754305=D2UTMETBUn/PsdkJ+tP4sQAAAAD7Q15uGWY2OLOxNT6VWXIh; rxVisitor=1760335118150IBJDBQ9KM4VB8VGJ3R8O0TDV1EIMJECC; _pendo_unsentEvents.13c233e2-295d-454b-406e-7fb811695c5a=; _pendo_visitorId.13c233e2-295d-454b-406e-7fb811695c5a=; _pendo_accountId.13c233e2-295d-454b-406e-7fb811695c5a=; _pendo_meta.13c233e2-295d-454b-406e-7fb811695c5a=; _pendo_meta.1291695225=357204499; _pendo_sessionId.13c233e2-295d-454b-406e-7fb811695c5a=; _pendo_oldVisitorId.13c233e2-295d-454b-406e-7fb811695c5a=; _pendo_guides_blocked.13c233e2-295d-454b-406e-7fb811695c5a=0; nlbi_734530=66RJSZVKRkIm6MLl3o+ICwAAAACoaMFPVDqs5n4wz/rioVJQ; session-expiration-logged-in=true; incap_ses_937_2420321=a9+zRrBYcEGIfb1pmeQADXuV7GgAAAAA4LX8uAOR3z7vVIQP6oJgRg==; incap_ses_939_379597=5d/+PaFgoytmLPKzlv8HDYOV7GgAAAAA1VmmPijxgGagV3qUKFrRng==; liveagent_oref=https://portal.mms.mckesson.com/; community-alert-expanded=false; liveagent_sid=319200fd-afde-44dd-b7a6-47096ab03d26; liveagent_vc=4; liveagent_ptid=319200fd-afde-44dd-b7a6-47096ab03d26; nlbi_379597=MxuOJUPAtEbbXM9Rjnyz5wAAAAB0itX2PQCNpRcY02PIhvGw; incap_ses_937_2754305=8k06STzeI1nCewRqmeQADey47GgAAAAABwgFvDqeeZDJsaNMIJt2mg==; _pendo_utm.1291695225=%7B%22channel%22%3A%22Referral%22%2C%22referrer%22%3A%22mms.mckesson.com%22%7D; incap_ses_932_2258952=sItnE8WgQA7d5oCBNyHvDNG57GgAAAAAE1r3NuY9GFUaDterE4E5MQ==; _pendo_utm.13c233e2-295d-454b-406e-7fb811695c5a=%7B%22channel%22%3A%22Referral%22%2C%22referrer%22%3A%22mms.mckesson.com%22%7D; nlbi_2754305_2147483392=H2E8IvpqWyCBsNur+tP4sQAAAABXUC9rIR2MZ2dGP5r7wwN2; _ga_5DWL0JSNDR=GS2.1.s1760344524$o77$g1$t1760344543$j41$l0$h0; _ga_4XF20JDM68=GS2.1.s1760344524$o96$g1$t1760344543$j41$l0$h0; _pendo_sessionId.1291695225=%7B%22sessionId%22%3A%22VERVHowac667nLCW%22%2C%22timestamp%22%3A1760344543166%7D; bWNrZXNzb24uY29t-_lr_tabs_-autd9h%2Fprod-supplymanager={%22recordingID%22:%226-0199dcb5-c171-7748-9fb8-e95ff0cc20f3%22%2C%22sessionID%22:0%2C%22lastActivity%22:1760344543200%2C%22hasActivity%22:false%2C%22confirmed%22:true%2C%22clearsIdentifiedUser%22:false}; bWNrZXNzb24uY29t-_lr_hb_-autd9h%2Fprod-supplymanager={%22heartbeat%22:1760344543200}; _br_uid_2=uid%3D3229826637124%3Av%3D15.0%3Ats%3D1751879368086%3Ahc%3D168; SIMONESESSIONID=MzM0M2MxZTktNjIwYy00ZTllLTgyMzYtZjFkNjM0ZDAwOTgx; incap_ses_937_734530=gXMXYn9D4CQpfQZqmeQADeS57GgAAAAAys8WqTq5oV8wYgRt3Po0Aw==; dtSa=false%7C_load_%7C2%7C_onload_%7C-%7C1760344539958%7C544542698_32%7Chttps%3A%2F%2Fportal.mms.mckesson.com%2Fforward-external%7C%7C%7C%7C; session-expiration-client-time-offset=13451; nlbi_734530_2147483392=1HBmWvlreDMezJOR3o+ICwAAAAA742QfUa4iN1pumgJNGtS5; reese84=3:v1fffy7TRQrekmL9iJEnjw==:U8SPeztiOjI5bQqRJDaHYekjOKVl8aHhtsNZuWS7E135SBfNVgR/ZdStU3+LJnia/lm7ZdrdMzONf3YtDjqJrIZCGAQK/KDhLF+672n82PkHRrlPyS3cuSFa7MM9fN/GAlRfNLmVOeZgVQSD1SSnENbDBCYmqFxiKbHIjeuX8cbKFZRiFboR075K+CkENQmpNvIF4rU4SbYdVcpSL/wnCLwPtqOty2i2CjnV2T0OIHxbQLiN+mg/go0QkXEcMigquCkHqyC1FFVB0rvRi0LA37a1lulW/fQGr/n14S15eIVdxZcKM+EgKOolokajbcWnfMevi/vVrdVr1sbeT4crieTaocwLtAXotb3qzVczYZDUD4qFWXVCbpSc+fOG3/c/LWfjn82MHnM2UpQXCsjbqvrRKhxM5uWYeiIBX0x56yBogSTXjhVRiGcOv5noRyLPz8/nsusk4GSkifAxvVOXdq4LrqshjNW7LuwPt3ubyZ8=:HRfZX7JF2iqBE1fMi0CajR6q+9E5zlD98OvXPs65vGU=; session-expiration-server-time=1760344563613; session-expiration-timeout-time=1760346363613; rxvt=1760346364494|1760343665078; dtPC=8$544550190_591h11vALBFEFFVTMURDKUVVTPUUCSUOWFDUURE-0e0',
  'X-Csrf-Token': '9b8e2521-edd5-4af0-8859-05101df08358',
  'Content-Type': 'application/json',
  Accept: 'application/json'
}

const main = async () => {
  const data = JSON.parse(await readFile('mckesson.json', 'utf-8'))

  const tempData = []
  const errors = []

  console.time('1')
  await eachOfLimit(data, 45, async (item, index) => {
    console.log('1', parseInt(index.toString()) + 1, data.length)
    console.timeLog('1')

    try {
      const res1 = await fetch(
        'https://mckesson-scrapper-api-145843037670.us-central1.run.app/api/1',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            headers,
            id: item.id
          })
        }
      )
      if (res1.status !== 200) throw new Error('Failed to fetch data')

      const json1 = await res1.json()
      const html = json1.html

      let flag = false
      const $ = load(html)
      $('.product-item').each((_, el) => {
        if (
          $('.product-header-id', el).text().replace('#', '').trim() ===
          item.id.toString()
        ) {
          flag = true
          tempData.push({
            url: 'https://mms.mckesson.com/catalog?query=' + item.id,
            id: item.id,
            mfr: $('.product-header li:nth-last-child(1)', el)
              .text()
              ?.split('#')[1],
            name: $('.item-title.h4', el).text().trim(),
            categoryName: item.categoryName || ''
          })
        }
      })

      if (!flag)
        errors.push({
          id: item.id,
          error: 'No price data found'
        })
    } catch (err) {
      errors.push({
        id: item.id,
        error: err.message
      })
    }
  })
  console.timeEnd('1')

  const finalData = []

  console.time('2')
  await eachOfLimit(tempData, 45, async (item, index) => {
    console.log('2', parseInt(index.toString()) + 1, tempData.length)
    console.timeLog('2')

    try {
      const res2 = await fetch(
        'https://mckesson-scrapper-api-145843037670.us-central1.run.app/api/2',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            headers,
            body: [
              {
                itemId: item.id
              }
            ]
          })
        }
      )

      if (res2.status !== 200) throw new Error('Failed to fetch data')

      const json2 = await res2.json()

      const availability = json2.json

      if (availability.length) {
        for (const uom of availability[0]?.itemUoms) {
          finalData.push({
            ...item,
            stockMessage: availability[0].status.detail,
            stockStatus: availability[0].status.title,
            uom: uom.units,
            uomToEach: uom.eaches,
            price: uom.price,
            categoryName: item.categoryName || ''
          })
        }
      } else {
        errors.push({
          id: item.id,
          error: 'No availability data found'
        })
      }
    } catch (err) {
      errors.push({
        id: item.id,
        error: err.message
      })
    }
  })
  console.timeEnd('2')
  console.log('finalData', finalData)

  // const parser = new Parser()
  // const csv = parser.parse(finalData)

  // const parser2 = new Parser()
  // const csv2 = parser2.parse(errors)

  if (finalData.length)
    await writeFile('mckesson-data.json', JSON.stringify(finalData, null, 2))

  if (errors.length)
    await fs.writeFile('mckesson-errors.json', JSON.stringify(errors, null, 2))
}

main()
