import { existsSync, readFileSync } from 'node:fs';
import { MOCK_BATCH, isOurSeededAuthUser } from './piccMockFixtures.mjs';

const CONFIRM_TOKEN = 'I_CONFIRM_PICC_DEV_MOCK_DATA';

export async function createSeedAdmin() {
  const url = process.env.PICC_SEED_SUPABASE_URL?.trim();
  const secret = process.env.PICC_SEED_SECRET_KEY?.trim();
  if (!url || !secret) {
    throw new Error('Set PICC_SEED_SUPABASE_URL and PICC_SEED_SECRET_KEY in .env.seed.local.');
  }
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)) {
    throw new Error('Expected an HTTPS Supabase project URL ending in .supabase.co.');
  }
  if (process.env.PICC_SEED_CONFIRM !== CONFIRM_TOKEN) {
    throw new Error(`Add PICC_SEED_CONFIRM=${CONFIRM_TOKEN} only after checking this is your DEVELOPMENT project.`);
  }
  // Extra guard: use the same dev URL as the working PiCC frontend, when available.
  if (existsSync('.env.local')) {
    const match = readFileSync('.env.local', 'utf8').match(/^\s*VITE_SUPABASE_URL\s*=\s*[\"']?([^\s\"']+)[\"']?\s*$/m);
    if (match && match[1].replace(/\/$/, '') !== parsed.origin) {
      throw new Error('PICC_SEED_SUPABASE_URL does not match VITE_SUPABASE_URL in .env.local; refusing to seed a different project.');
    }
  }
  if (secret.startsWith('sb_publishable_')) {
    throw new Error('The public/publishable key cannot create test Auth users. Use the server-side secret key.');
  }
  // Supabase Realtime needs an explicit WebSocket transport when Node has no
  // native global WebSocket (notably Node.js 20). Even though this seeder only
  // uses Auth Admin and PostgREST, the Supabase client initializes Realtime.
  // Lazy-load `ws` only for runtimes that need the compatibility transport.
  let realtimeOptions = {};
  if (typeof globalThis.WebSocket !== 'function') {
    let wsModule;
    try {
      wsModule = await import('ws');
    } catch (error) {
      if (error?.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error('This Node.js version needs a WebSocket transport. Run `npm install ws` in the PiCC project root, then retry the seed command.');
      }
      throw error;
    }
    const transport = wsModule.WebSocket ?? wsModule.default;
    if (typeof transport !== 'function') {
      throw new Error('The installed `ws` package did not export a WebSocket constructor. Reinstall it with `npm install ws`.');
    }
    realtimeOptions = { realtime: { transport } };
  }

  // Lazy import permits --preview and fixture tests without npm installation.
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(parsed.origin, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeOptions,
  });
}

export async function getAllAuthUsers(admin) {
  const results = [];
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Unable to list Auth users: ${error.message}`);
    const chunk = data?.users ?? [];
    results.push(...chunk);
    if (chunk.length < 1000) return results;
  }
  throw new Error('Auth user pagination exceeded 100 pages. Refusing to continue.');
}

export async function verifyStudentProfile(admin, userId) {
  const { data, error } = await admin.from('profiles')
    .select('id,role,account_status').eq('id', userId).single();
  if (error) throw new Error(`No student profile was created: ${error.message}. Check your Phase 1 Auth trigger.`);
  if (data.role !== 'student' || data.account_status !== 'active') {
    throw new Error(`Refusing to alter Auth user ${userId}: profile is not an active student.`);
  }
}

export function assertMockUser(user, expectedEmail) {
  if (!isOurSeededAuthUser(user) || user.email.toLowerCase() !== expectedEmail.toLowerCase()) {
    throw new Error(`Account ${expectedEmail} already exists but was not created by ${MOCK_BATCH}; will not change it.`);
  }
}
