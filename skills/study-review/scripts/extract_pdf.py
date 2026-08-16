#!/usr/bin/env python3
"""Extract text from a PDF via Ghostscript (`gs`), optionally rendering pages to PNG
for visual analysis. Uses only the Python standard library plus the `gs` binary.

Usage:
  python3 extract_pdf.py file.pdf                       # text to stdout
  python3 extract_pdf.py file.pdf --out out.md          # text to a file
  python3 extract_pdf.py file.pdf --render-dpi 150      # also render every page to PNG
  python3 extract_pdf.py file.pdf --render-dpi 150 --pages 3-8
  python3 extract_pdf.py file.pdf --render-out dir      # where rendered pages go (default: ./pdf_pages)

Output conventions (consumed by the study-review skill):
  - Text output uses "--- Page N ---" separators; empty pages are marked "[空白页]".
  - Rendered pages are named page-001.png, page-002.png, ... (zero-padded to the
    total page count) for direct use with the read_image tool.
  - If text extraction yields garbled/empty content for a page, the skill should
    mark it for visual review ([Visual requires manual review]) rather than guessing.

Notes:
  - Formulas/scripts/superscripts are often mangled in the text layer; the skill
    must verify them against a rendered page and use [Formula needs verification]
    when they cannot be confirmed.
  - If `gs` is missing: try `brew install ghostscript` (macOS) / `apt install
    ghostscript` (Debian). A .doc/.docx can be converted with macOS `textutil`.
  Exit codes: 0 ok, 3 gs missing or input missing, 4 gs failed.
"""

import argparse
import glob as _glob
import os
import re
import shutil
import subprocess
import sys
import tempfile


def find_gs():
    for name in ("gs", "gsc"):
        p = shutil.which(name)
        if p:
            return p
    return None


def run(cmd, timeout=600):
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(
            "命令失败: " + " ".join(cmd) + "\n" + (proc.stderr or proc.stdout or "")[-2000:]
        )
    return proc


def natural_key(path):
    m = re.search(r"(\d+)$", path)
    return int(m.group(1)) if m else path


def extract_text(gs, pdf, out_file):
    """One txtwrite pass with a %d output pattern yields one file per page, which
    gives both reliable page separation and the exact page count."""
    with tempfile.TemporaryDirectory() as td:
        pat = os.path.join(td, "page-%d.txt")
        run([gs, "-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=txtwrite",
             f"-sOutputFile={pat}", pdf])
        files = sorted(_glob.glob(os.path.join(td, "page-*.txt")), key=natural_key)
        lines = []
        for i, f in enumerate(files, start=1):
            with open(f, encoding="utf-8", errors="replace") as fh:
                content = fh.read().strip()
            lines.append(f"--- Page {i} ---")
            lines.append(content if content else "[空白页]")
        text = "\n".join(lines) + "\n"
    if out_file:
        os.makedirs(os.path.dirname(os.path.abspath(out_file)), exist_ok=True)
        with open(out_file, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"[已写入] {out_file}（共 {len(files)} 页）")
    else:
        sys.stdout.write(text)
    return len(files)


def render_pages(gs, pdf, render_out, dpi, pages, total=None):
    os.makedirs(render_out, exist_ok=True)
    if total is None:
        # Unknown count: render everything with a wide pattern, then recount.
        run([gs, "-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=png16m", f"-r{dpi}",
             f"-sOutputFile={os.path.join(render_out, 'page-%03d.png')}", pdf])
        files = sorted(_glob.glob(os.path.join(render_out, "page-*.png")), key=natural_key)
        print(f"[渲染] 共 {len(files)} 页 -> {render_out}")
        return files
    width = len(str(total))
    first, last = 1, total
    if pages:
        m = re.match(r"^(\d+)(?:-(\d+))?$", pages.strip())
        if m:
            first = int(m.group(1))
            last = int(m.group(2) or m.group(1))
            if last > total:
                last = total
    pat = os.path.join(render_out, f"page-%0{width}d.png")
    run([gs, "-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=png16m", f"-r{dpi}",
         f"-dFirstPage={first}", f"-dLastPage={last}", f"-sOutputFile={pat}", pdf])
    files = sorted(_glob.glob(os.path.join(render_out, "page-*.png")), key=natural_key)
    print(f"[渲染] 第 {first}-{last} 页 -> {render_out}（共 {len(files)} 个文件）")
    return files


def main():
    ap = argparse.ArgumentParser(description="PDF text extraction + page rendering via Ghostscript")
    ap.add_argument("file", help="input PDF")
    ap.add_argument("--out", help="write text to FILE instead of stdout")
    ap.add_argument("--render-dpi", type=int, default=0, help="render pages to PNG at this DPI (e.g. 150)")
    ap.add_argument("--render-out", default="pdf_pages", help="directory for rendered pages (default: pdf_pages)")
    ap.add_argument("--pages", help="page range for rendering, e.g. 1-5 or 3")
    args = ap.parse_args()

    if not os.path.isfile(args.file):
        print(f"[错误] 文件不存在: {args.file}", file=sys.stderr)
        return 3
    if not args.file.lower().endswith(".pdf"):
        print(f"[错误] 不是 PDF 文件: {args.file}", file=sys.stderr)
        return 3

    gs = find_gs()
    if gs is None:
        print("[错误] 未找到 Ghostscript（gs）。请先安装：macOS: brew install ghostscript；"
              "Debian/Ubuntu: sudo apt install ghostscript。\n"
              "备选：.doc/.docx 可用 macOS textutil（textutil -convert txt file.doc）；"
              "图片型页面可标注 [Visual requires manual review] 交给人工。", file=sys.stderr)
        return 3

    try:
        total = extract_text(gs, args.file, args.out)
        if args.render_dpi:
            render_pages(gs, args.file, args.render_out, args.render_dpi, args.pages, total)
    except RuntimeError as e:
        print(f"[错误] {e}", file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
