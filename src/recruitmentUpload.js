// recruitmentUpload.js
// Parses the bulk-upload template (CSV export of the xlsx "Data" sheet) and
// writes rows to roles / role_locations / candidates — matching on
// Division + Role Title + Location as plain text, creating what doesn't
// already exist rather than requiring the uploader to know any IDs.

import Papa from 'papaparse';
import { supabase } from './supabaseClient';

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
export function parseUploadFile(fileText) {
  const parsed = Papa.parse(fileText, { header: true, skipEmptyLines: true });
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
