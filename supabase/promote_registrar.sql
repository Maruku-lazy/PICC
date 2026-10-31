-- Run ONLY after creating the registrar as an Auth user in the DEV dashboard.
-- Replace the email with the exact email you verified. No placeholders left in real execution.
-- Do not run on the old 22-table database.
update public.profiles
   set role = 'registrar', account_status = 'active'
 where id = (
   select id from auth.users
   where lower(email) = lower('REPLACE_WITH_YOUR_REGISTRAR_EMAIL')
 );
-- Verify: row must exist and be set to registrar/active:
select email, role, account_status
from public.profiles
where lower(email) = lower('REPLACE_WITH_YOUR_REGISTRAR_EMAIL');
