# list_pdf_fields.py
import os
from pdfrw import PdfReader, PdfName

BASE = os.path.dirname(os.path.abspath(__file__))
TPL  = os.path.join(BASE, "case_templates", "SSD-2025-Client-Onboarding-Document.pdf")

pdf = PdfReader(TPL)
found = set()

for i, page in enumerate(pdf.pages, start=1):
    annots = getattr(page, "Annots", []) or []
    for annot in annots:
        if annot.get("/Subtype") == PdfName.Widget and annot.get("/T"):
            name = annot["/T"][1:-1]  # strip parens
            found.add(name)
            print(f"Page {i}: field → {name}")

if not found:
    print("⚠️  No AcroForm fields detected. Is this a fillable PDF?")
else:
    print("\nAll fields:")
    for name in sorted(found):
        print(" •", name)