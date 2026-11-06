/**
 * One-time, resumable, development-only seeder.
 * Run from project root:
 *   node scripts/seed-50-picc-students.mjs --preview
 *   node --env-file=.env.seed.local scripts/seed-50-picc-students.mjs --apply
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMockStudents, assertMockApplication, MOCK_BATCH } from './piccMockFixtures.mjs';
import { createSeedAdmin, getAllAuthUsers, verifyStudentProfile, assertMockUser } from './piccSeedCommon.mjs';

const targets = buildMockStudents();
const args = process.argv.slice(2);
const mode = args.length === 1 && ['--preview', '--apply'].includes(args[0]) ? args[0] : null;
if (!mode) {
  console.error('Usage: node scripts/seed-50-picc-students.mjs --preview OR --apply');
  process.exitCode = 1;
} else if (mode === '--preview') {
  console.log('Dry preview: 50 FICTIONAL applications, all submitted. No remote calls.');
  console.table(targets.slice(0, 10).map(({ email, fullName, form_data, status }) => ({
    email, name: fullName, program: form_data.program, type: form_data.studentType, status,
  })));
  console.log('No documents, OCR results, payment records, academic assignments, or final approvals are created.');
} else {
  try {
    const admin = await createSeedAdmin();
    console.log(`SEEDING 50 MOCK STUDENTS ONLY. Batch marker: ${MOCK_BATCH}`);
    console.log('The Registrar account and other existing users will NOT be modified.');
    const authUsers = await getAllAuthUsers(admin);
    const usersByEmail = new Map(authUsers.filter(u => u.email).map(u => [u.email.toLowerCase(), u]));
    // Detect collisions before making any writes.
    for (const target of targets) {
      const existing = usersByEmail.get(target.email);
      if (existing) assertMockUser(existing, target.email);
    }
    // Already ignored by the project's existing `.env.*` Git rule.
    const credentialFile = resolve('.env.seed-credentials.json');
    const passwords = existsSync(credentialFile)
      ? JSON.parse(readFileSync(credentialFile, 'utf8'))
      : { _note: 'Fictional development accounts only. Keep private; delete after testing.', batch: MOCK_BATCH, entries: {} };
    if (passwords.batch !== MOCK_BATCH || typeof passwords.entries !== 'object') {
      throw new Error(`Unexpected contents in ${credentialFile}; refusing to replace existing credentials.`);
    }
    function saveCredentials() {
      writeFileSync(credentialFile, JSON.stringify(passwords, null, 2), { mode: 0o600 });
    }
    let createdUsers = 0, createdApplications = 0, skippedApplications = 0;
    for (const [index, target] of targets.entries()) {
      let user = usersByEmail.get(target.email);
      if (!user) {
        const password = randomBytes(24).toString('base64url') + 'Z9!';
        const { data, error } = await admin.auth.admin.createUser({
          email: target.email, password, email_confirm: true,
          user_metadata: {
            full_name: target.fullName,
            picc_mock_seed: MOCK_BATCH,
            picc_mock_kind: 'student',
          },
        });
        if (error || !data?.user) {
          throw new Error(`Could not create ${target.email}: ${error?.message ?? 'missing user'}`);
        }
        user = data.user;
        usersByEmail.set(target.email, user);
        passwords.entries[target.email] = password;
        saveCredentials(); // Persist immediately, allowing interrupted runs to resume.
        createdUsers++;
      }
      await verifyStudentProfile(admin, user.id);
      const { data: current, error: lookupError } = await admin
        .from('enrollment_applications')
        .select('id,form_data')
        .eq('student_id', user.id)
        .maybeSingle();
      if (lookupError) throw new Error(`Could not inspect application for ${target.email}: ${lookupError.message}`);
      if (current) {
        if (!assertMockApplication(current, target.email)) {
          throw new Error(`Existing application for ${target.email} is not marked as mock; refusing overwrite.`);
        }
        skippedApplications++;
      } else {
        const { error: insertError } = await admin.from('enrollment_applications').insert({
          student_id: user.id, form_data: target.form_data, status: target.status,
          reviewer_note: '',
        });
        if (insertError) throw new Error(`Could not insert application for ${target.email}: ${insertError.message}`);
        createdApplications++;
      }
      console.log(`[${index + 1}/50] ${target.email}: ${current ? 'existing mock application' : 'application created'}`);
    }
    console.log(`\nCompleted: created ${createdUsers} Auth accounts, ${createdApplications} applications, skipped ${skippedApplications} existing mock applications.`);
    console.log('See Authentication > Users and the Registrar application queue (refresh browser).');
    console.log(`Test login credentials, including per-user randomized passwords, are stored LOCALLY at: ${credentialFile}`);
    console.log('DO NOT commit .env.seed.local or .env.seed-credentials.json. No emails were sent.');
  } catch (error) {
    console.error(`Seed stopped safely: ${error instanceof Error ? error.message : error}`);
    console.error('Fix the issue and run --apply again; existing tagged mock applications are skipped, not overwritten.');
    process.exitCode = 1;
  }
}
