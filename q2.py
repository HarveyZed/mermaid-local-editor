import re
from playwright.sync_api import sync_playwright
CHROME = "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome"
APP = "/workspace/lme/output/mermaid-local-editor.html"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--disable-dev-shm-usage"])
    pg = b.new_page(); pg.goto("file://"+APP); pg.wait_for_timeout(1200)
    out = pg.evaluate("""async () => {
      const m = (window.__esbuild_esm_mermaid_nm?.mermaid?.default) || window.mermaid;
      const code = "quadrantChart\\n    title 工具选型\\n    x-axis 低成本 --> 高成本\\n    y-axis 低收益 --> 高收益\\n    quadrant-1 值得投入\\n    quadrant-2 先放放\\n    quadrant-3 淘汰\\n    quadrant-4 顺手做\\n    Mermaid: [0.3, 0.75]\\n    Draw.io: [0.55, 0.6]\\n    Excalidraw: [0.25, 0.4]\\n    Visio: [0.85, 0.45]\\n";
      const { svg } = await m.render('qq1', code);
      const idx = [];
      const re = /NaN/g; let mm;
      while ((mm = re.exec(svg)) !== null) idx.push(svg.slice(Math.max(0,mm.index-70), mm.index+40));
      return idx;
    }""")
    for frag in out: print(repr(frag))
    b.close()
