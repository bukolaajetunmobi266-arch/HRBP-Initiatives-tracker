import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const ROLE_LOCATION_STATUSES = ["Open", "Yet to Start", "On Hold", "Deferred", "Cancelled", "Closed"];
const CANDIDATE_STATUSES = [
  "Sourcing",
  "Interview",
  "Onboarding Approval",
  "Documentation",
  "Offer",
  "Awaiting Resumption",
  "Closed",
  "Dropped",
  "Rejected",
];
const EMPLOYMENT_TYPES = ["Full-Time", "Contract", "Affiliate", "Intern"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function clean(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function isBlankLike(value: unknown) {
  return ['', 'N/A', 'NA', 'N.A.', '-', '—'].includes(clean(value).toUpperCase());
}

function parseDate(value: unknown, optional = false) {
  const raw = clean(value);
  if (isBlankLike(raw)) {
    if (optional) return null;
    throw new Error("Date is required. Use YYYY-MM-DD.");
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: "${raw}". Use YYYY-MM-DD.`);
  return d.toISOString().slice(0, 10);
}

function normaliseDivisionName(value: unknown) {
  const raw = clean(value);
  const aliases: Record<string, string> = {
    "Federal Business": "Federal Business Sales",
    "State Business": "State Business Sales",
    "BMC": "Executive Office - Brand Marketing & Corporate Communication",
    "DT": "Executive Office - Digital Transformation",
    "FI": "Executive Office - Financial Inclusion",
    "Financial Inclusion": "Executive Office - Financial Inclusion",
  };
  return aliases[raw] || raw;
}

function parseNumber(value: unknown) {
  const n = Number(clean(value));
  if (!Number.isFinite(n) || n <= 0) throw new Error("No. of Positions must be a positive number.");
  return n;
}

function profileCanAccessDivision(profile: any, division: any) {
  if (["admin", "recruitment_admin"].includes(profile.recruitment_role)) return true;
  return ["hrbp", "analyst"].includes(profile.recruitment_role)
    && division?.hrbp_id
    && division.hrbp_id === profile.recruitment_hrbp_id;
}

function validateRow(raw: any, rowNum: number) {
  const division = normaliseDivisionName(raw["Division"] || raw["Division / Business"]);
  const roleTitle = clean(raw["Role Title"]);
  const roleType = clean(raw["Role Type"]);
  const location = clean(raw["Location"]);
  const candidateName = clean(raw["Candidate Name"]);
  const employmentType = clean(raw["Employment Type"]);
  const status = clean(raw["Role Location Status"]) || "Open";
  const candidateStatus = clean(raw["Recruitment Stage"]) || "Sourcing";

  if (!division) throw new Error(`Row ${rowNum}: Division is blank.`);
  if (!roleTitle) throw new Error(`Row ${rowNum}: Role Title is blank.`);
  if (!roleType || !["Sales", "Support"].includes(roleType)) {
    throw new Error(`Row ${rowNum}: Role Type must be Sales or Support.`);
  }
  if (!location) throw new Error(`Row ${rowNum}: Location is blank.`);
  parseNumber(raw["No. of Positions"] || raw["No of Positions"]);
  parseDate(raw["Date Request Received"]);
  parseDate(raw["Start Date"], true);
  if (!ROLE_LOCATION_STATUSES.includes(status)) {
    throw new Error(`Row ${rowNum}: Role Location Status is invalid.`);
  }

  if (candidateName) {
    if (!employmentType || !EMPLOYMENT_TYPES.includes(employmentType)) {
      throw new Error(`Row ${rowNum}: Employment Type is required and must be Full-Time, Contract, Affiliate, or Intern.`);
    }
    if (!CANDIDATE_STATUSES.includes(candidateStatus)) {
      throw new Error(`Row ${rowNum}: Recruitment Stage is invalid.`);
    }
  }

  if (status === "On Hold" || status === "Deferred" || status === "Cancelled") {
    if (!clean(raw["Status Reason"])) {
      throw new Error(`Row ${rowNum}: Status Reason is required for ${status}.`);
    }
  }
  if (status === "Deferred") {
    const year = Number(clean(raw["Deferred To Year"]));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new Error(`Row ${rowNum}: Deferred To Year is required for Deferred roles.`);
    }
  }
}

async function getProfile(admin: any, userId: string) {
  const { data, error } = await admin
    .from("profiles")
    .select("id, recruitment_role, recruitment_hrbp_id")
    .eq("id", userId)
    .single();
  if (error || !data) throw new Error("Your recruitment access profile could not be found.");
  if (!["admin", "recruitment_admin", "hrbp", "analyst"].includes(data.recruitment_role)) {
    throw new Error("You do not have permission to import recruitment data.");
  }
  return data;
}

async function processRow(admin: any, profile: any, raw: any, rowNum: number, userId: string) {
  validateRow(raw, rowNum);

  const divisionName = normaliseDivisionName(raw["Division"] || raw["Division / Business"]);
  const roleTitle = clean(raw["Role Title"]);
  const roleType = clean(raw["Role Type"]);
  const location = clean(raw["Location"]);
  const positions = parseNumber(raw["No. of Positions"] || raw["No of Positions"]);
  const status = clean(raw["Role Location Status"]) || "Open";
  const statusReason = clean(raw["Status Reason"]) || null;
  const reviewDate = parseDate(raw["Review Date"], true);
  const deferredToYearRaw = clean(raw["Deferred To Year"]);
  const deferredToYear = deferredToYearRaw ? Number(deferredToYearRaw) : null;
  const requestDate = parseDate(raw["Date Request Received"]);
  const startDate = parseDate(raw["Start Date"], true);

  const { data: division, error: divisionError } = await admin
    .from("divisions")
    .select("division_id, name, hrbp_id")
    .eq("name", divisionName)
    .maybeSingle();
  if (divisionError) throw divisionError;
  if (!division) throw new Error(`Division "${divisionName}" does not exist.`);
  if (!profileCanAccessDivision(profile, division)) {
    throw new Error(`You do not have access to the "${divisionName}" division.`);
  }

  let roleId: string;
  const { data: existingRole, error: roleLookupError } = await admin
    .from("roles")
    .select("role_id, role_type")
    .eq("division_id", division.division_id)
    .eq("role_title", roleTitle)
    .is("deleted_at", null)
    .maybeSingle();
  if (roleLookupError) throw roleLookupError;

  if (existingRole) {
    roleId = existingRole.role_id;
    if (existingRole.role_type && existingRole.role_type !== roleType) {
      throw new Error(`Role "${roleTitle}" already exists as ${existingRole.role_type}, not ${roleType}.`);
    }
  } else {
    const { data: role, error } = await admin
      .from("roles")
      .insert({
        division_id: division.division_id,
        role_title: roleTitle,
        role_type: roleType,
        created_by: userId,
      })
      .select("role_id")
      .single();
    if (error) throw error;
    roleId = role.role_id;
  }

  let roleLocationId: string;
  const { data: existingLocation, error: locationLookupError } = await admin
    .from("role_locations")
    .select("role_location_id, no_of_positions, status")
    .eq("role_id", roleId)
    .eq("location", location)
    .is("deleted_at", null)
    .maybeSingle();
  if (locationLookupError) throw locationLookupError;

  const roleLocationPayload = {
    role_id: roleId,
    location,
    no_of_positions: positions,
    status,
    planned_start_date: startDate,
    date_request_received: requestDate,
    date_location_closed: status === "Closed" ? (parseDate(raw["Date Location Closed"]) || new Date().toISOString().slice(0, 10)) : null,
    status_reason: statusReason,
    status_review_date: reviewDate,
    deferred_to_year: status === "Deferred" ? deferredToYear : null,
  };

  if (existingLocation) {
    roleLocationId = existingLocation.role_location_id;
    const { error } = await admin
      .from("role_locations")
      .update(roleLocationPayload)
      .eq("role_location_id", roleLocationId);
    if (error) throw error;
  } else {
    const { data: newLocation, error } = await admin
      .from("role_locations")
      .insert({ ...roleLocationPayload, created_by: userId })
      .select("role_location_id")
      .single();
    if (error) throw error;
    roleLocationId = newLocation.role_location_id;
  }

  const candidateName = clean(raw["Candidate Name"]);
  if (candidateName) {
    const { error } = await admin
      .from("candidates")
      .insert({
        role_location_id: roleLocationId,
        candidate_name: candidateName,
        employment_type: clean(raw["Employment Type"]) || null,
        contact_phone: clean(raw["Contact Phone"]) || null,
        source: clean(raw["Source"]) || null,
        status: clean(raw["Recruitment Stage"]) || "Sourcing",
        medical_report_received: false,
        created_by: userId,
        updated_by: userId,
      });
    if (error) throw error;
  }

  return { rowNum, roleTitle, location, candidateName: candidateName || null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required." }, 401);

    const token = authHeader.replace("Bearer ", "");
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json({ error: "Recruitment import backend is not configured." }, 500);

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) return json({ error: "Your session is no longer valid. Please sign in again." }, 401);

    const admin = createClient(url, serviceKey);
    const profile = await getProfile(admin, user.id);

    const body = await req.json();
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    if (!rows.length) return json({ error: "No recruitment rows were supplied." }, 400);
    if (rows.length > 1000) return json({ error: "A single import is limited to 1,000 rows." }, 400);

    const results = { created: 0, failed: [] as Array<{ rowNum: number; message: string }> };

    for (let i = 0; i < rows.length; i++) {
      try {
        await processRow(admin, profile, rows[i], i + 2, user.id);
        results.created++;
      } catch (error) {
        results.failed.push({ rowNum: i + 2, message: error instanceof Error ? error.message : String(error) });
      }
    }

    return json(results);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
