"""A real two-page vector drawing for an offline end-to-end demonstration."""
from pathlib import Path
import pymupdf as fitz


def make_sample() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=1190.551, height=841.89)
    ink = (0.12, 0.16, 0.20)
    def line(a, b, weight=1, color=ink, dashes=None):
        page.draw_line(a, b, color=color, width=weight, dashes=dashes)
    def rect(box, weight=1):
        page.draw_rect(box, color=ink, width=weight)
    def text(x, y, value, size=15):
        page.insert_text((x, y), value, fontname="japan", fontsize=size, color=ink)
    def dim(a, b, y, value):
        line((a, y), (b, y), .7)
        for x in (a, b):
            line((x, y - 10), (x, y + 12), .6)
            page.draw_circle((x, y), 2, color=ink, fill=ink)
        text((a + b) / 2 - len(value) * 3.5, y - 9, value, 12)

    text(85, 72, "サンプル図面 / 平面図", 20)
    text(905, 72, "S = 1 : 100", 13)
    # 255.118 PDF points = 90 mm on paper = 9000 mm at 1:100.
    # The labelled calibration line is deliberately independent of the floor plan.
    left, top, right, bottom = 230, 225, 950, 650
    rect((left, top, right, bottom), 2.1)
    rect((left + 7, top + 7, right - 7, bottom - 7), 1)
    line((left + 250, top + 7), (left + 250, bottom - 7), 2)
    line((left + 257, top + 7), (left + 257, bottom - 7))
    line((left + 7, top + 225), (left + 250, top + 225), 2)
    line((left + 7, top + 232), (left + 250, top + 232))
    line((left + 257, top + 145), (right - 7, top + 145), 2)
    line((left + 257, top + 152), (right - 7, top + 152))
    for x in (left + 360, left + 520):
        line((x, top + 7), (x, top + 145), 1.5)
    for x in (left + 50, left + 150, left + 360, left + 560):
        rect((x, top - 3, x + 68, top + 10), .7)
    text(320, 330, "洋室", 18)
    text(300, 358, "(6.0帖)", 14)
    text(320, 545, "和室", 18)
    text(300, 573, "(8.0帖)", 14)
    text(508, 298, "トイレ", 12)
    text(633, 298, "洗面室", 14)
    text(820, 298, "浴室", 14)
    text(685, 490, "LDK", 24)
    text(659, 520, "(16.0帖)", 15)
    rect((808, 245, 917, 310), .7)
    rect((840, 431, 881, 578), .8)
    page.draw_circle((860, 460), 10, color=ink, width=.7)
    page.draw_circle((860, 550), 7, color=ink, width=.7)
    # Cubic Bezier door arc demonstrates exact SPLINE export.
    page.draw_bezier((487, 425), (520, 425), (547, 398), (547, 370), color=ink, width=.8)
    line((487, 370), (547, 370), .8)
    for x in (270, 337, 404):
        line((x, 460), (x, 640), .35, (.65, .69, .72))
    line((237, 550), (475, 550), .35, (.65, .69, .72))
    dim(left, right, 165, "25,400")
    dim(left, left + 250, 198, "8,819")
    dim(left + 250, right, 198, "16,581")
    dim(left, right, 691, "25,400")
    line((190, top), (190, bottom), .7)
    line((179, top), (216, top), .7)
    line((179, bottom), (216, bottom), .7)
    text(125, 440, "14,994", 11)
    line((1010, 291), (1010, 241), 1.3)
    line((1010, 241), (1002, 255), 1.3)
    line((1010, 241), (1018, 255), 1.3)
    text(1003, 226, "N", 16)
    text(85, 769, "変換検証用の図面です。実施設計には使用できません。", 11)
    text(920, 769, "TRACE / 01", 12)

    page = doc.new_page(width=841.89, height=595.276)
    text(65, 65, "サンプル図面 / 寸法・曲線テスト", 19)
    start = fitz.Point(100, 160)
    end = fitz.Point(100 + 90 * 72 / 25.4, 160)
    line(start, end, 1.5, (0.05, .45, .42))
    text(100, 140, "9,000 mm (1:100)", 15)
    text(100, 199, "用紙上90mm → 縮尺100で9,000mm", 12)
    rect((100, 250, 330, 420), 1.2)
    page.draw_circle((470, 335), 80, color=(.05, .45, .42), width=1.2)
    line((80, 335), (600, 335), .6, (.5, .5, .5), "[12 6] 0")
    page.insert_text((650, 410), "ROTATED TEXT", fontsize=15, rotate=90, color=ink)
    text(65, 545, "直線・閉じた輪郭・ベジェ曲線・破線・日本語・回転文字", 12)
    text(695, 545, "TRACE / 02", 11)
    data = doc.tobytes(garbage=4, deflate=True)
    doc.close()
    return data


if __name__ == "__main__":
    target = Path(__file__).parent / "examples" / "サンプル図面.pdf"
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(make_sample())
    print(target)
