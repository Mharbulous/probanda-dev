"""A one-page synthetic bilingual report for the pdf_layout, diff_excerpt and
highlight_pages tests: English left, French right, a running header across both, and
"Wilberforce" broken across a line wrap by soft hyphens in both columns.

The text is drawn in reportlab's bundled Bitstream Vera, an embedded TrueType font,
because a standard-font soft hyphen reads back from pdfplumber as a space.
"""

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

PAGE = (612, 792)
LEFT_X, RIGHT_X = 60, 330
GUTTER_X = 300
HEADER = "[2026] 1 S.C.R.        SAMPLE v. TEST        Justice Example        11"
ENGLISH = [
    "[1] The court held that the duty of care was",
    "owed by the defendant to the plaintiff in this",
    "case, as stated per Lord Wil­ber­",
    "force in the leading decision of the House.",
    "[2] The second paragraph of the English text is",
    "short and it ends here with the words of",
    "the judge.",
]
FRENCH = [
    "[1] La cour a conclu que l’obligation de",
    "diligence était due par le défendeur au",
    "demandeur dans cette affaire, selon lord Wil­ber­",
    "force dans la décision de principe de la Chambre.",
    "[2] Le deuxième paragraphe du texte français est",
    "court et il se termine ici avec les mots du",
    "juge.",
]


def build(path):
    pdfmetrics.registerFont(TTFont("Vera", "Vera.ttf"))
    c = canvas.Canvas(str(path), pagesize=PAGE)
    c.setFont("Vera", 9)
    c.drawString(LEFT_X, 760, HEADER)
    for row, (english, french) in enumerate(zip(ENGLISH, FRENCH)):
        c.drawString(LEFT_X, 700 - row * 14, english)
        c.drawString(RIGHT_X, 700 - row * 14, french)
    c.showPage()
    c.save()
    return path
