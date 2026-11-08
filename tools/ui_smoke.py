"""UI smoke/regression test (needs `playwright` + Chromium; serves the repo with python -m http.server).
   python3 tools/ui_smoke.py   -> prints PASS/FAIL lines and exits non-zero on any failure."""
import subprocess, sys, time, json, os
from playwright.sync_api import sync_playwright
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
fails = []; errs = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else '')); 
    if not cond: fails.append(name)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 950})
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and '404' not in m.text else None); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://localhost:8766/index.html'); pg.wait_for_selector('#map', timeout=20000)
        ev = lambda js: pg.evaluate(js)
        # 1 every workspace/tab renders without a view error
        for ws, tabs in {'Map': [], 'Polity': ['Questions', 'Estates', 'Laws', 'Government'], 'Apparatus': [], 'Economy': ['Pools', 'Goods & Prices', 'Trade Zones', 'Flow', 'Ledger & Credit', 'Money'], 'World': ['Relations', 'Treaties', 'Mirror', 'Military']}.items():
            pg.click(f'#ws-{ws}'); pg.wait_for_timeout(250)
            for t in tabs: pg.click(f'button.tab:text-is("{t}")'); pg.wait_for_timeout(200)
            check(f'{ws} renders ({len(tabs)} tabs)', pg.locator('pre.err').count() == 0, pg.locator('pre.err').first.inner_text() if pg.locator('pre.err').count() else '')
        # 2 scoped tax law: Estate scope -> draft -> preview -> queue -> end turn -> the law holds a scoped entry
        pg.click('#ws-Polity'); pg.click('button.tab:text-is("Government")'); pg.wait_for_timeout(250)
        pg.select_option('#scope-estate', 'peasants'); pg.wait_for_timeout(300)
        check('scope label shows the Estate', 'peasants' in pg.inner_text('#scope-label'))
        pg.click('#draft-tax'); pg.wait_for_selector('#draftSheet'); pg.fill('input[name=market]', '0.2'); pg.dispatch_event('input[name=market]', 'change'); pg.click('#draft-preview'); pg.wait_for_timeout(300)
        check('preview shows the taxLaw gate verdict', 'taxLaw' in pg.inner_text('#verdict'), pg.inner_text('#verdict'))
        pg.click('#draft-queue'); pg.wait_for_timeout(400); check('order lands in the tray', pg.locator('.order[data-order]').count() == 1)
        pg.click('#end'); pg.wait_for_timeout(1200)
        law = ev("elental.client.state.polity.law.vantiria.duties.Taxation")
        check('law now holds an Estate-scoped entry (taxes are not country-wide only)', any(e['scope'].get('kind') == 'estate' and e['scope'].get('estate') == 'peasants' and abs(e['value']['market'] - 0.2) < 1e-9 for e in law), json.dumps(law)[:200])
        if pg.locator('#modal .sheet').count(): pg.click('#modal button.primary')
        # 3 invalid scope (Nation + Estate without Region) is flagged and cannot be drafted
        pg.select_option('#scope-nation', 'vantir'); pg.wait_for_timeout(300); check('Nation+Estate flagged', 'bad' in (pg.get_attribute('#scope-label', 'class') or ''))
        pg.click('#draft-tax'); pg.wait_for_selector('#draftSheet'); pg.click('#draft-preview'); pg.wait_for_timeout(250); check('preview refuses an impossible scope', 'Region' in pg.inner_text('#verdict'), pg.inner_text('#verdict')); pg.click('#draftSheet button:text-is("Cancel")')
        pg.click('#scope-reset'); pg.wait_for_timeout(300)
        # 4 Laws matrix: click a cell opens a pre-filled Reform draft
        pg.click('button.tab:text-is("Laws")'); pg.wait_for_timeout(300); pg.locator('td.lawcell').first.click(); pg.wait_for_selector('#draftSheet'); check('Laws cell opens a Reform draft', 'Reform' in pg.inner_text('#draftSheet')); pg.click('#draftSheet button:text-is("Cancel")')
        # 5 Estates row -> docked cell card; Map hex -> docked province card
        pg.click('button.tab:text-is("Estates")'); pg.wait_for_timeout(300); pg.locator('table.grid tbody tr.click').first.click(); pg.wait_for_timeout(500); check('Estates row docks a cell card', 'Cell ' in pg.inner_text('#dock'))
        pg.click('#ws-Map'); pg.wait_for_timeout(400); box = pg.locator('#map').bounding_box(); pg.mouse.click(box['x'] + box['width'] * 0.3, box['y'] + box['height'] * 0.4); pg.wait_for_timeout(500); check('Map click docks a province card', 'Province p:' in pg.inner_text('#dock'), pg.inner_text('#dock')[:80])
        pg.select_option('#lens', 'goods'); pg.wait_for_timeout(500); check('Goods lens exposes its good selector', pg.locator('#lensparam').count() == 1)
        # 6 World: declare war through the draft menu, resolve, see it in Military
        pg.click('#ws-World'); pg.wait_for_timeout(300); pg.select_option('#draftmenu', 'declareWar'); pg.wait_for_selector('#draftSheet'); pg.click('#draft-queue'); pg.wait_for_timeout(400); pg.click('#end'); pg.wait_for_timeout(1500)
        if pg.locator('#modal .sheet').count(): pg.click('#modal button.primary')
        check('war declared via the UI', ev("elental.client.state.war.wars.length") == 1)
        pg.click('button.tab:text-is("Military")'); pg.wait_for_timeout(300); check('Military lists the war', 'ACTIVE' in pg.inner_text('#main') or 'declared' in pg.inner_text('#main'))
        # 7 Debug toggle reveals raw views
        pg.check('#debug'); pg.wait_for_timeout(500); pg.click('#ws-Polity'); pg.click('button.tab:text-is("Government")'); pg.wait_for_timeout(400); check('Debug shows View raw', pg.locator('details.raw').count() >= 1)
        b.close()
finally:
    srv.terminate()
check('no console/page errors', not errs, '; '.join(errs[:3]))
sys.exit(1 if fails else 0)
