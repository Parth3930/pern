import { chromium } from 'playwright';

async function main() {
    const query = process.argv[2];
    if (!query) return;

    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        await page.goto(`https://search.yahoo.com/search?p=${encodeURIComponent(query)}`, { 
            waitUntil: 'domcontentloaded',
            timeout: 10000
        });
        
        const results = await page.$$eval('.algo, .algo-sr', nodes => {
            const items = [];
            for (const n of nodes) {
                const t = n.querySelector('h3');
                const s = n.querySelector('.compText');
                if (t && s) {
                    const title = t.innerText.replace(/\n+/g, ' ').trim();
                    const snippet = s.innerText.replace(/\n+/g, ' ').trim();
                    if (title && snippet) {
                        items.push(`Title: ${title}\nSnippet: ${snippet}`);
                    }
                }
            }
            return items.slice(0, 5);
        });
        
        if (results.length > 0) {
            console.log(results.join('\n\n'));
        } else {
            // fallback
            const text = await page.innerText('body');
            console.log(text.replace(/\n+/g, ' ').slice(0, 1000));
        }
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await browser.close();
    }
}

main();
