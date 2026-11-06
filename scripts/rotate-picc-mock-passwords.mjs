/**
 * Rotate only the tagged mock student accounts created by piccMockFixtures.
 * NEVER operates on Registrar profiles or untagged accounts.
 * Preview: node scripts/rotate-picc-mock-passwords.mjs --preview
 * Apply:   node --env-file=.env.seed.local scripts/rotate-picc-mock-passwords.mjs --apply
 * The new credentials are written OUTSIDE the project in ~/.picc-dev/.
 */
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MOCK_BATCH, isOurSeededAuthUser } from './piccMockFixtures.mjs';
import { createSeedAdmin, getAllAuthUsers, verifyStudentProfile } from './piccSeedCommon.mjs';

const mode = process.argv[2];
if (!['--preview', '--apply'].includes(mode) || process.argv.length !== 3) {
  console.error('Usage: node scripts/rotate-picc-mock-passwords.mjs --preview | --apply');
  process.exitCode = 1;
} else if (mode === '--preview') {
  console.log(`Would rotate only ${MOCK_BATCH}-tagged development students. No remote change.`);
  console.log('When applied, new passwords are written outside your PICC project.');
} else {
  try {
    const admin = await createSeedAdmin(); // validates DEV URL, secret, and consent token
    const users = (await getAllAuthUsers(admin)).filter(isOurSeededAuthUser);
    // Preflight the account-role guard before rotating ANY password.
    for (const user of users) await verifyStudentProfile(admin, user.id);
    if (!users.length) {
      console.log('No tagged mock student accounts remain. Nothing was changed.');
    } else {
      const directory = resolve(homedir(), '.picc-dev');
      mkdirSync(directory, { recursive:true, mode:0o700 });
      const target = resolve(directory, 'picc-rotated-mock-credentials.json');
      const bundle = { batch: MOCK_BATCH, generatedAt: new Date().toISOString(), entries:{} };
      let rotated = 0;
      for (const user of users) {
        const password = randomBytes(24).toString('base64url') + 'Z9!';
        const { error } = await admin.auth.admin.updateUserById(user.id, { password });
        if (error) throw new Error(`Stopped at ${user.email}: ${error.message}`);
        bundle.entries[user.email] = password;
        writeFileSync(target, JSON.stringify(bundle,null,2), { mode:0o600 });
        rotated++;
      }
      console.log(`Rotated ${rotated} tagged student passwords. No Registrar accounts were changed.`);
      console.log(`New test passwords stored locally outside source: ${target}`);
      console.log('Remove obsolete .env.seed-credentials.json from the project before creating a source ZIP.');
    }
  } catch(error) {
    console.error(error instanceof Error ? error.message : error);
    console.error('Partial rotations may have occurred. Rerun --apply to complete the rotation.');
    process.exitCode=1;
  }
}
