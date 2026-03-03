# list_acro_fields.py

import os
from pdfrw import PdfReader

BASE = os.path.dirname(os.path.abspath(__file__))
TPL  = os.path.join(BASE, "case_templates", "SSD-2025-Client-Onboarding-Document.pdf")

def print_fields(fields, indent=0):
    for f in fields:
        name = f.get('/T')
        kids = f.get('/Kids') or []
        print(" " * indent + str(name))
        if kids:
            print_fields(kids, indent + 2)

pdf = PdfReader(TPL)
acro = pdf.Root.AcroForm

if not acro or not acro.Fields:
    print("❌ No AcroForm.Fields found")
else:
    print(f"Found {len(acro.Fields)} top-level fields:\n")
    print_fields(acro.Fields)