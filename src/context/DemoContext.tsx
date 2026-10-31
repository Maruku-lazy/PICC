import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ApplicationInput, ApplicationStatus, DemoRole, EnrollmentApplication } from '../types';

const STORAGE_KEY = 'picc_frontend_demo_applications_v1';
const ROLE_KEY = 'picc_frontend_demo_role_v1';
const STUDENT_ID = 'local-demo-student';

export interface AppContextValue {
  role: DemoRole | null;
  applications: EnrollmentApplication[];
  loading: boolean;
  dataLoading: boolean;
  isSupabase: boolean;
  userId: string | null;
  displayName: string;
  login: (role: DemoRole, email?: string, password?: string) => Promise<void>;
  register: (role: DemoRole, name: string, email: string, password: string) => Promise<string>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  saveApplication: (input: ApplicationInput, submit: boolean) => Promise<void>;
  changeStatus: (id: string, status: ApplicationStatus, note: string) => Promise<void>;
  refreshApplications: () => Promise<void>;
  resetDemo: () => void;
}
export const AppContext = createContext<AppContextValue | null>(null);

function readApplications(): EnrollmentApplication[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is EnrollmentApplication =>
      !!item && typeof item === 'object' &&
      typeof item.id === 'string' && typeof item.status === 'string'
    ) : [];
  } catch { return []; }
}
function readRole(): DemoRole | null {
  try {
    const role = sessionStorage.getItem(ROLE_KEY);
    return role === 'student' || role === 'registrar' ? role : null;
  } catch { return null; }
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<DemoRole | null>(readRole);
  const [applications, setApplications] = useState<EnrollmentApplication[]>(readApplications);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(applications)); }, [applications]);

  const value: AppContextValue = {
    role, applications, loading: false, dataLoading: false, isSupabase: false,
    userId: role === 'student' ? STUDENT_ID : role === 'registrar' ? 'local-demo-registrar' : null,
    displayName: role === 'student' ? 'Demo Student' : 'Demo Registrar',
    login: async (selectedRole) => {
      sessionStorage.setItem(ROLE_KEY, selectedRole);
      setRole(selectedRole);
    },
    register: async () => { throw new Error('Registration requires Supabase mode.'); },
    resetPassword: async () => { throw new Error('Password recovery requires Supabase mode.'); },
    logout: async () => {
      sessionStorage.removeItem(ROLE_KEY);
      setRole(null);
    },
    saveApplication: async (input, submit) => {
      const now = new Date().toISOString();
      setApplications((current) => {
        const existing = current.find((app) => app.studentId === STUDENT_ID);
        if (existing) {
          if (!['draft', 'needs_correction'].includes(existing.status)) return current;
          return current.map((app) => app.id !== existing.id ? app : {
            ...app, ...input, status: submit ? 'submitted' : 'draft', updatedAt: now,
            reviewerNote: submit ? '' : app.reviewerNote,
          });
        }
        return [{ ...input, id: crypto.randomUUID(), studentId: STUDENT_ID,
          status: submit ? 'submitted' : 'draft', createdAt: now,
          updatedAt: now, reviewerNote: '' }, ...current];
      });
    },
    changeStatus: async (id, status, note) => {
      setApplications((current) => current.map((app) => {
        const allowed: Record<ApplicationStatus, ApplicationStatus[]> = {
          draft: [], submitted: ['under_review', 'needs_correction'],
          under_review: ['needs_correction', 'documents_verified'],
          needs_correction: [], documents_verified: [],
        };
        if (app.id !== id || !allowed[app.status].includes(status)) return app;
        return { ...app, status, reviewerNote: note, updatedAt: new Date().toISOString() };
      }));
    },
    refreshApplications: async () => {},
    resetDemo: () => setApplications([]),
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
export function useDemo(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useDemo must be used inside a PiCC context provider');
  return ctx;
}
