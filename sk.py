import re
from playwright.sync_api import sync_playwright
CHROME = "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome"
APP = "/workspace/lme/output/mermaid-local-editor.html"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--disable-dev-shm-usage"])
    pg = b.new_page(); pg.goto("file://"+APP); pg.wait_for_timeout(1200)
    out = pg.evaluate("""async () => {
      const m = (window.__esbuild_esm_mermaid_nm?.mermaid?.default) || window.mermaid;
      const { svg } = await m.render('sk1', 'sankey-beta\\nCoal,Power,80\\nWind,Power,35');
      const hits = [];
      const re = /NaN/g; let mm;
      while ((mm = re.exec(svg)) !== null) hits.push(svg.slice(Math.max(0,mm.index-90), mm.index+30));
      return hits;
    }""")
    for h in out: print(repr(h))
    b.close()
