// recruitmentUpload.js
// Parses the bulk-upload template (CSV export of the xlsx "Data" sheet) and
// writes rows to roles / role_locations / candidates — matching on
// Division + Role Title + Location as plain text, creating what doesn't
// already exist rather than requiring the uploader to know any IDs.

import { supabase } from './supabaseClient';

// Minimal CSV parser — no external dependency (papaparse isn't in this repo's
// package.json, and the workflow here is direct GitHub edits, not npm install).
// Handles quoted fields, embedded commas, and escaped quotes ("").
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') pushField();
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') pushRow();
      else field += c;
    }
  }
  if (field.length || row.length) pushRow();

  const filtered = rows.filter(r => r.some(cell => cell.trim() !== ''));
  if (filtered.length === 0) return { data: [], meta: { fields: [] } };

  const headers = filtered[0].map(h => h.trim());
  const data = filtered.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
    return obj;
  });
  return { data, meta: { fields: headers } };
}

const REQUIRED_HEADERS = [
  'Division', 'Role Title', 'Role Type', 'Suggested Grade',
  'Location', 'No of Positions', 'Role Location Status', 'Planned Start Date', 'Date Request Received',
  'Candidate Name', 'Contact Phone', 'Source', 'Candidate Status', 'Medical Report Received',
  'Date Sourced', 'Date Interview', 'Date Sent for Onboarding Approval', 'Date Documentation Started',
  'Date Offer Extended', 'Date Offer Accepted', 'Expected Resumption Date', 'Actual Resumption Date',
  'Date Closed', 'Status Reason',
];

function parseDate(val) {
  if (!val || String(val).trim() === '') return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function parseBool(val) {
  return String(val).trim().toUpperCase() === 'TRUE';
}

// Returns { rows: [...], errors: [...] } — validates before writing anything.
function validateParsedRows(parsed) {
  const errors = [];
  const headers = parsed.meta.fields || [];
  const missingHeaders = REQUIRED_HEADERS.filter(h => !headers.includes(h));
  if (missingHeaders.length) {
    errors.push(`Missing columns: ${missingHeaders.join(', ')}. Did you edit the header row?`);
    return { rows: [], errors };
  }

  const rows = parsed.data.map((row, idx) => {
    const rowNum = idx + 2; // +1 for header, +1 for 1-indexing
    const rowErrors = [];
    if (!row['Division']?.trim()) rowErrors.push(`Row ${rowNum}: Division is blank`);
    if (!row['Role Title']?.trim()) rowErrors.push(`Row ${rowNum}: Role Title is blank`);
    if (!row['Location']?.trim()) rowErrors.push(`Row ${rowNum}: Location is blank`);
    if (!row['No of Positions'] || isNaN(Number(row['No of Positions']))) {
      rowErrors.push(`Row ${rowNum}: No of Positions must be a number`);
    }
    if (rowErrors.length) errors.push(...rowErrors);
    return { rowNum, raw: row, errors: rowErrors };
  });

  return { rows, errors };
}

// CSV entry point — unchanged behavior, no external dependency.
export function parseUploadFile(fileText) {
  return validateParsedRows(parseCsv(fileText));
}

// ---------------------------------------------------------------
// XLSX entry point — loads SheetJS from a CDN at *runtime* (a plain
// <script> tag, injected into the page), not as an npm import. This is
// deliberate: an npm import (like the papaparse one that broke the build
// earlier) needs to be listed in package.json and installed before Netlify
// can build the app — something this workflow (editing files directly on
// GitHub, no local npm install step) can't do. A runtime script tag has no
// such requirement — it's fetched by the browser when the Upload tab is
// used, exactly like a web font, and never touches the build at all.
// ---------------------------------------------------------------
let xlsxLibPromise = null;
function loadXlsxLibrary() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxLibPromise) return xlsxLibPromise;
  xlsxLibPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error('Could not load the Excel reader. Check your internet connection and try again, or save the file as CSV instead.'));
    document.head.appendChild(script);
  });
  return xlsxLibPromise;
}

export async function parseXlsxUploadFile(file) {
  const XLSX = await loadXlsxLibrary();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames.find(n => n.toLowerCase() === 'data') || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const meta = { fields: data.length ? Object.keys(data[0]) : [] };
  // Coerce every cell to a string, same shape parseCsv produces, so
  // validateParsedRows doesn't need to know which source it came from.
  const stringified = data.map(row => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = v === null || v === undefined ? '' : String(v).trim();
    return out;
  });
  return validateParsedRows({ data: stringified, meta });
}

// Executes the upload: creates/reuses divisions lookup (divisions must already
// exist — this does NOT create new divisions, only roles/role_locations/candidates),
// then roles, then role_locations, then candidates.
export async function executeUpload(parsedRows, onProgress) {
  const results = { created: 0, skipped: 0, failed: [] };

  // Cache lookups within this run to avoid repeat queries
  const divisionCache = new Map();
  const roleCache = new Map(); // key: `${divisionId}::${roleTitle}` -> role_id
  const roleLocationCache = new Map(); // key: `${roleId}::${location}` -> role_location_id

  const { data: { user } } = await supabase.auth.getUser();

  for (const row of parsedRows) {
    if (row.errors.length) { results.skipped++; continue; }
    const r = row.raw;

    try {
      // 1. Resolve division (must already exist)
      let divisionId = divisionCache.get(r['Division']);
      if (!divisionId) {
        const { data: div, error } = await supabase
          .from('divisions').select('division_id').eq('name', r['Division'].trim()).maybeSingle();
        if (error) throw error;
        if (!div) throw new Error(`Division "${r['Division']}" does not exist — add it first.`);
        divisionId = div.division_id;
        divisionCache.set(r['Division'], divisionId);
      }

      // 2. Resolve or create role
      const roleKey = `${divisionId}::${r['Role Title'].trim()}`;
      let roleId = roleCache.get(roleKey);
      if (!roleId) {
        const { data: existingRole } = await supabase
          .from('roles').select('role_id')
          .eq('division_id', divisionId).eq('role_title', r['Role Title'].trim())
          .is('deleted_at', null).maybeSingle();
        if (existingRole) {
          roleId = existingRole.role_id;
        } else {
          const { data: newRole, error } = await supabase
            .from('roles').insert({
              division_id: divisionId,
              role_title: r['Role Title'].trim(),
              role_type: r['Role Type']?.trim() || null,
              suggested_grade: r['Suggested Grade']?.trim() || null,
              created_by: user?.id,
            }).select('role_id').single();
          if (error) throw error;
          roleId = newRole.role_id;
        }
        roleCache.set(roleKey, roleId);
      }

      // 3. Resolve or create role_location
      const rlKey = `${roleId}::${r['Location'].trim()}`;
      let roleLocationId = roleLocationCache.get(rlKey);
      if (!roleLocationId) {
        const { data: existingRL } = await supabase
          .from('role_locations').select('role_location_id')
          .eq('role_id', roleId).eq('location', r['Location'].trim())
          .is('deleted_at', null).maybeSingle();
        if (existingRL) {
          roleLocationId = existingRL.role_location_id;
        } else {
          const { data: newRL, error } = await supabase
            .from('role_locations').insert({
              role_id: roleId,
              location: r['Location'].trim(),
              no_of_positions: Number(r['No of Positions']),
              status: r['Role Location Status']?.trim() || 'Yet to Start',
              planned_start_date: parseDate(r['Planned Start Date']),
              date_request_received: parseDate(r['Date Request Received']),
              created_by: user?.id,
            }).select('role_location_id').single();
          if (error) throw error;
          roleLocationId = newRL.role_location_id;
        }
        roleLocationCache.set(rlKey, roleLocationId);
      }

      // 4. Add candidate, only if a name was actually given
      if (r['Candidate Name']?.trim()) {
        const { error } = await supabase.from('candidates').insert({
          role_location_id: roleLocationId,
          candidate_name: r['Candidate Name'].trim(),
          contact_phone: r['Contact Phone']?.trim() || null,
          source: r['Source']?.trim() || null,
          status: r['Candidate Status']?.trim() || 'Sourcing',
          medical_report_received: parseBool(r['Medical Report Received']),
          date_sourced: parseDate(r['Date Sourced']),
          date_interview: parseDate(r['Date Interview']),
          date_sent_for_onboarding_approval: parseDate(r['Date Sent for Onboarding Approval']),
          date_documentation_started: parseDate(r['Date Documentation Started']),
          date_offer_extended: parseDate(r['Date Offer Extended']),
          date_offer_accepted: parseDate(r['Date Offer Accepted']),
          expected_resumption_date: parseDate(r['Expected Resumption Date']),
          actual_resumption_date: parseDate(r['Actual Resumption Date']),
          date_closed: parseDate(r['Date Closed']),
          status_reason: r['Status Reason']?.trim() || null,
          created_by: user?.id,
          updated_by: user?.id,
        });
        if (error) throw error;
      }

      results.created++;
    } catch (err) {
      results.failed.push({ rowNum: row.rowNum, message: err.message });
    }
    onProgress?.(results);
  }

  return results;
}

// ---------------------------------------------------------------
// Candidate-only bulk upload — for the Candidates tab. Deliberately
// stricter than executeUpload: it never creates a division, role, or
// role_location. If the Division/Role/Location named in a row doesn't
// already exist, that row fails with a clear message rather than
// silently creating structure — creating roles/locations is the Roles
// tab's job, not Candidates'. Every row here also requires a Candidate
// Name; a blank name has nothing to do on this tab.
// ---------------------------------------------------------------
export async function executeCandidateUpload(parsedRows, onProgress) {
  const results = { created: 0, skipped: 0, failed: [] };
  const { data: { user } } = await supabase.auth.getUser();
  const roleLocationCache = new Map(); // key: `${division}::${role}::${location}` -> role_location_id

  for (const row of parsedRows) {
    if (row.errors.length) { results.skipped++; continue; }
    const r = row.raw;

    try {
      if (!r['Candidate Name']?.trim()) {
        throw new Error('Candidate Name is required for a candidate upload.');
      }

      const key = `${r['Division'].trim()}::${r['Role Title'].trim()}::${r['Location'].trim()}`;
      let roleLocationId = roleLocationCache.get(key);
      if (!roleLocationId) {
        const { data: div, error: divErr } = await supabase
          .from('divisions').select('division_id').eq('name', r['Division'].trim()).maybeSingle();
        if (divErr) throw divErr;
        if (!div) throw new Error(`Division "${r['Division']}" doesn't exist.`);

        const { data: role, error: roleErr } = await supabase
          .from('roles').select('role_id')
          .eq('division_id', div.division_id).eq('role_title', r['Role Title'].trim())
          .is('deleted_at', null).maybeSingle();
        if (roleErr) throw roleErr;
        if (!role) throw new Error(`Role "${r['Role Title']}" doesn't exist under "${r['Division']}" — create it on the Roles tab first.`);

        const { data: rl, error: rlErr } = await supabase
          .from('role_locations').select('role_location_id')
          .eq('role_id', role.role_id).eq('location', r['Location'].trim())
          .is('deleted_at', null).maybeSingle();
        if (rlErr) throw rlErr;
        if (!rl) throw new Error(`Location "${r['Location']}" doesn't exist for "${r['Role Title']}" — add it on the Roles tab first.`);

        roleLocationId = rl.role_location_id;
        roleLocationCache.set(key, roleLocationId);
      }

      const { error } = await supabase.from('candidates').insert({
        role_location_id: roleLocationId,
        candidate_name: r['Candidate Name'].trim(),
        contact_phone: r['Contact Phone']?.trim() || null,
        source: r['Source']?.trim() || null,
        status: r['Candidate Status']?.trim() || 'Sourcing',
        medical_report_received: parseBool(r['Medical Report Received']),
        date_sourced: parseDate(r['Date Sourced']),
        date_interview: parseDate(r['Date Interview']),
        date_sent_for_onboarding_approval: parseDate(r['Date Sent for Onboarding Approval']),
        date_documentation_started: parseDate(r['Date Documentation Started']),
        date_offer_extended: parseDate(r['Date Offer Extended']),
        date_offer_accepted: parseDate(r['Date Offer Accepted']),
        expected_resumption_date: parseDate(r['Expected Resumption Date']),
        actual_resumption_date: parseDate(r['Actual Resumption Date']),
        date_closed: parseDate(r['Date Closed']),
        status_reason: r['Status Reason']?.trim() || null,
        created_by: user?.id,
        updated_by: user?.id,
      });
      if (error) throw error;

      results.created++;
    } catch (err) {
      results.failed.push({ rowNum: row.rowNum, message: err.message });
    }
    onProgress?.(results);
  }

  return results;
}
