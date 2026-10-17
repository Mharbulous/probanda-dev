#!/usr/bin/env node
// Looks up one lawyer in the Law Society of BC Lawyer Directory. Sends the name to
// www.lawsociety.bc.ca only. Usage: node lsbc-lookup.cjs <last name> [first name]
const https = require('https');

function lsbcFetch(path, cookies) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'www.lawsociety.bc.ca', path,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    };
    if (cookies) opts.headers['Cookie'] = cookies;
    https.get(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const sc = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        resolve({ status: res.statusCode, data: d, cookies: sc });
      });
    }).on('error', reject);
  });
}

async function verifyBCLawyer(lastName, firstName) {
  // Step 1: Search (try "starts with" first, fall back to "contains")
  for (const searchType of [1, 2]) {
    const path = `/lsbc/apps/lkup/directory/mbr-search.cfm?txt_search_type=${searchType}&txt_last_nm=${encodeURIComponent(lastName)}&txt_given_nm=${encodeURIComponent(firstName || '')}&txt_city=&is_submitted=1&member_search=Search&results_no=10`;
    const search = await lsbcFetch(path);

    // Step 2: Parse results — strip #fragment from encrypted links
    const linkRx = /href="mbr-details\.cfm\?encrypted=([^"]+)">\s*([^<]+)/g;
    const results = [];
    let m;
    while ((m = linkRx.exec(search.data)) !== null) {
      results.push({ encrypted: m[1].replace(/#.*$/, ''), name: m[2].trim() });
    }

    if (results.length === 0) {
      if (searchType === 1) continue; // try "contains" next
      console.log('Not found in LSBC directory.');
      return null;
    }

    console.log(`Found ${results.length} result(s) [search type: ${searchType === 1 ? 'starts with' : 'contains'}]`);

    // Step 3: Detail page with session cookies
    const detail = await lsbcFetch(
      `/lsbc/apps/lkup/directory/mbr-details.cfm?encrypted=${results[0].encrypted}`,
      search.cookies
    );

    if (detail.status !== 200) {
      console.error('Detail page failed:', detail.status);
      return null;
    }

    // Step 4: Parse — multiline regex to extract label/value pairs
    const extract = (label) => {
      const rx = new RegExp(
        label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '</div>[\\s\\S]*?<div class="col-sm-9">[\\s\\S]*?([\\s\\S]*?)</div>',
        'i'
      );
      const match = detail.data.match(rx);
      if (!match) return 'Not found';
      return match[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\[\s*Show Map\s*\]/g, '')
        .replace(/QRCode/g, '')
        .replace(/\[\s*Add to Outlook Contacts\s*\]/g, '')
        .replace(/\[\s*Show QRCode\s*\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    return {
      name: results[0].name,
      status: extract('Current status'),
      firm: extract('Primary location'),
      address: extract('Contact address'),
      phone: extract('Phone number'),
      restrictions: extract('Current practice restrictions'),
      discipline: extract('Discipline history since 1983'),
      allResults: results.map(r => r.name)
    };
  }
}

const [lastName, firstName] = process.argv.slice(2);
if (!lastName) {
  console.error('Usage: node lsbc-lookup.cjs <last name> [first name]');
  process.exit(2);
}
verifyBCLawyer(lastName, firstName).then(r => {
  if (r) console.log(JSON.stringify(r, null, 2));
});
