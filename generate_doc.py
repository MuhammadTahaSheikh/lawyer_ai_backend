#!/usr/bin/env python3
import sys
import os
import mysql.connector
from docxtpl import DocxTemplate
from datetime import datetime, date
from jinja2 import exceptions
from jinja2 import Environment, Undefined
from io import BytesIO

# ─────────────────────────────────────────────────────────────────────────────
FIELD_MAP = {
    '116550': 'mailing_address',
    '116551': 'plaintiff',
    '116552': 'defendant',
    '116553': 'insured_property',
    '116554': 'policy_number',
    '116555': 'claim_number',
    '116560': 'defense_attorney',
    '116561': 'defense_attorney_firm',
    '116562': 'ocs_phone_number',
    '116563': 'ocs_service_email',
    '116564': 'ocs_direct_email',
    '116565': 'clients_phone_number',
    '116566': 'judge',
    '116567': 'division',
    '116568': 'type_of_loss_automated',
    '116569': 'clients_email',
    '116917': 'ocs_fax_number',
    '116925': 'date_of_loss',
    '116927': 'public_adjusters',
    '116928': 'county',
    '117979': 'personal_representative',
    '117981': 'assigned_attorney',
    '155961': 'plaintiff_2',
    '156985': 'origination_credit',
    '184041': 'indemnity_settlement',
    '184043': 'attorneys_fee_settlement',
    '186877': 'paralegal_assignment',
    '186878': 'responses_to_plaintiffs_discovery_due',
    '186879': 'responses_to_defendants_discovery_due',
    '191390': 'settlement_date',
    '213551': 'insurance_company',
    '213552': 'insured_property',
    '213553': 'mailing_address',
    '213554': 'insurance_policy_number',
    '213555': 'claim_number',
    '213556': 'date_of_damage',
    '213557': 'public_adjusters',
    '213558': 'brief_description_of_the_loss',
    '213560': 'have_the_claim_been_reported',
    '213561': 'contacted_another_attorney_name',
    '213565': 'preferred_language',
    '217575': 'defendant_discovery_responses_received',
    '228742': "prosecutor's_name",
    '228743': 'date_of_arrest',
    '228745': 'arrest_number',
    '228746': 'co_defendants',
    '228747': "state_attorney's_office",
    '228749': 'payment_status',
    '236184': 'injured_party',
    '236186': 'treating_doctor',
    '236190': "client's_examination_date",
    '236192': "client's_(pip)_car_insurance_company",
    '236193': 'at_fault_party_insurance_company',
    '246956': 'scheduling_assignment',
    '256892': 'at_fault_party',
    '264720': 'clients_birthday',
    '264721': 'social_security_number',
    '264722': 'clients_home_address',
    '264723': "client's_health_insurance_name",
    '264768': 'pip_claim_number',
    '264769': 'at_fault_carrier_claim_number',
    '264776': 'location_of_accident',
    '281321': 'depo_request_fa',
    '281327': 'hearing_request_mtc',
    '281382': 'depo_request_cr',
    '281384': 'hearing_request_cmc',
    '281385': 'hearing_request_mtd',
    '379180': 'case_evaluation',
    '455249': 'coverage_determination',
    '467573': 'aob_type',
    '494083': 'hearing_type',
    '494161': "insured's_phone_number",
    '494162': "insured's_email",
    '10631901': 'case_number',
    '10631902': 'name',
    '10631903': 'contact_first_name',
    '10631904': 'contact_last_name',
    '10631905': 'contact_full_name',
    '10631906': 'opened_date',
    '10631907': 'contact_address_city',
    '10631908': 'contact_address_state',
    '10631909': 'contact_address_zip_code',
    '106319010':'contact_address_street',
    '106319011':'company_name',
    '106319012':'company_work_phone',
    '106319013':'company_fax',
     '106319014':'description',
}
# ─────────────────────────────────────────────────────────────────────────────

def find_template_file(root_dir, filename):
    for root, dirs, files in os.walk(root_dir):
        if filename in files:
            return os.path.join(root, filename)
    return None

def get_case_data(case_id):
    try:
        conn = mysql.connector.connect(
            host="casesdb.cluster-cy05fj2evp1i.us-east-1.rds.amazonaws.com",
            user="admin",
            password="GFiL*elWuqU5Csl1",
            database="casesdb"
        )
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM cases WHERE case_id = %s", (case_id,))
        return cursor.fetchone()
    except mysql.connector.Error as err:
        print("Error connecting to the database:", err, file=sys.stderr)
        return None
    finally:
        try:
            if conn.is_connected():
                cursor.close()
                conn.close()
        except NameError:
            pass

# (Optional) You can leave this in case you need it elsewhere, but it's not used below:
def format_date(value, default="N/A"):
    if not value:
        return default
    if isinstance(value, datetime) or isinstance(value, date):
        if isinstance(value, date) and not isinstance(value, datetime):
            return datetime.combine(value, datetime.min.time())
        return value
    if isinstance(value, str):
        try:
            return datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            pass
    return default

def main():
    if len(sys.argv) < 3:
        print("Usage: python generate_doc.py <case_id> <template_filename>", file=sys.stderr)
        sys.exit(1)

    case_id = sys.argv[1]
    template_filename = sys.argv[2]

    case_data = get_case_data(case_id)
    if not case_data:
        print(f"Case with id {case_id} not found or error occurred.", file=sys.stderr)
        sys.exit(1)

    now = datetime.now()
    current_date_short_str = now.strftime("%m/%d/%Y")
    current_date_long_str = now.strftime("%B %d, %Y")

    context = dict(case_data)
    context.update({
        "current_date": current_date_long_str,
        "current_date_short": current_date_short_str,
        "general": {
            "current_date_short": current_date_short_str,
            "current_date_long": current_date_long_str
        },
        "case": {}
    })

    # ─── Simplified loop: just take the raw DB value and convert to string ───────
    for fid, col in FIELD_MAP.items():
        value = case_data.get(col)
        if value is None:
            context["case"][fid] = "N/A"
        else:
            context["case"][fid] = str(value)

    base_dir = os.path.dirname(os.path.abspath(__file__))
    templates_dir = os.path.join(base_dir, "case_templates")
    tpl_path = find_template_file(templates_dir, template_filename)

    if not tpl_path or not os.path.exists(tpl_path):
        print(f"Template file {template_filename} not found in any subfolder of case_templates.", file=sys.stderr)
        sys.exit(1)

    try:
        class SilentUndefined(Undefined):
            def _fail_with_undefined_error(self, *args, **kwargs):
                return "N/A"

        env = Environment(undefined=SilentUndefined)

        def jinja_current_date_long(fmt='%B %d, %Y'):
            return datetime.now().strftime(fmt)

        def jinja_current_date_short(fmt='%m/%d/%Y'):
            return datetime.now().strftime(fmt)

        def safe_strftime(value, fmt="%m/%d/%Y"):
            try:
                if isinstance(value, datetime):
                    return value.strftime(fmt)
                elif isinstance(value, str):
                    dt = datetime.strptime(value, "%Y-%m-%d")
                    return dt.strftime(fmt)
                return str(value)
            except Exception:
                return "N/A"

        env.filters['current_date_long'] = jinja_current_date_long
        env.filters['current_date_short'] = jinja_current_date_short
        env.filters['strftime'] = safe_strftime

        doc = DocxTemplate(tpl_path)

        try:
            doc.render(context, env)
        except exceptions.TemplateSyntaxError as e:
            print(f"Jinja2 Syntax Error: {e.message} at line {e.lineno}", file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            print(f"Template rendering failed: {e}", file=sys.stderr)
            sys.exit(1)

        # Output the DOCX bytes to stdout
        output = BytesIO()
        doc.save(output)
        output.seek(0)
        sys.stdout.buffer.write(output.read())

    except Exception as e:
        print(f"Error generating DOCX from {template_filename}: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()