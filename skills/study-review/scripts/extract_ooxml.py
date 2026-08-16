#!/usr/bin/env python3
"""Extract text, structure, tables, math, notes, and media inventory from .pptx / .docx / .xlsx
using ONLY the Python standard library (zipfile + xml). No third-party packages required.

Usage:
  python3 extract_ooxml.py deck.pptx                 # print full extraction to stdout
  python3 extract_ooxml.py deck.pptx --out out.md    # write extraction to a file
  python3 extract_ooxml.py deck.pptx --media dir     # also dump embedded media (images) into dir
  python3 extract_ooxml.py doc.docx [--out out.md]
  python3 extract_ooxml.py book.xlsx [--out out.md] [--sheet-limit N]

Output conventions (consumed by the study-review skill):
  PPTX:  "# <file>" header, per-slide "## Slide N — <title>" blocks, "[公式]" math
         approximation, "[表格]" markdown tables, "[图片: <media path>]" image
         references, "[图表: <chart part>]" native chart references, "### Speaker Notes".
  DOCX:  headings mapped from pStyle (Title/Heading1..), paragraphs, markdown tables.
  XLSX:  per-sheet blocks with rows as TSV lines; formula cells marked "[公式]".

Exit codes: 0 ok, 2 usage error, 3 unsupported/missing input, 4 unreadable archive.
"""

import argparse
import json
import os
import shutil
import sys
import zipfile
from xml.etree import ElementTree as ET

LOCAL_TEXT_TAGS = {"t", "instrText"}  # a:t / w:t / m:t / w:instrText
FORMULA_TAGS = {"oMath", "oMathPara"}  # OMML math containers (local names)
MATH_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"


def local(tag):
    return tag.rsplit("}", 1)[-1]


def is_math(node):
    return (node.tag or "").startswith("{" + MATH_NS + "}")


def children(el, name):
    return [c for c in el if local(c.tag) == name]


def first_child(el, name):
    for c in el:
        if local(c.tag) == name:
            return c
    return None


def attr_local(el, name):
    """Attribute value by local name (survives namespace-expanded attribute keys)."""
    for k, v in el.attrib.items():
        if k.rsplit("}", 1)[-1] == name:
            return v
    return None


def text_of(el):
    """All run text (a:t/w:t/m:t) under el, in document order, excluding OMML math
    runs (those belong to the [公式] approximation, not the paragraph text)."""
    return "".join(n.text or "" for n in el.iter()
                   if local(n.tag) in LOCAL_TEXT_TAGS and not is_math(n))


def math_of(par):
    """Approximate OMML math inside a paragraph: join m:t runs with spaces."""
    parts = []
    for n in par.iter():
        if local(n.tag) in FORMULA_TAGS:
            parts.append("".join(t.text or "" for t in n.iter() if local(t.tag) == "t" and is_math(t)))
    return parts


# ---------------------------------------------------------------- PPTX

def resolve_zip_path(base, target):
    """Resolve a rels Target (relative to base part dir) to a normalized zip path."""
    import posixpath
    return posixpath.normpath(posixpath.join(posixpath.dirname(base), target.lstrip("/")))


def pptx_rels_map(zf, rels_path):
    """rId -> target path (relative to the part's directory, unresolved)."""
    out = {}
    try:
        root = ET.fromstring(zf.read(rels_path))
    except KeyError:
        return out
    for rel in root.iter():
        if local(rel.tag) == "Relationship":
            out[rel.get("Id")] = rel.get("Target", "")
    return out


def pptx_slide_order(zf):
    """List of (slide_path, hidden) in presentation order."""
    try:
        pres = ET.fromstring(zf.read("ppt/presentation.xml"))
    except KeyError:
        return []
    rels = pptx_rels_map(zf, "ppt/_rels/presentation.xml.rels")
    order = []
    for el in pres.iter():
        if local(el.tag) == "sldId":
            rid = el.get("{%s}id" % "http://schemas.openxmlformats.org/officeDocument/2006/relationships") or el.get("r:id")
            target = rels.get(rid)
            if not target:
                continue
            slide_path = resolve_zip_path("ppt/presentation.xml", target)
            hidden = el.get("show") == "0"
            order.append((slide_path, hidden))
    return order


def shape_paragraphs(el):
    """Yield (kind, text, bullets, math) for a shape: kind in title/body."""
    kind = "body"
    ph = None
    for n in el.iter():
        if local(n.tag) == "ph":
            ph = n
            break
    if ph is not None and ph.get("type") in ("title", "ctrTitle"):
        kind = "title"
    tx = first_child(el, "txBody")
    if tx is None:
        return
    for par in children(tx, "p"):
        runs = text_of(par).strip()
        bullets = first_child(par, "pPr") is not None and first_child(first_child(par, "pPr"), "buChar") is not None
        yield kind, runs, bullets, math_of(par)


def extract_pptx(zf, media_dir=None, out_lines=None):
    out = out_lines if out_lines is not None else []
    order = pptx_slide_order(zf)
    if not order:
        out.append("[错误] 无法读取 ppt/presentation.xml（可能是损坏的 .pptx）")
        return
    hidden_count = sum(1 for _, h in order if h)
    out.append(f"共 {len(order)} 页（其中隐藏 {hidden_count} 页）")
    media_map = {}  # media file -> [slides]
    for idx, (slide_path, hidden) in enumerate(order, start=1):
        rels = pptx_rels_map(zf, os.path.join(os.path.dirname(slide_path), "_rels",
                                              os.path.basename(slide_path) + ".rels"))
        title = ""
        out.append(f"\n## Slide {idx}" + ("（隐藏）" if hidden else ""))
        try:
            root = ET.fromstring(zf.read(slide_path))
        except KeyError:
            out.append("  [错误] slide 内容缺失")
            continue
        for el in root.iter():
            tag = local(el.tag)
            if tag == "sp":
                for kind, runs, bullets, math in shape_paragraphs(el):
                    if not runs and not math:
                        continue
                    prefix = "  - " if bullets else ("  标题: " if kind == "title" else "  ")
                    if kind == "title" and not title:
                        title = runs
                    line = prefix + runs
                    if math:
                        line += "  [公式] " + " | ".join(m for m in math if m)
                    out.append(line)
            elif tag == "graphicFrame":
                tbl = None
                chart = None
                for sub in el.iter():
                    if local(sub.tag) == "tbl":
                        tbl = sub
                        break
                    if local(sub.tag) == "chart":
                        chart = sub
                if tbl:
                    out.append("  [表格]")
                    for row in tbl.iter():
                        if local(row.tag) == "tr":
                            cells = []
                            for tc in children(row, "tc"):
                                cells.append(text_of(tc).strip().replace("|", "\\|"))
                            out.append("  | " + " | ".join(cells) + " |")
                if chart is not None:
                    out.append("  [图表: 原生图表对象]")
            elif tag == "pic":
                embed = None
                for blip in el.iter():
                    if local(blip.tag) == "blip":
                        embed = blip.get("{%s}embed" % "http://schemas.openxmlformats.org/officeDocument/2006/relationships") or blip.get("r:embed")
                        break
                if embed and embed in rels:
                    media = resolve_zip_path(slide_path, rels[embed])
                    media_map.setdefault(media, []).append(idx)
                    out.append(f"  [图片: {media}]")
            elif tag == "cxnSp":
                pass  # connector lines: geometry, skip
        # speaker notes
        notes = ""
        for target in rels.values():
            if "notesSlide" in target:
                try:
                    nroot = ET.fromstring(zf.read(resolve_zip_path(slide_path, target)))
                    notes = "\n".join(
                        line for line in (text_of(p).strip() for p in nroot.iter() if local(p.tag) == "p")
                        if line
                    )
                except (KeyError, ET.ParseError):
                    notes = "[错误] notes 读取失败"
        if notes:
            out.append("### Speaker Notes")
            out.append("  " + notes.replace("\n", "\n  "))
    if media_dir:
        os.makedirs(media_dir, exist_ok=True)
        mapping = {}
        for media in sorted(media_map):
            try:
                data = zf.read(media)
            except KeyError:
                continue
            base = os.path.basename(media)
            dest = os.path.join(media_dir, base)
            with open(dest, "wb") as f:
                f.write(data)
            mapping[media] = {"file": base, "slides": media_map[media]}
        with open(os.path.join(media_dir, "media_map.json"), "w", encoding="utf-8") as f:
            json.dump(mapping, f, ensure_ascii=False, indent=2)
        out.append(f"\n[媒体] 已抽取 {len(mapping)} 个媒体文件到 {media_dir}（映射见 media_map.json）")


# ---------------------------------------------------------------- DOCX

def extract_docx(zf, out_lines=None):
    out = out_lines if out_lines is not None else []
    try:
        root = ET.fromstring(zf.read("word/document.xml"))
    except KeyError:
        out.append("[错误] 无法读取 word/document.xml（可能不是有效的 .docx）")
        return
    body = root
    for el in root.iter():
        if local(el.tag) == "body":
            body = el
            break
    for node in body:
        tag = local(node.tag)
        if tag == "p":
            pstyle = ""
            ppr = first_child(node, "pPr")
            if ppr is not None:
                ps = first_child(ppr, "pStyle")
                if ps is not None:
                    pstyle = attr_local(ps, "val") or ""
            txt = text_of(node).strip()
            if not txt:
                continue
            if pstyle.lower().startswith("title"):
                out.append(f"# {txt}")
            elif pstyle.lower().startswith("heading"):
                m = "".join(ch for ch in pstyle if ch.isdigit())
                level = int(m) if m else 1
                out.append("#" * (level + 1) + " " + txt)
            else:
                out.append(txt)
        elif tag == "tbl":
            out.append("[表格]")
            for row in node.iter():
                if local(row.tag) == "tr":
                    cells = [text_of(tc).strip().replace("|", "\\|") for tc in children(row, "tc")]
                    out.append("| " + " | ".join(cells) + " |")


# ---------------------------------------------------------------- XLSX

def xlsx_shared_strings(zf):
    strings = []
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return strings
    for si in root.iter():
        if local(si.tag) == "si":
            strings.append(text_of(si))
    return strings


def extract_xlsx(zf, out_lines=None, sheet_limit=50):
    out = out_lines if out_lines is not None else []
    try:
        wb = ET.fromstring(zf.read("xl/workbook.xml"))
    except KeyError:
        out.append("[错误] 无法读取 xl/workbook.xml（可能不是有效的 .xlsx）")
        return
    rels = pptx_rels_map(zf, "xl/_rels/workbook.xml.rels")
    strings = xlsx_shared_strings(zf)
    sheets = []
    for sh in wb.iter():
        if local(sh.tag) == "sheet":
            rid = sh.get("{%s}id" % "http://schemas.openxmlformats.org/officeDocument/2006/relationships") or sh.get("r:id")
            sheets.append((sh.get("name", "Sheet"), rels.get(rid, "")))
    for name, path in sheets:
        if not path:
            out.append(f"## Sheet: {name}（路径缺失）")
            continue
        out.append(f"\n## Sheet: {name}")
        if not path.startswith("xl/"):
            path = "xl/" + path
        try:
            root = ET.fromstring(zf.read(path))
        except KeyError:
            out.append("  [错误] sheet 内容缺失")
            continue
        count = 0
        for row in root.iter():
            if local(row.tag) == "row":
                cells = []
                for c in children(row, "c"):
                    t = c.get("t", "")
                    f = first_child(c, "f")
                    v = first_child(c, "v")
                    is_el = first_child(c, "is")
                    if is_el is not None:
                        val = text_of(is_el)
                    elif t == "s" and v is not None:
                        val = strings[int(v.text)] if v.text and v.text.isdigit() and int(v.text) < len(strings) else ""
                    elif v is not None:
                        val = v.text or ""
                    else:
                        val = ""
                    if f is not None:
                        val = "[公式] " + val
                    cells.append((c.get("r", ""), val.replace("\t", " ").replace("\n", " ")))
                if cells:
                    out.append("\t".join(f"{r}:{v}" if r else v for r, v in cells))
                    count += 1
                if count >= sheet_limit:
                    out.append(f"  …（已达行数上限 {sheet_limit}，其余行省略）")
                    break


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="stdlib-only extraction for pptx/docx/xlsx")
    ap.add_argument("file", help="input .pptx / .docx / .xlsx")
    ap.add_argument("--out", help="write output to FILE instead of stdout")
    ap.add_argument("--media", help="dump embedded media (pptx/docx/xlsx) into DIR")
    ap.add_argument("--sheet-limit", type=int, default=50, help="max rows per xlsx sheet (default 50)")
    args = ap.parse_args()

    if not os.path.isfile(args.file):
        print(f"[错误] 文件不存在: {args.file}", file=sys.stderr)
        return 3
    ext = os.path.splitext(args.file)[1].lower()
    if ext not in (".pptx", ".docx", ".xlsx"):
        print(f"[错误] 不支持的类型 {ext}（支持 .pptx/.docx/.xlsx；.ppt/.doc/.xls 请先转换）", file=sys.stderr)
        return 3

    try:
        zf = zipfile.ZipFile(args.file)
    except zipfile.BadZipFile:
        print(f"[错误] 不是有效的 zip/OOXML 文件: {args.file}", file=sys.stderr)
        return 4

    out = [f"# {os.path.basename(args.file)}"]
    try:
        if ext == ".pptx":
            extract_pptx(zf, args.media, out)
        elif ext == ".docx":
            extract_docx(zf, out)
        else:
            extract_xlsx(zf, out, args.sheet_limit)
    finally:
        zf.close()

    text = "\n".join(out) + "\n"
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"[已写入] {args.out}")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
