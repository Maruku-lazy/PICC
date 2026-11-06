import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { AppContext, type AppContextValue } from './DemoContext';
import { blankApplication, type ApplicationInput, type ApplicationStatus, type DemoRole, type EnrollmentApplication } from '../types';

type Profile = {
  id: string;
  role: DemoRole;
  account_status: 'active' | 'suspended';
  full_name: string;
  email: string;
};

type ApplicationRow = {
  id: string;
  student_id: string;
  status: ApplicationStatus;
  form_data: Partial<ApplicationInput>;
  reviewer_note: string;
  created_at: string;
  updated_at: string;
};

function toApplication(row: ApplicationRow): EnrollmentApplication {
  return {
    ...blankApplication,
    ...(row.form_data ?? {}),
    documentUploads: {}, // Filenames are not evidence of an uploaded file.
    id: row.id,
    studentId: row.student_id,
    status: row.status,
    reviewerNote: row.reviewer_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [applications, setApplications] = useState<EnrollmentApplication[]>([]);
  const userId = authUser?.id ?? null;

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Do not await Supabase calls inside this callback.
      setAuthUser(session?.user ?? null);
      setInitialized(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!initialized) return;
    let cancelled = false;
    if (!userId) {
      setProfile(null);
      setApplications([]);
      setDataError(null);
      setProfileLoading(false);
      setDataLoading(false);
      return;
    }
    setProfileLoading(true);
    (async () => {
      const { data, error } = await supabase.from('profiles')
        .select('id,role,account_status,full_name,email')
        .eq('id', userId).maybeSingle();
      if (cancelled) return;
      if (error) console.error('Profile lookup failed:', error.message);
      setProfile(error ? null : (data as Profile | null));
      setProfileLoading(false);
    })().catch((error: unknown) => {
      if (!cancelled) { console.error(error); setProfile(null); setProfileLoading(false); }
    });
    return () => { cancelled = true; };
  }, [initialized, userId]);

  const role: DemoRole | null = profile?.account_status === 'active' ? profile.role : null;

  // The initial account load can show the page loader. Subsequent background
  // refreshes (including saveApplication() during document upload) must NOT set
  // dataLoading=true: ApplicationPage would unmount, reset its upload/OCR state,
  // and make the UI look like it reloaded while OCR is still running.
  const refreshApplications = useCallback(async (showInitialLoader = false) => {
    if (!userId || !role) { setApplications([]); setDataError(null); setDataLoading(false); return; }
    if (showInitialLoader) setDataLoading(true);
    try {
      const { data, error } = await supabase.from('enrollment_applications')
        .select('id,student_id,form_data,status,reviewer_note,created_at,updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setApplications(((data ?? []) as ApplicationRow[]).map(toApplication));
      setDataError(null);
    } catch (cause) {
      setDataError(cause instanceof Error ? cause.message : 'Could not load applications.');
      throw cause;
    } finally {
      if (showInitialLoader) setDataLoading(false);
    }
  }, [role, userId]);

  useEffect(() => {
    if (!initialized || profileLoading) return;
    if (!role) { setApplications([]); setDataLoading(false); return; }
    void refreshApplications(true).catch((error: unknown) => {
      console.error('Could not load applications:', error);
      setDataLoading(false);
    });
  }, [initialized, profileLoading, role, refreshApplications]);

  const value = useMemo<AppContextValue>(() => ({
    role, applications, dataError, isSupabase: true,
    loading: !initialized || profileLoading,
    dataLoading,
    userId,
    displayName: profile?.full_name || authUser?.email || '',
    login: async (selectedRole: DemoRole, email?: string, password?: string) => {
      if (!email || !password) throw new Error('Email and password are required.');
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      const id = result.data.user?.id;
      if (!id) throw new Error('No signed-in user was returned.');
      // Validate role and status against the server, never against the user's selection.
      const { data, error } = await supabase.from('profiles')
        .select('id,role,account_status,full_name,email').eq('id', id).single();
      if (error || !data) {
        await supabase.auth.signOut();
        throw new Error('Your account profile could not be loaded. Contact an administrator.');
      }
      if (data.account_status !== 'active' || data.role !== selectedRole) {
        await supabase.auth.signOut();
        throw new Error(data.account_status !== 'active'
          ? 'Your account is not active. Contact the Registrar.'
          : `This account is not registered as a ${selectedRole}.`);
      }
      setProfile(data as Profile);
    },
    register: async (selectedRole, name, email, password) => {
      if (selectedRole !== 'student') {
        throw new Error('Registrar accounts must be created by an authorized administrator.');
      }
      const { data, error } = await supabase.auth.signUp({
        email, password, options: { data: { full_name: name.trim() } },
      });
      if (error) throw error;
      return data.session
        ? 'Account created and signed in. You can now open your Student Portal.'
        : 'Registration received. Check your email for the confirmation link before signing in.';
    },
    resetPassword: async (email) => {
      if (!email.trim()) throw new Error('Enter your email address first.');
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
    },
    logout: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setProfile(null);
      setApplications([]);
    },
    saveApplication: async (input, submit) => {
      // Suppress unuploaded filenames. The document storage module will use its own table.
      const { documentUploads: _filenames, ...persisted } = input;
      void _filenames;
      const { error } = await supabase.rpc('save_my_picc_application', {
        p_form: persisted, p_submit: submit,
      });
      if (error) throw error;
      await refreshApplications();
    },
    changeStatus: async (id, status, note) => {
      const { error } = await supabase.rpc('registrar_change_picc_status', {
        p_application_id: id, p_status: status, p_note: note,
      });
      if (error) throw error;
      await refreshApplications();
    },
    refreshApplications,
    resetDemo: () => {}, // Do not allow destructive demo reset on live records.
  }), [role, applications, initialized, profileLoading, dataLoading, dataError, userId, profile, authUser, refreshApplications]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
