/**
 * Deletes ONLY the 50 specifically tagged mock users/applications from this seeder.
 * Run with the same dev-only credentials file after inspecting its target project:
 *   node --env-file=.env.seed.local scripts/cleanup-picc-mock-students.mjs --preview
 *   node --env-file=.env.seed.local scripts/cleanup-picc-mock-students.mjs --delete-mock-data
 */
import { buildMockStudents, assertMockApplication } from './piccMockFixtures.mjs';
import { createSeedAdmin, getAllAuthUsers, assertMockUser, verifyStudentProfile } from './piccSeedCommon.mjs';

const args = process.argv.slice(2);
const mode = args.length === 1 && ['--preview', '--delete-mock-data'].includes(args[0]) ? args[0] : null;
if (!mode) {
  console.error('Usage: node --env-file=.env.seed.local scripts/cleanup-picc-mock-students.mjs --preview|--delete-mock-data');
  process.exitCode = 1;
} else {
  try {
    const admin = await createSeedAdmin();
    const known = buildMockStudents();
    const expected = new Map(known.map(s => [s.email, s]));
    const users = await getAllAuthUsers(admin);
    const targetUsers = users.filter(u => u.email && expected.has(u.email.toLowerCase()));
    // Reject ANY collision rather than silently deleting a non-mock account.
    for (const user of targetUsers) assertMockUser(user, user.email);
    console.log(`Found ${targetUsers.length} tagged mock accounts. No Registrar or unrelated account is targeted.`);
    if (mode === '--preview') {
      console.table(targetUsers.slice(0, 10).map(u => ({ email: u.email, id: u.id })));
      console.log('Preview only. Nothing deleted.');
    } else {
      for (const [index, user] of targetUsers.entries()) {
        const email = user.email.toLowerCase();
        await verifyStudentProfile(admin, user.id);
        const { data: application, error: lookupError } = await admin
          .from('enrollment_applications').select('id,form_data').eq('student_id', user.id).maybeSingle();
        if (lookupError) throw new Error(`Application lookup failed for ${email}: ${lookupError.message}`);
        if (application) {
          if (!assertMockApplication(application, email)) {
            throw new Error(`Application for ${email} is no longer tagged as mock. Stop and inspect manually.`);
          }
          const { data: documents, error: docError } = await admin.from('application_documents')
            .select('storage_path').eq('application_id', application.id);
          if (docError) throw new Error(`Document lookup failed for ${email}: ${docError.message}`);
          const paths = [...new Set((documents ?? []).map(d => d.storage_path).filter(Boolean))];
          // Remove actual Storage objects through Storage API (never SQL).
          for (let j = 0; j < paths.length; j += 100) {
            const { error: storageError } = await admin.storage.from('picc-enrollment-documents').remove(paths.slice(j, j + 100));
            if (storageError) throw new Error(`Could not remove mock scan for ${email}: ${storageError.message}`);
          }
          // A confirmed registration has an ON DELETE RESTRICT FK to the application.
          const { error: confirmationError } = await admin.from('picc_enrollment_confirmations')
            .delete().eq('application_id', application.id);
          if (confirmationError) throw new Error(`Could not remove mock confirmation for ${email}: ${confirmationError.message}`);
          // Remove provisional assignments before term plans: plan_id is ON DELETE RESTRICT.
          const { error: assignmentError } = await admin.from('picc_student_course_assignments')
            .delete().eq('application_id', application.id);
          if (assignmentError) throw new Error(`Could not remove mock assignments for ${email}: ${assignmentError.message}`);
          const { error: planError } = await admin.from('picc_student_term_plans')
            .delete().eq('application_id', application.id);
          if (planError) throw new Error(`Could not remove mock term plans for ${email}: ${planError.message}`);
          // Explicitly delete mock application first, cascading its own audit rows.
          // This avoids profile-deletion FK order issues for mock student-created OCR/status history.
          const { error: applicationError } = await admin.from('enrollment_applications')
            .delete().eq('id', application.id).eq('student_id', user.id);
          if (applicationError) throw new Error(`Could not remove mock application ${email}: ${applicationError.message}`);
        }
        const { error: userError } = await admin.auth.admin.deleteUser(user.id);
        if (userError) throw new Error(`Could not delete tagged mock Auth user ${email}: ${userError.message}`);
        console.log(`[${index + 1}/${targetUsers.length}] Deleted ${email} and its mock application.`);
      }
      console.log('Cleanup complete. The Registrar account was not targeted.');
      console.log('Delete the local .env.seed-credentials.json file when no longer needed.');
    }
  } catch (error) {
    console.error(`Cleanup stopped: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
