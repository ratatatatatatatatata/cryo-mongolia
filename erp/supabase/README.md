# CRYO Mongolia ERP backend

This directory contains the versioned Supabase schema, database tests, and Edge Functions for the employee-only ERP.

Safety rules:

- Never commit customer exports, the source Excel workbook, generated import rows, passwords, or secret/service-role keys.
- Browser code may use only the project URL and a publishable key.
- Every Data API table must have explicit grants and Row Level Security.
- Production records are archived or corrected with compensating entries; the application does not hard-delete business data.
- Apply imports through staging and reconciliation. Never load formula totals or wide spreadsheet cells directly into production tables.

The production project is intentionally not linked in source control. Project creation, schema application, Auth configuration, and the first owner bootstrap require connected-provider verification.

First-owner setup is intentionally database-owner-only. After the migration is verified on a new dedicated project, invite exactly one owner through the verified Auth administration flow, confirm that email, then call `private.bootstrap_first_owner(user_id)` from the project SQL editor. The function refuses a second bootstrap, records the access change, and is not executable by browser or service roles.

Do not push hosted Auth configuration until the production Site URL, exact redirect allow-list, custom SMTP sender/domain, 10-email hourly limit, and Mongolian invite/recovery templates have all been verified. The committed SMTP block contains no credentials and remains disabled until those provider values are approved.
