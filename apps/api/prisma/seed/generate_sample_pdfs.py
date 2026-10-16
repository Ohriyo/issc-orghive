"""Generate the fictional sample Paperworks PDFs used by the Orghive seed.

Run from the repo root after `pip install reportlab`:

    python apps/api/prisma/seed/generate_sample_pdfs.py

Titles and organizations come from sample-documents.json; the body text is below.
Every page carries a "SAMPLE" footer: these are development fixtures, not real records.
All people named here are fictional.
"""

import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    ListFlowable,
    ListItem,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

HERE = Path(__file__).parent
OUT = HERE / "assets"
INK = colors.HexColor("#095D40")
RULE = colors.HexColor("#C9D3CC")

ORGS = {
    "jpice": "Junior Philippine Institute of Civil Engineers",
    "csc-cea": "Collegiate Student Council of the College of Engineering and Architecture",
    "issc": "Institutional Supreme Student Council",
}

PEOPLE = {
    "jpice": [("Juan Dela Cruz", "President, JPICE"), ("Engr. Ana Santos", "Adviser, JPICE")],
    "csc-cea": [("Pedro Reyes", "Governor, CSC-CEA"), ("Engr. Liza Fernandez", "Adviser, CSC-CEA")],
    "issc": [("Carmela Bautista", "President, ISSC"), ("Dr. Ramon Villanueva", "Adviser, ISSC")],
}

base = getSampleStyleSheet()
S = {
    "uni": ParagraphStyle("uni", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=12, alignment=TA_CENTER, textColor=INK, leading=15),
    "small_c": ParagraphStyle("small_c", parent=base["Normal"], fontSize=8.5, alignment=TA_CENTER, leading=11),
    "org": ParagraphStyle("org", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=10, alignment=TA_CENTER, leading=13),
    "title": ParagraphStyle("title", parent=base["Title"], fontSize=15, leading=19, textColor=INK, spaceBefore=6, spaceAfter=10),
    "h": ParagraphStyle("h", parent=base["Heading3"], fontSize=11, leading=14, textColor=INK, spaceBefore=10, spaceAfter=4),
    "body": ParagraphStyle("body", parent=base["Normal"], fontSize=10, leading=14.5, alignment=TA_JUSTIFY, spaceAfter=6),
    "cell": ParagraphStyle("cell", parent=base["Normal"], fontSize=9, leading=12),
    "res_head": ParagraphStyle("res_head", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=11, alignment=TA_CENTER, leading=15),
}


def letterhead(org_slug):
    return [
        Paragraph("Republic of the Philippines", S["small_c"]),
        Paragraph("NORTHWEST SAMAR STATE UNIVERSITY", S["uni"]),
        Paragraph("Calbayog City, Samar", S["small_c"]),
        Spacer(1, 3 * mm),
        Paragraph(ORGS[org_slug], S["org"]),
        Spacer(1, 2 * mm),
        Table([[""]], colWidths=[170 * mm], rowHeights=[1.2], style=[("LINEABOVE", (0, 0), (-1, -1), 1.2, INK)]),
    ]


def para(text):
    return Paragraph(text, S["body"])


def heading(text):
    return Paragraph(text, S["h"])


def bullets(items):
    return ListFlowable(
        [ListItem(Paragraph(i, S["body"]), leftIndent=12) for i in items],
        bulletType="bullet",
        start="•",
        leftIndent=12,
    )


def table(rows, widths, money_cols=(), header=True):
    data = [[Paragraph(str(c), S["cell"]) for c in r] for r in rows]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1 if header else 0)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.5, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E7EFE9")))
    else:
        style.append(("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#E7EFE9")))
    for c in money_cols:
        style.append(("ALIGN", (c, 1), (c, -1), "RIGHT"))
    t.setStyle(TableStyle(style))
    return t


def signatures(org_slug, extra=None):
    people = PEOPLE[org_slug] + (extra or [])
    labels = ["Prepared by:", "Noted by:", "Approved by:"]
    cells = []
    for i, (name, role) in enumerate(people):
        cells.append(
            [
                Paragraph(labels[min(i, 2)], S["cell"]),
                Spacer(1, 9 * mm),
                Paragraph(f"<b>{name}</b>", S["cell"]),
                Paragraph(role, S["cell"]),
            ]
        )
    t = Table([cells], colWidths=[170 * mm / len(cells)] * len(cells))
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return KeepTogether([Spacer(1, 8 * mm), t])


def peso(n):
    return f"PHP {n:,.2f}"


def budget(items):
    rows = [["Item", "Qty", "Unit cost", "Amount"]]
    total = 0
    for name, qty, unit in items:
        amount = qty * unit
        total += amount
        rows.append([name, str(qty), peso(unit), peso(amount)])
    rows.append(["<b>Total</b>", "", "", f"<b>{peso(total)}</b>"])
    return table(rows, [85, 15, 35, 35], money_cols=(2, 3))


# --------------------------------------------------------------------------- content


def proposal(doc, p):
    org = doc["org"]
    story = letterhead(org) + [Paragraph(doc["title"], S["title"])]
    story.append(
        table(
            [
                ["Proponent", ORGS[org]],
                ["Date", p["date"]],
                ["Venue", p["venue"]],
                ["Participants", p["participants"]],
                ["Academic year", f"{doc['academicYear']}, {doc['semester'].capitalize()} Semester"],
            ],
            [40, 130],
            header=False,
        )
    )
    story += [heading("I. Rationale"), para(p["rationale"]), heading("II. Objectives"), bullets(p["objectives"])]
    story += [heading("III. Program of Activities"), table([["Time", "Activity", "In charge"]] + p["program"], [30, 95, 45])]
    story += [heading("IV. Budgetary Requirements"), budget(p["budget"]), Spacer(1, 3 * mm), para(f"<b>Source of funds:</b> {p['funds']}")]
    story += [heading("V. Expected Outcomes"), bullets(p["outcomes"])]
    story.append(signatures(org))
    return story


def accomplishment(doc, a):
    org = doc["org"]
    story = letterhead(org) + [Paragraph(doc["title"], S["title"])]
    story += [heading("I. Overview"), para(a["overview"])]
    story += [
        heading("II. Activities Conducted"),
        table([["Date", "Activity", "Participants", "Outcome"]] + a["activities"], [25, 60, 25, 60]),
    ]
    story += [heading("III. Highlights"), bullets(a["highlights"])]
    story += [heading("IV. Challenges Encountered"), bullets(a["challenges"])]
    story += [heading("V. Recommendations"), bullets(a["recommendations"])]
    story.append(signatures(org))
    return story


def resolution(doc, r):
    org = doc["org"]
    story = letterhead(org)
    story += [
        Spacer(1, 4 * mm),
        Paragraph(f"RESOLUTION NO. {r['number']}", S["res_head"]),
        Paragraph(f"Series of {r['series']}", S["small_c"]),
        Spacer(1, 3 * mm),
        Paragraph(r["caption"].upper(), S["res_head"]),
        Spacer(1, 4 * mm),
    ]
    for w in r["whereas"]:
        story.append(para(f"<b>WHEREAS,</b> {w};"))
    story.append(para(f"<b>NOW, THEREFORE, BE IT RESOLVED,</b> as it is hereby resolved, {r['resolved']};"))
    for f in r["further"]:
        story.append(para(f"<b>RESOLVED FURTHER,</b> {f};"))
    story.append(para(f"<b>UNANIMOUSLY APPROVED</b> this {r['approved_on']} at {r['place']}."))
    story.append(signatures(org))
    return story


CONTENT = {
    "jpice-bridge-design-competition-2026": (proposal, {
        "date": "October 24, 2026, 8:00 AM to 5:00 PM",
        "venue": "CEA Laboratory Building, NwSSU Main Campus",
        "participants": "60 civil engineering students in 12 teams (first to fourth year)",
        "rationale": "Structural analysis is taught mostly on paper, and students rarely see how a design behaves under load. A design-and-build competition lets teams apply statics and mechanics of materials to a small truss bridge, then test it to failure. The activity also builds teamwork across year levels, since each team mixes junior and senior students.",
        "objectives": [
            "Apply truss analysis and member sizing to a physical model.",
            "Compare predicted and actual failure loads, and explain the difference.",
            "Encourage collaboration between year levels.",
        ],
        "program": [
            ["8:00 AM", "Registration and briefing on rules and safety", "Secretary"],
            ["8:30 AM", "Design and construction (balsa wood, 1.2 m span)", "Team leaders"],
            ["1:00 PM", "Load testing with calibrated weights", "Engr. Ana Santos"],
            ["3:30 PM", "Presentation of design reports", "Teams"],
            ["4:30 PM", "Awarding and closing remarks", "President"],
        ],
        "budget": [
            ("Balsa wood sticks (bundle)", 24, 180.00),
            ("Wood glue (250 ml)", 12, 95.00),
            ("Cutting mats and blades", 12, 150.00),
            ("Certificates and printing", 1, 600.00),
            ("Prizes for top three teams", 3, 1000.00),
        ],
        "funds": "JPICE organizational fund, AY 2026-2027",
        "outcomes": [
            "Twelve tested bridge models with written design reports.",
            "A record of predicted versus actual failure loads for use in class discussions.",
        ],
    }),
    "jpice-diversion-road-site-visit": (proposal, {
        "date": "November 14, 2026, 7:00 AM to 12:00 NN",
        "venue": "Calbayog City Diversion Road project site",
        "participants": "45 third-year civil engineering students and 2 faculty chaperones",
        "rationale": "Students in Highway and Railroad Engineering study pavement design and quality control from textbooks. A guided visit to an active road project shows how specifications, testing and inspection work on site, and how safety is managed around heavy equipment.",
        "objectives": [
            "Observe subgrade preparation, base course placement and concrete paving.",
            "Learn the field tests used for quality control, such as slump and compaction tests.",
            "Understand site safety procedures and the role of the project engineer.",
        ],
        "program": [
            ["7:00 AM", "Assembly at NwSSU and safety orientation", "Engr. Ana Santos"],
            ["7:45 AM", "Travel to project site", "Logistics committee"],
            ["8:15 AM", "Guided walk-through with the site engineer", "Host contractor"],
            ["10:30 AM", "Open forum", "Facilitator"],
            ["11:30 AM", "Return to campus", "Logistics committee"],
        ],
        "budget": [
            ("Van rental (round trip)", 3, 2500.00),
            ("Hard hats (borrowed, cleaning)", 1, 300.00),
            ("Snacks and water", 47, 60.00),
            ("Student accident insurance", 47, 25.00),
        ],
        "funds": "Participants' contribution and JPICE organizational fund",
        "outcomes": [
            "A short reflection paper from each participant.",
            "A photo documentation for the JPICE bulletin board.",
        ],
    }),
    "jpice-accomplishment-1st-sem-2025-2026": (accomplishment, {
        "overview": "During the first semester of AY 2025-2026, JPICE carried out five activities focused on academic support, professional exposure and community service. Total participation reached 312 student-attendances, and all activities stayed within the approved budget.",
        "activities": [
            ["Aug 22", "General assembly and election of committee heads", "118", "Committees formed; plan of activities adopted"],
            ["Sep 12", "Review session: Mathematics and Surveying", "64", "Mock exam average rose from 58% to 71%"],
            ["Sep 27", "Seminar: Introduction to BIM", "52", "Hands-on Revit exercise completed by all"],
            ["Oct 18", "Coastal clean-up, Barangay Bagacay", "41", "38 sacks of waste collected"],
            ["Nov 29", "Alumni career talk", "37", "Three alumni engineers shared licensure tips"],
        ],
        "highlights": [
            "First BIM seminar for the department, done with a partner firm at no cost.",
            "Review sessions will continue next semester at the students' request.",
        ],
        "challenges": [
            "Class schedule conflicts lowered attendance for the alumni talk.",
            "Late release of funds delayed the purchase of review materials.",
        ],
        "recommendations": [
            "Schedule activities on Fridays after 3:00 PM when fewer classes run.",
            "Submit fund requests at least three weeks ahead.",
        ],
    }),
    "jpice-ce-week-2026-report": (accomplishment, {
        "overview": "Civil Engineering Week was held from March 9 to 13, 2026 with the theme \"Building Resilient Communities\". It included two seminars, a quiz bee for all year levels and a community clean-up drive.",
        "activities": [
            ["Mar 9", "Opening program and seminar on disaster-resilient housing", "140", "Speaker from the provincial engineering office"],
            ["Mar 10", "Seminar: Water supply systems for rural barangays", "96", "Case study of a Samar water project"],
            ["Mar 11", "Inter-year quiz bee", "48", "Third-year team won first place"],
            ["Mar 13", "Clean-up drive and closing", "73", "Drainage canals cleared along the campus road"],
        ],
        "highlights": [
            "Highest seminar turnout recorded by JPICE.",
            "Quiz bee questions were reused for the department's review bank.",
        ],
        "challenges": [
            "Rain moved the clean-up drive by one day.",
            "Liquidation receipts for snacks are still incomplete.",
        ],
        "recommendations": [
            "Attach complete liquidation receipts before submission.",
            "Prepare an indoor alternative for outdoor activities.",
        ],
    }),
    "jpice-resolution-2026-03": (resolution, {
        "number": "2026-03",
        "series": "2026",
        "caption": "A resolution adopting the JPICE Officers' Code of Conduct",
        "whereas": [
            "JPICE officers represent the organization before students, faculty and partner institutions",
            "the organization has no written standard for the conduct expected of its officers",
            "a written code helps new officers understand their responsibilities from the start of their term",
        ],
        "resolved": "that the JPICE Officers' Code of Conduct, attached as Annex A, is adopted and takes effect upon approval",
        "further": [
            "that every incoming officer reads and signs the Code within two weeks of taking office",
            "that the Code is reviewed at the end of each academic year",
        ],
        "approved_on": "15th day of September 2026",
        "place": "the CEA Conference Room, NwSSU Main Campus",
    }),
    "csc-cea-cea-days-2026": (proposal, {
        "date": "December 1 to 4, 2026",
        "venue": "NwSSU Main Campus (CEA grounds and gymnasium)",
        "participants": "All CEA students, about 900, with faculty and invited guests",
        "rationale": "CEA Days is the college week of the College of Engineering and Architecture. It brings the six student body organizations together for academic contests, exhibits and sports, and it is the main venue for showing the college's work to the rest of the university.",
        "objectives": [
            "Showcase student projects from every CEA program.",
            "Strengthen unity among the CEA student body organizations.",
            "Hold academic and sports competitions that build camaraderie.",
        ],
        "program": [
            ["Dec 1", "Opening parade and project exhibit", "CSC-CEA"],
            ["Dec 2", "Academic contests organized by each SBO", "SBO presidents"],
            ["Dec 3", "Sports fest", "Sports committee"],
            ["Dec 4", "Awarding and closing night", "CSC-CEA"],
        ],
        "budget": [
            ("Exhibit panels and printing", 20, 450.00),
            ("Medals and trophies", 1, 8500.00),
            ("Sound system rental (4 days)", 4, 3000.00),
            ("Sports equipment", 1, 6000.00),
            ("Documentation and tarpaulins", 1, 3500.00),
        ],
        "funds": "CSC-CEA fund and SBO counterpart contributions",
        "outcomes": [
            "A four-day program with participation from all six SBOs.",
            "A post-activity report with liquidation within 30 days.",
        ],
    }),
    "csc-cea-accomplishment-2nd-sem-2025-2026": (accomplishment, {
        "overview": "The CSC-CEA focused on student welfare, coordination of the six SBOs and representation in college meetings during the second semester of AY 2025-2026.",
        "activities": [
            ["Jan 20", "SBO presidents' coordination meeting", "18", "Joint calendar drafted"],
            ["Feb 14", "Blood donation drive with the Philippine Red Cross", "86", "71 bags collected"],
            ["Mar 3", "Student consultation on laboratory schedules", "120", "Concerns raised with the dean's office"],
            ["Apr 22", "Leadership training for incoming officers", "54", "Officers trained on documentation and liquidation"],
        ],
        "highlights": [
            "Laboratory schedules were adjusted after the student consultation.",
            "All six SBOs submitted their reports on time for the first time.",
        ],
        "challenges": [
            "Limited venue availability during the examination period.",
        ],
        "recommendations": [
            "Reserve venues one month ahead.",
            "Continue the monthly SBO presidents' meeting.",
        ],
    }),
    "csc-cea-resolution-2026-07": (resolution, {
        "number": "2026-07",
        "series": "2026",
        "caption": "A resolution endorsing the SBO activity calendar for AY 2026-2027",
        "whereas": [
            "the six student body organizations of the College of Engineering and Architecture submitted their planned activities for AY 2026-2027",
            "the CSC-CEA consolidated these plans to avoid schedule conflicts and overlapping venue requests",
            "a single calendar helps the college plan venues, faculty supervision and funding",
        ],
        "resolved": "that the consolidated SBO Activity Calendar for AY 2026-2027, attached as Annex A, is endorsed to the Office of the Dean",
        "further": [
            "that changes to the calendar are coordinated with the CSC-CEA at least two weeks ahead",
        ],
        "approved_on": "8th day of August 2026",
        "place": "the CEA Conference Room, NwSSU Main Campus",
    }),
    "issc-leadership-summit-2026": (proposal, {
        "date": "September 18 to 19, 2026",
        "venue": "NwSSU Main Campus Gymnasium",
        "participants": "Officers of all CSCs and SBOs, about 250 student leaders",
        "rationale": "Every year a new set of student leaders takes office. The summit gives them a shared start: how student governance works at NwSSU, how to plan and document activities, and how to work with advisers and the administration.",
        "objectives": [
            "Orient new officers on student governance and university policies.",
            "Train officers on activity proposals, documentation and liquidation.",
            "Build a network among CSC and SBO leaders across colleges.",
        ],
        "program": [
            ["Day 1 AM", "Opening and talk on student governance", "ISSC President"],
            ["Day 1 PM", "Workshop: proposals and documentation", "Office of Student Affairs"],
            ["Day 2 AM", "Workshop: financial management and liquidation", "Accounting office"],
            ["Day 2 PM", "College council planning sessions and closing", "CSC governors"],
        ],
        "budget": [
            ("Meals for two days", 250, 220.00),
            ("Workshop kits", 250, 45.00),
            ("Certificates", 250, 10.00),
            ("Speakers' tokens", 4, 500.00),
        ],
        "funds": "ISSC fund, AY 2026-2027",
        "outcomes": [
            "Trained officers from every college and organization.",
            "Each CSC leaves with a draft plan of activities for the year.",
        ],
    }),
    "issc-accomplishment-2nd-sem-2025-2026": (accomplishment, {
        "overview": "In the second semester of AY 2025-2026 the ISSC worked on student representation, university-wide events and coordination with the seven collegiate student councils.",
        "activities": [
            ["Jan 27", "Meeting of CSC governors", "16", "Common calendar for university events agreed"],
            ["Feb 21", "University Foundation Day student program", "1,200", "Program held with all colleges"],
            ["Mar 18", "Forum on tuition and fee policies", "300", "Student questions answered by administration"],
            ["May 5", "Turnover and orientation of new ISSC officers", "40", "Records and funds turned over"],
        ],
        "highlights": [
            "Largest student turnout for Foundation Day in recent years.",
            "Fee policy forum minutes were shared with all CSCs.",
        ],
        "challenges": [
            "Communication with off-campus satellite units was slow.",
        ],
        "recommendations": [
            "Set up a single online archive for council documents (Orghive).",
        ],
    }),
}


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#4A5A50"))
    canvas.drawString(20 * mm, 12 * mm, "SAMPLE DOCUMENT. Generated for Orghive development; not an official NwSSU record.")
    canvas.drawRightString(190 * mm, 12 * mm, f"Page {doc.page}")
    canvas.restoreState()


def main():
    manifest = json.loads((HERE / "sample-documents.json").read_text(encoding="utf-8"))
    OUT.mkdir(exist_ok=True)
    for doc in manifest["documents"]:
        build, content = CONTENT[doc["slug"]]
        path = OUT / f"{doc['slug']}.pdf"
        pdf = SimpleDocTemplate(
            str(path),
            pagesize=A4,
            leftMargin=20 * mm,
            rightMargin=20 * mm,
            topMargin=16 * mm,
            bottomMargin=20 * mm,
            title=doc["title"],
            author=ORGS[doc["org"]],
            subject="Sample document for Orghive development",
            # Fixed metadata keeps the files byte-identical between runs.
            invariant=1,
        )
        pdf.build(build(doc, content), onFirstPage=footer, onLaterPages=footer)
        print(f"wrote {path.relative_to(HERE)}")


if __name__ == "__main__":
    main()
