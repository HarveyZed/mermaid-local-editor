import pathlib
from playwright.sync_api import sync_playwright
CHROME = "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome"
APP = "/workspace/lme/output/mermaid-local-editor.html"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--disable-dev-shm-usage"])
    pg = b.new_page(); pg.goto("file://"+APP); pg.wait_for_timeout(1500)
    code = "quadrantChart\n    title 工具选型\n    x-axis 低成本 --> 高成本\n    y-axis 低收益 --> 高收益\n    quadrant-1 值得投入\n    quadrant-2 先放放\n    quadrant-3 淘汰\n    quadrant-4 顺手做\n    Mermaid: [0.3, 0.75]\n    Draw.io: [0.55, 0.6]\n    Excalidraw: [0.25, 0.4]\n    Visio: [0.85, 0.45]\n"
    pg.evaluate("(c)=>window.__lme.setCode(c)", code); pg.wait_for_timeout(1500)
    print("err:", pg.eval_on_selector("#previewMsg","e=>e.classList.contains('show')"))
    print("raw:", pg.eval_on_selector("#previewMsg .err-raw","e=>e.textContent.slice(0,220)"))
    print("stRender:", pg.inner_text("#stRender"))
    b.close()
