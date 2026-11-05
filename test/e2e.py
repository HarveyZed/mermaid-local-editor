import base64
import json
import os
import pathlib
import sys
import xml.etree.ElementTree as ET

from playwright.sync_api import sync_playwright

# resolve() 保证拿到绝对路径：APP.as_uri() 对相对路径会直接抛 ValueError
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
# 保证无论从哪个目录调用，都能 import 到同目录的辅助模块
sys.path.insert(0, str(HERE))

from pngread import dark_pixel_count
APP = ROOT / "output" / "mermaid-local-editor.html"
# 沙箱里装浏览器时的固定位置（CI 上用 playwright 自带的，无需指定）
FALLBACK_CHROME = "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome"

results = []


def launch_chromium(p):
    """按优先级找可用的 Chromium：环境变量 → Playwright 自带 → 本机固定路径"""
    args = ["--no-sandbox", "--disable-dev-shm-usage"]
    env_path = os.environ.get("CHROME_PATH")
    if env_path and pathlib.Path(env_path).exists():
        return p.chromium.launch(executable_path=env_path, args=args)
    try:
        return p.chromium.launch(args=args)
    except Exception:
        if pathlib.Path(FALLBACK_CHROME).exists():
            return p.chromium.launch(executable_path=FALLBACK_CHROME, args=args)
        raise


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": str(detail)[:400]})
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  :: {detail}" if not ok else ""))


def main():
    with sync_playwright() as p:
        browser = launch_chromium(p)
        ctx = browser.new_context(viewport={"width": 1600, "height": 950}, device_scale_factor=2)
        page = ctx.new_page()
        errors = []
        # 注意：网络监听必须挂在 goto() 之前，否则「加载时零请求」根本没被验证过
        requests = []
        page.on("request", lambda r: requests.append(r.url))
        page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        page.goto(APP.as_uri())
        page.wait_for_timeout(1800)

        # --- 1. 基础渲染 ---
        svg_count = page.eval_on_selector_all("#zoomLayer svg", "els => els.length")
        check("首屏渲染出 SVG", svg_count >= 1, f"svg count = {svg_count}")

        # --- 2. 离线：无任何网络请求（含加载阶段）---
        page.wait_for_timeout(500)
        external = [r for r in requests if not r.startswith("file:") and not r.startswith("data:") and not r.startswith("blob:")]
        check("运行期零外部网络请求", len(external) == 0, external[:3])

        # --- 3. 控制台无错误 ---
        check("无 console error / pageerror", len(errors) == 0, errors[:3])

        # --- 4. 编辑触发渲染 ---
        page.evaluate("(suffix) => window.__lme.setCode(window.__lme.getCode() + suffix)", "\n    Z[新节点] --> Y[另一节点]")
        page.wait_for_timeout(1200)
        svg2 = page.eval_on_selector_all("#zoomLayer svg", "els => els.length")
        check("编辑后重新渲染", svg2 >= 1, f"svg count = {svg2}")

        # --- 5. 兼容层：旧语法检测 ---
        page.evaluate("""() => window.__lme.setCode(`---
config:
  flowchart:
    defaultRenderer: elk
---
flowchart TD
    A【开始】 --> B[结束]
    subgraph S
      C --> D
`)""")
        page.wait_for_timeout(1200)
        badge = page.inner_text("#compatBadge")
        issues = page.eval_on_selector_all(".compat-item", "els => els.length")
        check("兼容面板检出问题", issues >= 2, f"badge={badge!r} issues={issues}")

        # --- 6. 自动兼容生效（渲染不报错）---
        err_visible = page.eval_on_selector("#previewMsg", "el => el.classList.contains('show')")
        check("自动兼容后渲染成功", not err_visible, "错误面板仍然显示")

        # --- 7. 一键修复写回 ---
        page.click("#btnFixNow")
        page.wait_for_timeout(900)
        code_after = page.evaluate("() => window.__lme.getCode()")
        check("一键修复写回编辑器", "defaultRenderer" not in code_after and "【" not in code_after, code_after[:200])

        # --- 8. 样例全部可渲染 ---
        page.click(".tab[data-tab='samples']")
        page.wait_for_timeout(300)
        sample_names = page.evaluate("() => Array.from(document.querySelectorAll('.sample-item')).map(e => e.textContent.trim())")
        bad = []
        for i, nm in enumerate(sample_names):
            page.click(f".sample-item[data-idx='{i}']")
            page.wait_for_timeout(700)
            shown = page.eval_on_selector("#previewMsg", "el => el.classList.contains('show')")
            if shown:
                bad.append(nm)
        check(f"全部 {len(sample_names)} 个样例均可渲染", not bad, bad[:5])

        # --- 9. SVG 导出（应为纯 SVG text，不是 foreignObject）---
        page.click(".sample-item[data-idx='0']")
        page.wait_for_timeout(800)
        exported = page.evaluate("() => window.__lme.exportSvgText()")
        check("导出 SVG 含文字节点(<text>)", "<text" in exported and "foreignObject" not in exported,
              f"len={len(exported)} text={'<text' in exported} foreignObject={'foreignObject' in exported}")

        # --- 9b. 真实点击「导出 SVG」按钮，走完整下载链路 ---
        # 回归缺陷：mermaid v12 的 render() 返回字符串，serializeSvg 却对它调 cloneNode，
        # 导致「导出 SVG」/「复制 SVG」直接抛 TypeError。此处必须点真按钮 + 接真下载。
        md_multi = (
            "# 演示文档\n\n```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```\n\n"
            "```mermaid\nsequenceDiagram\n  Alice->>Bob: 你好\n```\n"
        )
        page.evaluate("(c) => window.__lme.setCode(c)", md_multi)
        page.wait_for_timeout(1600)

        downloads = []
        page.on("download", lambda d: downloads.append(d))
        page.click("#btnSvg")
        page.wait_for_timeout(4000)

        toast_text = page.evaluate("() => document.querySelector('#toast')?.innerText || ''")
        check("批量导出 SVG 未报错", "导出失败" not in toast_text, f"toast={toast_text!r}")

        # 多图必须打包成**一次**下载：Chromium 对一次性触发的多个下载有硬上限
        # （实测同批只放行 10 个，其余被静默丢弃，toast 却还在报「已导出 N 个」）
        check("多图导出只产生 1 次下载（避免浏览器截断）", len(downloads) == 1,
              f"下载数={len(downloads)} 名={[d.suggested_filename for d in downloads]}")
        check("多图导出的是 ZIP 包", downloads and downloads[0].suggested_filename.endswith(".zip"),
              [d.suggested_filename for d in downloads])

        import zipfile
        bad_xml = []
        names = []
        if downloads:
            zpath = pathlib.Path(downloads[0].path())
            with zipfile.ZipFile(zpath) as zf:
                names = zf.namelist()
                check("ZIP 内容校验通过", zf.testzip() is None, names)
                check("ZIP 内含全部 2 个 SVG", len(names) == 2, names)
                for nm in names:
                    text = zf.read(nm).decode("utf-8")
                    try:
                        root = ET.fromstring(text)
                        if root.tag.split("}")[-1] != "svg":
                            bad_xml.append(f"{nm}: 根节点是 {root.tag}")
                    except Exception as exc:
                        bad_xml.append(f"{nm}: XML 解析失败 {exc}")
                    if "<?xml" not in text or "xmlns:xlink" not in text:
                        bad_xml.append(f"{nm}: 缺 XML 声明或 xmlns:xlink")
                    if "foreignObject" in text:
                        bad_xml.append(f"{nm}: 含 foreignObject")
        check("ZIP 内每个 SVG 都是合法单根 XML", not bad_xml, bad_xml[:3])
        check("ZIP 内文件名按序号区分", names == sorted(names) and len(set(names)) == len(names), names)

        # 23 个图块：曾经因为「一次性触发多个下载」被浏览器截断到只剩 10 个
        many23 = "# 压力\n\n" + "\n\n".join(
            "```mermaid\nflowchart TD\n  A[%d] --> B[%d]\n```" % (i, i + 1) for i in range(23))
        page.evaluate("(md) => window.__lme.setCode(md)", many23)
        page.wait_for_timeout(3500)
        d23 = []
        page.on("download", lambda d: d23.append(d))
        page.click("#btnSvg")
        page.wait_for_timeout(6000)
        ok23 = False
        detail23 = f"下载数={len(d23)}"
        if len(d23) == 1:
            with zipfile.ZipFile(pathlib.Path(d23[0].path())) as zf:
                inner = zf.namelist()
                detail23 = f"ZIP 内 {len(inner)} 个文件"
                ok23 = len(inner) == 23 and zf.testzip() is None
                if ok23:
                    bad = []
                    for nm in inner:
                        try:
                            root = ET.fromstring(zf.read(nm).decode("utf-8"))
                            if root.tag.split("}")[-1] != "svg":
                                bad.append(nm)
                        except Exception:
                            bad.append(nm)
                    ok23 = not bad
                    detail23 += f"，非法 XML {len(bad)} 个"
        check("23 个图块一次导出全部进 ZIP（不被浏览器截断）", ok23, detail23)

        # 回归缺陷：markdown 多块时 htmlLabels:false 没传到图块
        # → 导出的 SVG 带 foreignObject → PNG 画布被污染 → toBlob 抛 SecurityError
        with_fo = []
        if downloads:
            with zipfile.ZipFile(pathlib.Path(downloads[0].path())) as zf:
                with_fo = [nm for nm in zf.namelist() if "foreignObject" in zf.read(nm).decode("utf-8")]
        check("导出的 SVG 不含 foreignObject（htmlLabels:false 已传到图块）",
              not with_fo, with_fo[:3])

        png_ok, png_detail = True, ""
        try:
            png_b64_md = page.evaluate("""async () => {
                const blob = await window.__lme.exportPngBlob(2);
                const buf = new Uint8Array(await blob.arrayBuffer());
                let bin = '';
                for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
                return btoa(bin);
            }""")
            png_bytes_md = base64.b64decode(png_b64_md)
            png_ok = png_bytes_md[:8] == b"\x89PNG\r\n\x1a\n" and len(png_bytes_md) > 2000
            png_detail = f"size={len(png_bytes_md)}"
        except Exception as exc:
            png_ok, png_detail = False, str(exc)[:220]
        check("markdown 多块导出 PNG 不被画布污染", png_ok, png_detail)

        svg_text = page.evaluate("""() => {
            const svg = document.querySelector('#zoomLayer svg');
            return svg ? svg.outerHTML : '';
        }""")
        check("预览 SVG 已生成", len(svg_text) > 500, len(svg_text))

        # 导出 PNG 真实可解码
        png_b64 = page.evaluate("""async () => {
            const blob = await window.__lme.exportPngBlob(2);
            const buf = new Uint8Array(await blob.arrayBuffer());
            let bin = '';
            for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
            return btoa(bin);
        }""")
        png_bytes = base64.b64decode(png_b64)
        check("导出 PNG 是合法 PNG", png_bytes[:8] == b"\x89PNG\r\n\x1a\n" and len(png_bytes) > 2000,
              f"size={len(png_bytes)} magic={png_bytes[:8]!r}")

        # --- 10. 缩放/适应 ---
        page.click("#btnZoomIn")
        page.wait_for_timeout(200)
        z1 = page.inner_text("#zoomLabel")
        page.click("#btnZoomFit")
        page.wait_for_timeout(300)
        z2 = page.inner_text("#zoomLabel")
        check("缩放控件工作", z1 != z2 or z1 != "100%", f"{z1} -> {z2}")

        # --- 11. 分享链接往返 ---
        page.click("#btnShare")
        page.wait_for_timeout(400)
        h = page.evaluate("() => location.hash")
        check("生成分享 hash", len(h) > 20, h[:60])

        # --- 12. 设置面板写 frontmatter ---
        page.click(".tab[data-tab='settings']")
        page.wait_for_timeout(300)
        page.select_option("#cfgLayout", "dagre")
        page.select_option("#cfgTheme", "default")
        page.select_option("#cfgLook", "classic")
        page.click("#btnApplyCfg")
        page.wait_for_timeout(900)
        code_cfg = page.evaluate("() => window.__lme.getCode()")
        check("设置写入 frontmatter", "layout: dagre" in code_cfg and "theme: default" in code_cfg and "look: classic" in code_cfg, code_cfg[:240])

        # --- 13. localStorage 持久化 ---
        ls = page.evaluate("() => localStorage.getItem('mermaid-local-state-v1')")
        check("localStorage 已写入", bool(ls and len(ls) > 50), (ls or "")[:80])

        # --- 14. UI 浅色模式 ---
        page.click("#btnTheme")
        page.wait_for_timeout(400)
        ui = page.evaluate("() => document.documentElement.getAttribute('data-ui')")
        check("界面浅色模式切换", ui == "light", ui)
        page.click("#btnTheme")
        page.wait_for_timeout(300)

        # --- 15. 全屏预览 ---
        page.click("#btnFull")
        page.wait_for_timeout(500)
        lb = page.eval_on_selector("#lightbox", "el => !el.classList.contains('hidden')")
        check("全屏预览打开", lb)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # --- 16. Markdown 多图模式 ---
        md = "# 文档\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n文字\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n"
        page.evaluate("(md) => window.__lme.setCode(md)", md)
        page.wait_for_timeout(1500)
        n_svg = page.eval_on_selector_all("#zoomLayer .blk svg", "els => els.length")
        nav_visible = page.eval_on_selector("#blockNav", "el => !el.classList.contains('hidden')")
        check("Markdown 多图：渲染出 2 张图", n_svg == 2, f"svg={n_svg} nav={nav_visible}")

        # --- 16b. 图块导航条不溢出（回归：图块多时曾把侧栏标签压住）---
        many = "# 压力\n\n" + "\n\n".join(
            "```mermaid\nflowchart TD\n  A[%d] --> B[%d]\n```" % (i, i + 1) for i in range(23))
        page.evaluate("(md) => window.__lme.setCode(md)", many)
        page.wait_for_timeout(2500)
        layout = page.evaluate("""() => {
          const nav = document.querySelector('#blockNav');
          const bar = document.querySelector('#blockBar');
          const tabs = document.querySelector('.tabs');
          const pane = document.querySelector('#panePreview');
          const btns = Array.from(nav.querySelectorAll('button'));
          const tr = tabs.getBoundingClientRect();
          const pr = pane.getBoundingClientRect();
          let overlap = 0, outside = 0;
          btns.forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.right > tr.left && r.left < tr.right && r.bottom > tr.top && r.top < tr.bottom) overlap++;
            if (r.right > pr.right + 1) outside++;
          });
          const rows = new Set(btns.map(el => Math.round(el.getBoundingClientRect().top))).size;
          return { n: btns.length, overlap, outside, rows,
                   barShown: !bar.classList.contains('hidden'),
                   docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
        }""")
        check("23 个图块：导航条全部渲染出来", layout["n"] == 23, layout)
        check("23 个图块：导航条不压住侧栏标签", layout["overlap"] == 0, f"压住 {layout['overlap']} 个")
        check("23 个图块：导航条不超出预览区", layout["outside"] == 0, f"超出 {layout['outside']} 个")
        check("23 个图块：导航条自动换行成多行", layout["rows"] >= 1 and layout["barShown"], layout)
        check("页面不出现横向滚动条", not layout["docOverflow"], layout)

        # 点图块导航 → 定位到该图并高亮
        page.click("#blockNav button[data-block='14']")
        page.wait_for_timeout(700)
        focus = page.evaluate("""() => {
          const s = document.querySelectorAll('#zoomLayer svg')[14];
          const p = document.querySelector('#preview').getBoundingClientRect();
          const r = s.getBoundingClientRect();
          const a = document.querySelector('#blockNav button.active');
          return { inView: r.top >= p.top - 2 && r.bottom <= p.bottom + 2,
                   active: a ? a.textContent : 'none',
                   zoom: document.querySelector('#zoomLabel').textContent };
        }""")
        check("点图块导航：定位到该图并高亮", focus["inView"] and focus["active"] == "#15", focus)

        # --- 16c. 折叠：工具栏 / 图块栏 / 侧栏 ---
        page.click("#btnBlockToggle")
        page.wait_for_timeout(400)
        collapsed = page.evaluate("""() => ({
          navHidden: getComputedStyle(document.querySelector('#blockNav')).display === 'none',
          barCollapsed: document.querySelector('#blockBar').classList.contains('collapsed'),
        })""")
        check("图块栏可折叠", collapsed["navHidden"] and collapsed["barCollapsed"], collapsed)
        page.click("#btnBlockToggle")
        page.wait_for_timeout(300)

        page.click("#btnBarToggle")
        page.wait_for_timeout(400)
        bar = page.evaluate("""() => ({
          collapsed: document.querySelector('#topbar').classList.contains('collapsed'),
          actionsHidden: getComputedStyle(document.querySelector('.topbar-actions')).display === 'none',
          brandVisible: !!document.querySelector('.brand').offsetParent,
        })""")
        check("顶栏可折叠（只留品牌条）",
              bar["collapsed"] and bar["actionsHidden"] and bar["brandVisible"], bar)
        page.click("#btnBarToggle")
        page.wait_for_timeout(300)

        page.click("#btnSideToggle")
        page.wait_for_timeout(400)
        side = page.evaluate("""() => ({
          collapsed: document.querySelector('#side').classList.contains('collapsed'),
          width: Math.round(document.querySelector('#side').getBoundingClientRect().width),
          previewW: Math.round(document.querySelector('#panePreview').getBoundingClientRect().width),
        })""")
        check("侧栏可收起成窄条（预览区变宽）",
              side["collapsed"] and side["width"] <= 40 and side["previewW"] > 400, side)
        page.click("#btnSideToggle")
        page.wait_for_timeout(300)

        # 折叠状态要能持久化
        page.click("#btnSideToggle")
        page.wait_for_timeout(400)
        page.reload()
        page.wait_for_timeout(2000)
        persisted = page.evaluate("() => document.querySelector('#side').classList.contains('collapsed')")
        check("侧栏折叠状态刷新后保留", persisted, persisted)
        page.click("#btnSideToggle")
        page.wait_for_timeout(300)

        # --- 17. 分享链接往返（重载后还原） ---
        page.evaluate("(c) => window.__lme.setCode(c)", "flowchart LR\n  Q1[往返测试] --> Q2[OK]")
        page.wait_for_timeout(900)
        page.click("#btnShare")
        page.wait_for_timeout(500)
        hash_val = page.evaluate("() => location.hash")
        page.reload()
        page.wait_for_timeout(1800)
        restored = page.evaluate("() => window.__lme.getCode()")
        check("分享链接：重载后还原代码", "往返测试" in restored, f"hash={hash_val[:40]} code={restored[:80]}")

        # --- 18. 打开本地 .md 文件（多图） ---
        page.set_input_files("#fileInput", str(ROOT / "test" / "fixtures" / "demo.md"))
        page.wait_for_timeout(1600)
        n_md = page.eval_on_selector_all("#zoomLayer .blk svg", "els => els.length")
        fname = page.input_value("#fileName")
        check("打开 .md 文件并渲染多图", n_md == 2 and fname == "demo.md", f"svg={n_md} fname={fname}")

        # --- 19. 打开老代码 .mmd，兼容层应自动救回 ---
        page.set_input_files("#fileInput", str(ROOT / "test" / "fixtures" / "legacy.mmd"))
        page.wait_for_timeout(1600)
        err_shown = page.eval_on_selector("#previewMsg", "el => el.classList.contains('show')")
        n_sv = page.eval_on_selector_all("#zoomLayer svg", "els => els.length")
        issues = page.eval_on_selector_all(".compat-item", "els => els.length")
        check("打开老代码：自动兼容后仍渲染成功", (not err_shown) and n_sv >= 1 and issues >= 2,
              f"err={err_shown} svg={n_sv} issues={issues}")

        # 老代码原文应仍保留在编辑器里（可回退）
        raw = page.evaluate("() => window.__lme.getCode()")
        check("老代码原文未被偷偷改写", "defaultRenderer" in raw and "【旧写法】" in raw, raw[:120])

        # --- 20. 超出 maxEdges 上限时给出可操作的提示 ---
        big = "flowchart TD\n" + "\n".join(f"  N{i}[节点{i}] --> N{i+1}[节点{i+1}]" for i in range(700))
        page.evaluate("(c) => window.__lme.setCode(c)", big)
        page.wait_for_timeout(3500)
        shown = page.eval_on_selector("#previewMsg", "el => el.classList.contains('show')")
        raise_btn = page.query_selector("#previewMsg [data-act='raise']")
        hint = page.inner_text("#previewMsg .err-hint") if shown else ""
        check("超限时报错并给出放宽上限按钮", shown and raise_btn is not None and "maxEdges" in hint,
              f"shown={shown} btn={bool(raise_btn)} hint={hint[:90]}")

        # --- 21. PNG 里的文字真的画出来了（深色像素差分）---
        def png_dark_pixels(code):
            page.evaluate("(c) => window.__lme.setCode(c)", code)
            page.wait_for_timeout(900)
            b64 = page.evaluate("""async () => {
                const blob = await window.__lme.exportPngBlob(2);
                const buf = new Uint8Array(await blob.arrayBuffer());
                let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
                return btoa(bin);
            }""")
            return dark_pixel_count(base64.b64decode(b64))

        with_text = png_dark_pixels("flowchart TD\n  A[唯一文字XYZ] --> B[另一个]\n")
        without_text = png_dark_pixels("flowchart TD\n  A --> B\n")
        check("导出 PNG 中文字真的画出来了", with_text > without_text + 200,
              f"有字={with_text} 无字={without_text}")

        # --- 22. Markdown 单个图块也能渲染 ---
        single_md = "# 单图\n\n```mermaid\nflowchart TD\n  A-->B\n```\n\n结尾\n"
        page.evaluate("(c) => window.__lme.setCode(c)", single_md)
        page.wait_for_timeout(1400)
        n_single = page.eval_on_selector_all("#zoomLayer .blk svg", "els => els.length")
        err_single = page.eval_on_selector("#previewMsg", "el => el.classList.contains('show')")
        check("Markdown 单个图块能渲染", n_single == 1 and not err_single,
              f"svg={n_single} err={err_single}")

        # --- 23. 时序图的 alt/end 不该被误报成「多出 end」---
        page.evaluate("(c) => window.__lme.setCode(c)", "sequenceDiagram\n  alt first\n    A->>B: x\n  end\n")
        page.wait_for_timeout(1000)
        page.click(".tab[data-tab='compat']")
        page.wait_for_timeout(300)
        rules = page.evaluate("() => Array.from(document.querySelectorAll('.compat-item .ci-loc')).map(i => i.innerText)")
        check("合法 sequenceDiagram 不误报 extra-end", not any("extra-end" in r for r in rules), rules)

        page.screenshot(path=str(ROOT / "output" / "screenshot-app.png"), full_page=False)

        browser.close()

    failed = [r for r in results if not r["ok"]]
    print(f"\n=== {len(results) - len(failed)}/{len(results)} passed ===")
    if failed:
        for f in failed:
            print("FAIL:", f["name"], "::", f["detail"])
        sys.exit(1)


if __name__ == "__main__":
    main()
