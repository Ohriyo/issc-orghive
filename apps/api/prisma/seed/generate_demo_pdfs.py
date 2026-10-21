"""Generate the demo-data PDFs (one per project task type) used by `db:seed:demo`.

Run from the repo root after `pip install reportlab`:

    python apps/api/prisma/seed/generate_demo_pdfs.py

Writes demo-assets/<task document type slug>.pdf. Every page carries a large diagonal
"SAMPLE — DEMO DATA" watermark and a footer: these files exist only to show empty features
during development and demos, and are removed with the rest of the demo data before
deployment (docs/DEPLOYMENT.md). No real person, event or amount appears in them.
"""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

HERE = Path(__file__).parent
OUT = HERE / "demo-assets"
INK = colors.HexColor("#095D40")
RULE = colors.HexColor("#C9D3CC")
WATERMARK = colors.Color(0.78, 0.12, 0.12, alpha=0.16)

base = getSampleStyleSheet()
S = {
    "uni": ParagraphStyle("uni", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=12, alignment=TA_CENTER, textColor=INK, leading=15),
    "small_c": ParagraphStyle("small_c", parent=base["Normal"], fontSize=8.5, alignment=TA_CENTER, leading=11),
    "title": ParagraphStyle("title", parent=base["Title"], fontSize=15, leading=19, textColor=INK, spaceBefore=6, spaceAfter=10),
    "h": ParagraphStyle("h", parent=base["Heading3"], fontSize=11, leading=14, textColor=INK, spaceBefore=10, spaceAfter=4),
    "body": ParagraphStyle("body", parent=base["Normal"], fontSize=10, leading=14.5, alignment=TA_JUSTIFY, spaceAfter=6),
    "note": ParagraphStyle("note", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=9.5, leading=13, textColor=colors.HexColor("#8A1F1F"), alignment=TA_CENTER),
}

INTRO = (
    "This is <b>sample demo data</b> generated for Orghive demonstrations. It is not a real "
    "document of any organization, and every name, date and amount in it is a placeholder."
)

# slug -> (title, [(heading, paragraphs)], table or None)
DOCUMENTS = {
    "project-proposal": (
        "Project Proposal",
        [
            ("Rationale", ["The organization proposes a one-day activity for its members and partner students, to be held on campus within the semester."]),
            ("Objectives", ["To give members hands-on practice, to involve partner students, and to document the activity for the organization's Paperworks."]),
            ("Plan of activities", ["Registration, opening program, the main sessions, a short evaluation and the closing program."]),
        ],
        [["Item", "Estimated cost (PHP)"], ["Materials", "2,500.00"], ["Snacks", "3,000.00"], ["Certificates", "500.00"], ["Total", "6,000.00"]],
    ),
    "notice-of-meeting": (
        "Notice of Meeting",
        [("Agenda", ["1. Call to order. 2. Planning of the activity. 3. Assignment of committees. 4. Other matters. 5. Adjournment."])],
        None,
    ),
    "minutes-of-meeting": (
        "Minutes of Meeting",
        [("Proceedings", ["The meeting was called to order, the agenda was approved, and the committees for the activity were assigned."])],
        None,
    ),
    "communication-letter": (
        "Communication Letter",
        [("Letter", ["Dear Sir or Madam, the organization respectfully requests the use of the venue for its activity. We will follow every rule of the venue and leave it in good order. Respectfully yours, the Officers."])],
        None,
    ),
    "attendance-sheet": (
        "Attendance Sheet",
        [("Attendees", ["The table below lists placeholder attendees only."])],
        [["No.", "Name", "Signature"], ["1", "Sample Participant A", ""], ["2", "Sample Participant B", ""], ["3", "Sample Participant C", ""]],
    ),
    "other-pre-event-document": (
        "Pre-event Document",
        [("Details", ["A supporting document filed before the event."])],
        None,
    ),
    "activity-completion-report": (
        "Activity Completion Report",
        [
            ("Summary", ["The activity was held as planned. Members and partner students took part in every session."]),
            ("Outcomes", ["Participants completed the hands-on sessions and the evaluation. The organization will hold a follow-up activity next semester."]),
            ("Documentation", ["Photos and the attendance sheet are kept by the organization's secretary."]),
        ],
        None,
    ),
    "financial-report": (
        "Financial Report",
        [("Statement", ["The amounts below are placeholders. Orghive reads a project's totals from the figures entered with this report, never from the file."])],
        [["", "Amount (PHP)"], ["Income", "0.00"], ["Expenses", "0.00"], ["Net", "0.00"]],
    ),
}


def decorate(canvas, doc):
    """The diagonal watermark and the footer, on every page."""
    width, height = A4
    canvas.saveState()
    canvas.setFillColor(WATERMARK)
    canvas.setFont("Helvetica-Bold", 54)
    canvas.translate(width / 2, height / 2)
    canvas.rotate(45)
    canvas.drawCentredString(0, 0, "SAMPLE — DEMO DATA")
    canvas.restoreState()

    canvas.saveState()
    canvas.setStrokeColor(RULE)
    canvas.line(18 * mm, 16 * mm, width - 18 * mm, 16 * mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#5A6B60"))
    canvas.drawString(18 * mm, 11 * mm, "SAMPLE — DEMO DATA. Not a real record; removed before deployment.")
    canvas.drawRightString(width - 18 * mm, 11 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build(slug, title, sections, table):
    doc = SimpleDocTemplate(
        str(OUT / f"{slug}.pdf"),
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=24 * mm,
        title=f"{title} (sample demo data)",
        author="Orghive demo data",
        subject="SAMPLE — DEMO DATA",
    )
    story = [
        Paragraph("Northwest Samar State University", S["uni"]),
        Paragraph("Sample Student Organization", S["small_c"]),
        Spacer(1, 6),
        Paragraph(title, S["title"]),
        Paragraph("SAMPLE — DEMO DATA", S["note"]),
        Spacer(1, 8),
        Paragraph(INTRO, S["body"]),
    ]
    for heading, paragraphs in sections:
        story.append(Paragraph(heading, S["h"]))
        story.extend(Paragraph(p, S["body"]) for p in paragraphs)
    if table:
        t = Table(table, hAlign="LEFT", colWidths=None)
        t.setStyle(
            TableStyle(
                [
                    ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9.5),
                    ("FONT", (0, 1), (-1, -1), "Helvetica", 9.5),
                    ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK),
                    ("GRID", (0, 0), (-1, -1), 0.4, RULE),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        story.extend([Spacer(1, 6), t])
    story.extend([Spacer(1, 18), Paragraph("Prepared by: Sample Officer (demo data)", S["body"])])
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)


def main():
    OUT.mkdir(exist_ok=True)
    for slug, (title, sections, table) in DOCUMENTS.items():
        build(slug, title, sections, table)
        print(f"wrote {OUT / (slug + '.pdf')}")


if __name__ == "__main__":
    main()
