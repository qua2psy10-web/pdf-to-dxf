"""Convert PDF vector artwork into millimetre-based, editable DXF R2010.

PDF points -> displayed page orientation -> bottom-left CAD origin -> mm * scale.
Clipping, raster images, font fidelity, opacity, and filled areas have explicit limits.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
import html
import io
import math
from pathlib import Path
import re

import pymupdf as fitz
import ezdxf
from ezdxf import units

PT_TO_MM = 25.4 / 72
MAX_ENTITIES = 300_000


class ConversionError(ValueError):
    pass


@dataclass(frozen=True)
class Options:
    scale: float = 100
    text: bool = True
    colors: bool = True

    def validate(self):
        if not math.isfinite(self.scale) or not 0.001 <= self.scale <= 100_000:
            raise ConversionError("縮尺は0.001〜100000の数値で指定してください。")


def open_pdf(data: bytes) -> fitz.Document:
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise ConversionError("PDFを読み込めません。ファイルが破損していないか確認してください。") from exc
    if doc.needs_pass:
        doc.close()
        raise ConversionError("パスワード付きPDFには対応していません。保護を解除したPDFを選択してください。")
    if not 1 <= len(doc) <= 200:
        doc.close()
        raise ConversionError("1〜200ページのPDFを選択してください。")
    return doc


def page_info(page: fitz.Page) -> dict:
    drawings = page.get_drawings()
    text_count = sum(len(line["spans"]) for b in page.get_text("dict", flags=0)["blocks"]
                     if b["type"] == 0 for line in b["lines"])
    images = len(page.get_image_info())
    return {
        "number": page.number + 1,
        "width_mm": round(page.rect.width * PT_TO_MM, 2),
        "height_mm": round(page.rect.height * PT_TO_MM, 2),
        "paths": len(drawings), "texts": text_count, "images": images,
        "kind": "vector" if drawings else ("image" if images else "text" if text_count else "empty"),
    }


def color_int(color) -> int:
    if color is None:
        return 0
    values = [max(0, min(255, round(v * 255))) for v in color]
    if len(values) == 1:
        values *= 3
    return (values[0] << 16) | (values[1] << 8) | values[2]


def convert_page(page: fitz.Page, options: Options):
    options.validate()
    doc = ezdxf.new("R2010")
    doc.units = units.MM
    doc.header["$MEASUREMENT"] = 1
    doc.header["$LUNITS"] = 2
    doc.header["$INSBASE"] = (0, 0, 0)
    for name, color in [("PDF_LINES", 7), ("PDF_TEXT", 7), ("PDF_FILL_OUTLINES", 8)]:
        doc.layers.new(name, dxfattribs={"color": color})
    doc.styles.new("PDF_TEXT", dxfattribs={"font": "Arial Unicode.ttf"})
    model = doc.modelspace()
    factor = PT_TO_MM * options.scale
    matrix = page.rotation_matrix
    warnings: set[str] = set()
    height = page.rect.height
    width = page.rect.width
    dash_types = {}

    def coord(p):
        q = fitz.Point(p) * matrix
        return (q.x * factor, (height - q.y) * factor, 0)

    def attrs(path):
        fill_only = path["type"] == "f"
        result = {"layer": "PDF_FILL_OUTLINES" if fill_only else "PDF_LINES"}
        if options.colors:
            result["true_color"] = color_int(path.get("fill") if fill_only else path.get("color"))
        line_width = (path.get("width") or 0) * PT_TO_MM * 100
        weights = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211]
        result["lineweight"] = min(weights, key=lambda v: abs(v - line_width))
        dash = re.match(r"\[([^]]*)\]\s*([-+\d.eE]+)?", path.get("dashes") or "[] 0")
        if dash:
            lengths = [abs(float(v)) * factor for v in dash.group(1).split()]
            if lengths and sum(lengths) > 0:
                if len(lengths) % 2:
                    lengths *= 2
                key = tuple(round(v, 8) for v in lengths)
                name = dash_types.get(key)
                if name is None:
                    name = "PDF_DASH_" + str(len(dash_types) + 1)
                    pattern = [sum(lengths)] + [v if i % 2 == 0 else -v for i, v in enumerate(lengths)]
                    doc.linetypes.new(name, dxfattribs={"description": "PDF dash", "pattern": pattern})
                    dash_types[key] = name
                result["linetype"] = name
                if dash.group(2) and float(dash.group(2)):
                    warnings.add("破線の開始位相は再現されません。")
        return result

    drawings = page.get_drawings(extended=True)
    if len(drawings) > MAX_ENTITIES:
        raise ConversionError("図形が多すぎます。ページを分割または簡略化してください。")
    for path in drawings:
        if path["type"] == "clip":
            warnings.add("クリッピングを含みます。隠れた線がDXFに現れる場合があります。")
            continue
        if path["type"] == "group":
            continue
        if path.get("stroke_opacity") == 0 and path["type"] == "s":
            continue
        if path.get("fill_opacity") == 0 and path["type"] == "f":
            continue
        if path.get("fill") is not None:
            warnings.add("塗りつぶしは輪郭線として出力します。白い塗りつぶしによる線の隠蔽も再現されません。")
        if any(0 < (path.get(key) or 0) < 1 for key in ("stroke_opacity", "fill_opacity")):
            warnings.add("透明度・合成効果は再現されません。")
        rect = path.get("rect")
        if rect:
            visible = rect * matrix
            if visible.x0 < -0.01 or visible.y0 < -0.01 or visible.x1 > width + 0.01 or visible.y1 > height + 0.01:
                warnings.add("用紙外に延びる図形を含みます。DXFには用紙外の線も出力します。")
        a = attrs(path)
        start = end = None
        for item in path["items"]:
            kind = item[0]
            if kind in ("l", "c"):
                current_start = item[1]
                if end is None or abs(current_start - end) > 0.0001:
                    if path.get("fill") is not None and start is not None and end is not None and abs(end - start) > 1e-6:
                        model.add_line(coord(end), coord(start), dxfattribs=a)
                    start = current_start
                if kind == "l":
                    if abs(item[2] - item[1]) > 1e-8:
                        model.add_line(coord(item[1]), coord(item[2]), dxfattribs=a)
                    end = item[2]
                else:
                    model.add_open_spline([coord(p) for p in item[1:]], degree=3,
                                          knots=[0, 0, 0, 0, 1, 1, 1, 1], dxfattribs=a)
                    end = item[4]
            elif kind == "re":
                if path.get("fill") is not None and start is not None and end is not None and abs(end - start) > 1e-6:
                    model.add_line(coord(end), coord(start), dxfattribs=a)
                r = item[1]
                model.add_lwpolyline([coord(p)[:2] for p in [r.tl, r.tr, r.br, r.bl]], close=True, dxfattribs=a)
                start = end = None
            elif kind == "qu":
                if path.get("fill") is not None and start is not None and end is not None and abs(end - start) > 1e-6:
                    model.add_line(coord(end), coord(start), dxfattribs=a)
                q = item[1]
                model.add_lwpolyline([coord(p)[:2] for p in [q.ul, q.ur, q.lr, q.ll]], close=True, dxfattribs=a)
                start = end = None
            else:
                warnings.add(f"未対応の図形命令 {kind} を省略しました。")
            if len(model) > MAX_ENTITIES:
                raise ConversionError("変換要素が30万件を超えました。PDFを簡略化してください。")
        # PDF fills implicitly close all subpaths even without a closePath operator.
        if (path.get("closePath") or path.get("fill") is not None) and start is not None and end is not None and abs(end - start) > 1e-6:
            model.add_line(coord(end), coord(start), dxfattribs=a)

    if page.get_image_info():
        warnings.add("画像は出力しません。スキャン図面・写真の自動トレースには対応していません。")
    if options.text:
        for block in page.get_text("dict", flags=0)["blocks"]:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                direction = line["dir"]
                origin = fitz.Point(0, 0) * matrix
                vector = fitz.Point(direction) * matrix - origin
                angle = math.degrees(math.atan2(-vector.y, vector.x))
                if line.get("wmode"):
                    warnings.add("縦書き文字は横書きのTEXTとして近似します。")
                for span in line["spans"]:
                    text = span["text"]
                    if not text.strip() or span.get("alpha", 255) == 0:
                        continue
                    # PDF text flagged invisible (e.g. OCR overlay) is not a visible drawing.
                    if "char_flags" in span and not span["char_flags"] & (8 | 16):
                        continue
                    a = {"layer": "PDF_TEXT", "style": "PDF_TEXT", "insert": coord(span["origin"]),
                         "height": max(span["size"] * factor * 0.75, 0.001), "rotation": angle}
                    if options.colors:
                        a["true_color"] = span["color"]
                    # Preserve span baseline and horizontal extent with DXF ALIGNED text.
                    quad = fitz.recover_quad(direction, span)
                    advance = abs(quad.ur - quad.ul)
                    from ezdxf.enums import TextEntityAlignment
                    entity = model.add_text(text, dxfattribs=a)
                    if advance > 0:
                        p2 = fitz.Point(span["origin"]) + fitz.Point(direction) * advance
                        entity.set_placement(coord(span["origin"]), coord(p2), align=TextEntityAlignment.FIT)
                    if "\ufffd" in text:
                        warnings.add("抽出できない文字があります。元PDFの文字コードを確認してください。")
                    if len(model) > MAX_ENTITIES:
                        raise ConversionError("変換要素が30万件を超えました。PDFを簡略化してください。")
        if model.query("TEXT"):
            warnings.add("文字は代替フォントで表示します。字体・縦書き・一部の文字間隔は元PDFと異なる場合があります。")
    if list(page.annots() or []):
        warnings.add("PDFの注釈・コメント・フォームはDXFに含まれません。")
    if not len(model):
        raise ConversionError("変換できる線・文字がありません。スキャン画像のみのPDFは自動トレースできません。")
    if not model.query("LINE LWPOLYLINE SPLINE"):
        warnings.add("抽出できる線がありません。今回の出力は文字のみです。")
    doc.set_modelspace_vport(height=height * factor, center=(width * factor / 2, height * factor / 2))
    counts = dict(Counter(e.dxftype() for e in model))
    return doc, {"entities": len(model), "counts": counts, "warnings": sorted(warnings),
                 "width_mm": width * factor, "height_mm": height * factor,
                 "scale": options.scale, "page": page.number + 1}


def dxf_bytes(doc) -> bytes:
    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue().encode("utf-8")


def preview_svg(doc, width: float, height: float) -> bytes:
    """Render actual exported entity coordinates. Not a screenshot of the source PDF."""
    def number(v):
        return f"{v:.6f}"

    def point(p):
        return f"{number(p[0])},{number(height - p[1])}"

    result = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {number(width)} {number(height)}">',
              f'<rect width="{number(width)}" height="{number(height)}" fill="white"/>']
    for entity in doc.modelspace():
        color = f'#{entity.dxf.get("true_color", 0):06x}'
        style = f'fill="none" stroke="{color}" stroke-width="0.85" vector-effect="non-scaling-stroke"'
        ltype = doc.linetypes.get(entity.dxf.get("linetype", "CONTINUOUS"))
        pattern = ltype.pattern_tags.compile()
        if pattern:
            style += ' stroke-dasharray="' + ','.join(number(max(abs(v), width / 10000)) for v in pattern) + '"'
        kind = entity.dxftype()
        if kind == "LINE":
            result.append(f'<path d="M {point(entity.dxf.start)} L {point(entity.dxf.end)}" {style}/>')
        elif kind == "LWPOLYLINE":
            pts = list(entity.get_points("xy"))
            data = 'M ' + ' L '.join(point(p) for p in pts) + (' Z' if entity.closed else '')
            result.append(f'<path d="{data}" {style}/>')
        elif kind == "SPLINE":
            pts = list(entity.control_points)
            result.append(f'<path d="M {point(pts[0])} C {point(pts[1])} {point(pts[2])} {point(pts[3])}" {style}/>')
        elif kind == "TEXT":
            p = entity.dxf.insert
            length = (entity.dxf.align_point - p).magnitude if entity.dxf.hasattr("align_point") else 0
            length_attr = f' textLength="{number(length)}" lengthAdjust="spacingAndGlyphs"' if length else ''
            result.append(f'<text transform="translate({point(p)}) rotate({number(-entity.dxf.rotation)})" '
                          f'font-family="Arial, Hiragino Kaku Gothic ProN, sans-serif" '
                          f'font-size="{number(entity.dxf.height / 0.75)}" fill="{color}"{length_attr}>'
                          f'{html.escape(entity.dxf.text)}</text>')
    result.append('</svg>')
    return '\n'.join(result).encode("utf-8")


def main():
    parser = argparse.ArgumentParser(description="ベクトルPDFをDXF R2010/mmに変換")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--scale", type=float, default=100)
    parser.add_argument("--no-text", action="store_true")
    parser.add_argument("--monochrome", action="store_true")
    args = parser.parse_args()
    try:
        with open_pdf(args.pdf.read_bytes()) as source:
            if not 1 <= args.page <= len(source):
                raise ConversionError("指定したページは存在しません。")
            doc, report = convert_page(source[args.page - 1], Options(args.scale, not args.no_text, not args.monochrome))
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_bytes(dxf_bytes(doc))
        print(f"保存: {args.output.resolve()} ({report['entities']}要素)")
        for warning in report["warnings"]:
            print(f"注意: {warning}")
    except (ConversionError, OSError) as exc:
        parser.exit(1, f"エラー: {exc}\n")


if __name__ == "__main__":
    main()
