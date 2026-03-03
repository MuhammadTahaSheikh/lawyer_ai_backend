import sys
import os
import mysql.connector
from pdfrw import PdfReader, PdfWriter, PdfDict, PdfObject
from datetime import date
 
# ─── 1) Map PDF form‐field base names → database columns ────────────────────
FIELD_MAP = {
    "contact|first_name":         "contact_first_name",
    "contact|last_name":          "contact_last_name",
    "contact|full_name":          "contact_full_name",
    "case|264721":                "social_security_number",
    "case|264720":                "clients_birthday",
    "contact|cell_phone":         "clients_phone_number",
    "general|current_date_short": None,  # special: today’s date
}
 
# ─── 2) Fetch the case row (all needed columns live in `cases`) ──────────────
def get_case_data(case_id):
    try:
        conn = mysql.connector.connect(
            host="casesdb.cluster-cy05fj2evp1i.us-east-1.rds.amazonaws.com",
            user="admin",
            password="GFiL*elWuqU5Csl1",
            database="casesdb"
        )
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT
              *,
              CONCAT(contact_first_name,' ',contact_last_name) AS contact_full_name
            FROM cases
            WHERE case_id = %s
        """, (case_id,))
        return cursor.fetchone() or {}
    except mysql.connector.Error as e:
        print("DB error:", e, file=sys.stderr)
        sys.exit(1)
    finally:
        if conn.is_connected():
            cursor.close()
            conn.close()
 
# ─── 3) Fill every AcroForm field (parents & lone widgets) ──────────────────
def fill_pdf(template_path, data, output_path):
    today = date.today()
    today_str = f"{today.month}/{today.day}/{today.year}"
    pdf = PdfReader(template_path)
    acro = pdf.Root.AcroForm
 
    if not acro or not acro.Fields:
        print(" No AcroForm.Fields found in", template_path, file=sys.stderr)
        return
 
    for f in acro.Fields:
        raw = f.get('/T')
        if not raw:
            continue
 
        raw_name = raw[1:-1]                     # strip parentheses
        base_name = raw_name.split('#', 1)[0]    # remove suffix
        base_name = base_name.lstrip('\ufeff').lstrip('\ufffe')  # remove BOM
 
        print(f"Detected PDF field: {raw_name} -> base name: {base_name}")
 
        if base_name not in FIELD_MAP:
            print(f"Skipping unknown field: {base_name}")
            continue
 
        if base_name == "general|current_date_short":
            val = today_str
        else:
            val = data.get(FIELD_MAP[base_name], "")
 
        print(f"Filling '{raw_name}' with value: '{val}'")
 
        # Set read-only flag (Ff = 1) to make it non-editable
        f.update(PdfDict(V=str(val), Ff=1))
 
    # Ensure PDF viewers regenerate field appearances
    acro.update(PdfDict(NeedAppearances=PdfObject("true")))
 
    PdfWriter().write(output_path, pdf)
    print("PDF written to:", output_path)
 
# ─── 4) Script entrypoint ────────────────────────────────────────────────────
def main():
    if len(sys.argv) != 3:
        print("Usage: python generate_pdf.py <case_id> <template_filename>", file=sys.stderr)
        sys.exit(1)
 
    case_id = sys.argv[1]
    template_filename = sys.argv[2]
 
    data = get_case_data(case_id)
    print("Loaded case data:", {k: data.get(k) for k in FIELD_MAP.values() if k})
 
    base_dir = os.path.dirname(os.path.abspath(__file__))
    tpl_path = os.path.join(base_dir, "case-eSignTemplate", template_filename)
 
    if not os.path.isfile(tpl_path):
        print("Template not found:", tpl_path, file=sys.stderr)
        sys.exit(1)
 
    out_dir = os.path.join(base_dir, "case-eSignTemplate", case_id)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "SSD-2025-Client-Onboarding-Document_Signature_Required.pdf")
 
    fill_pdf(tpl_path, data, out_path)
 
if __name__ == "__main__":
    main()
 