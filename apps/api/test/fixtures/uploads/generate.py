"""Generates the upload test fixtures (pdf skill: reportlab to create, pypdf to verify).

    python apps/api/test/fixtures/uploads/generate.py   # needs: pip install reportlab pypdf

Writes, next to this file:
- valid.pdf          a 2-page PDF whose text includes the search word below
- pdf-renamed.docx   the same PDF bytes under a .docx name (the magic-byte check must refuse it)

Not generated here, on purpose:
- an oversized file: tests build 25 MB + 1 byte in memory, so the repo stays small
- the EICAR test file: tests assemble the string in memory from two halves. A file on disk
  would be quarantined by Windows Defender (and teammates' antivirus) out of the checkout.
"""

import os
import shutil

from pypdf import PdfReader
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

HERE = os.path.dirname(os.path.abspath(__file__))
SEARCH_WORD = "trusslattice"  # unusual on purpose: tests search for it after text extraction


def build_pdf(path: str) -> None:
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(path, pagesize=A4, title="Orghive upload fixture")
    story = [
        Paragraph("Activity Proposal: Bridge Design Competition", styles["Title"]),
        Spacer(1, 12),
        Paragraph(
            "The Junior Philippine Institute of Civil Engineers proposes an inter-year "
            f"{SEARCH_WORD} bridge design and load-testing competition.",
            styles["Normal"],
        ),
        PageBreak(),
        Paragraph("Budget and timeline", styles["Heading1"]),
        Paragraph("Materials, judging and awards are listed on this page.", styles["Normal"]),
    ]
    doc.build(story)


def main() -> None:
    valid = os.path.join(HERE, "valid.pdf")
    build_pdf(valid)

    reader = PdfReader(valid)
    text = "".join(page.extract_text() for page in reader.pages)
    assert len(reader.pages) == 2, "expected 2 pages"
    assert SEARCH_WORD in text, "search word missing from the PDF text"

    shutil.copyfile(valid, os.path.join(HERE, "pdf-renamed.docx"))
    print(f"valid.pdf: {len(reader.pages)} pages, {os.path.getsize(valid)} bytes")
    print("pdf-renamed.docx: same bytes, wrong extension")


if __name__ == "__main__":
    main()
