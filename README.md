# HRBP Deliverables Tracker (v2)

Real, multi-user tracker built around your actual objective hierarchy — Corporate Objective → PM Objective → Key Result → Deliverable — with database-enforced permissions, in-app notifications, and Excel export.

**I compiled and verified this code builds cleanly**, but I have not tested it against a live database from here — no Supabase project or credentials are available in this environment. Treat your first sign-up and first deliverable as the real test.

## What's in this version

- **Objective hierarchy** on the Deliverables tab: Corporate Objective → PM Objective → Key Result (with a live completion % bar) → Deliverables. Owner is shown once per Key Result — a single name normally, or a small cluster of first-name badges when a Key Result genuinely spans more than one HRBP. Click a badge to filter straight to that person.
- **"+ New Corporate Objective"** button — opens the same form as Add Deliverable, with a banner making clear you're seeding a brand new objective/PM Objective/Key Result branch.
- **Colors**: Completed = green, In Progress = amber, Not Started = grey, Overdue = red with a caution icon — Overdue is computed automatically from the due date, not a manual status.
- **Revised Due Date → admin notification**: the moment a team member proposes one, every admin gets a 🔔 notification telling them to review and update the real Due Date. A small calendar icon marks any deliverable with a pending, unactioned revision.
- **Comment** (renamed from "Latest Comment") sits before Next Steps, both on the table and in the edit form.
- **Sub-deliverables** — lightweight nested items under any deliverable (title, owner, status).
- **Bulk select + column sorting** on the Deliverables tab, working across all expanded Key Result groups at once.
- **Excel import** — "Import from Excel" button on the Deliverables tab. Upload a file built from `HRBP_Tracker_Import_Template.xlsx` (included in this project) and it parses both the Deliverables and Action Items sheets, matches each Owner name to a real account, shows a preview (row count + any skipped rows with reasons), and only inserts once you confirm. Adds to what's already there — never replaces or deletes existing data.
- **Excel export** — button on the Deliverables tab lets you export either everything or just what's currently filtered, and optionally include the Key Action Log as a second sheet. Column layout matches your original tracker (Division, HRBP, Corporate/PM Objectives, Key Result, Key Initiative & Action, dates, Status, Comment, Next Steps).
- **Action Items** tab (renamed from Key Action Log) — Deliverable/Action, Raised In, Owner, Due Date, Status, Comment.
- **Dark mode** rebuilt using direct JavaScript color-setting rather than relying on CSS cascade, which is what caused it to silently fail in the earlier build. Please stress-test this specifically once deployed.
- **Modal auto-scrolls into view** the instant it opens, regardless of where on a long page you clicked.
- Everything from v1 stays: magic-link auth, real roles (admin/member) enforced at the database level, Due Date lock, delete restriction, assignment/overdue/due-soon notifications.

## What's still simulated, not real

- **Email notifications are not implemented.** Everything is in-app (🔔 bell) only. Real email delivery needs a Supabase Edge Function wired to an email service like Resend, triggered by the same notification logic that already exists in `schema.sql`. This is the next real piece of backend work, not something that exists yet.

## Setup

1. Connect this project to **Lovable** (or a standalone Supabase project) — same as before.
2. Run the entire `supabase/schema.sql` in the SQL editor. It's a full rewrite from v1 — includes new tables (`sub_deliverables`, `key_actions`) and new columns on `deliverables` (`corporate_objective`, `pm_objective`, `key_result`, `next_steps`), plus the new revised-due-date notification trigger.
3. Enable the `pg_cron` extension if it isn't already (Database → Extensions).
4. Fill in `.env` from `.env.example` with your real Supabase URL/key (Lovable does this for you automatically).
5. Sign up as yourself, then in the SQL editor run:
   ```sql
   update profiles set role = 'admin' where email = 'your-email@creditdirect.ng';
   ```
6. Invite your 4 HRBPs — they sign up the same way and default to `member`.

## Running locally

```bash
npm install
npm run dev
```

## Deploying

Same as before — connect to Lovable, or `npm run build` and deploy the `dist/` folder to Netlify/Vercel, pointing at your own Supabase project.

## Brand palette

Primary blue `#0F7FC4` · Navy `#1B2A3C` · Teal `#2E9E75` (success) · Amber `#EF9F27` (in progress) · Coral `#D85A30` (overdue) · Grey `#EAEDF0` (not started)
