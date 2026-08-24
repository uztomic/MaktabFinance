// =====================================================================
//  AuthProvider — sessiya, profil, huquqlar va filial konteksti.
//
//  MUHIM: bu yerdagi huquq tekshiruvi FAQAT INTERFEYSNI boshqaradi
//  (tugmani ko'rsatish/yashirish). Haqiqiy himoya bazada — RLS va
//  SECURITY DEFINER funksiyalar (TZ 5.4.3, 5.4.6). Ya'ni brauzerdagi
//  kodni o'zgartirib hech narsaga erishib bo'lmaydi.
// =====================================================================

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type UserRole = Database['public']['Enums']['user_role'];

export interface Branch {
  id: string;
  name: string;
  is_default: boolean;
}

export interface Profile {
  id: string;
  school_id: string;
  role: UserRole;
  full_name: string;
  email: string | null;
  phone: string | null;
  lang: string;
  all_branches: boolean;
  school_name: string;
  school_status: string;
}

export interface Impersonation {
  mode: 'read' | 'write';
  adminId: string | null;
  expiresAt: string | null;
}

interface AuthValue {
  session: Session | null;
  profile: Profile | null;
  branches: Branch[];
  /** Tanlangan filial. null = barcha filiallar (jamlangan ko'rinish). */
  branchId: string | null;
  setBranchId: (id: string | null) => void;
  permissions: Set<string>;
  can: (permission: string) => boolean;
  /** Yozuvga ruxsat: huquq + maktab faol + o'qish rejimi emas. */
  mayWrite: (permission: string) => boolean;
  impersonation: Impersonation | null;
  loading: boolean;
  error: string | null;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

const BRANCH_KEY = 'maktab-branch';

/** JWT ichidagi impersonation claim'larini o'qiydi (TZ 5.4.12). */
function readImpersonation(session: Session | null): Impersonation | null {
  if (!session?.access_token) return null;
  try {
    const payload = JSON.parse(
      atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    if (!payload.imp_mode) return null;
    return {
      mode: payload.imp_mode === 'write' ? 'write' : 'read',
      adminId: payload.imp_admin ?? null,
      expiresAt: payload.imp_exp ?? null,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [branchId, setBranchIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const impersonation = useMemo(() => readImpersonation(session), [session]);

  const setBranchId = useCallback((id: string | null) => {
    setBranchIdState(id);
    try {
      if (id) localStorage.setItem(BRANCH_KEY, id);
      else localStorage.removeItem(BRANCH_KEY);
    } catch { /* muhim emas */ }
  }, []);

  /** Profil, filiallar va huquqlarni yuklaydi. */
  const loadContext = useCallback(async (uid: string) => {
    setError(null);

    // --- Profil + maktab -------------------------------------------
    const { data: user, error: uErr } = await supabase
      .from('app_users')
      .select('id, school_id, role, full_name, email, phone, lang, all_branches, schools!inner(name, status)')
      .eq('id', uid)
      .is('deleted_at', null)
      .maybeSingle();

    if (uErr) {
      setError(uErr.message);
      setProfile(null);
      return;
    }
    if (!user) {
      // Auth hisobi bor, lekin app_users da yozuv yo'q.
      setError('noProfile');
      setProfile(null);
      return;
    }

    // deno-lint-ignore no-explicit-any
    const school = (user as any).schools;
    setProfile({
      id: user.id,
      school_id: user.school_id,
      role: user.role,
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      lang: user.lang,
      all_branches: user.all_branches,
      school_name: school?.name ?? '',
      school_status: school?.status ?? 'active',
    });

    // --- Filiallar (RLS o'zi faqat ruxsat etilganlarini beradi) ----
    const { data: br } = await supabase
      .from('branches')
      .select('id, name, is_default')
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('name');

    const list = br ?? [];
    setBranches(list);

    // Saqlangan tanlov hali ham amal qiladimi?
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(BRANCH_KEY);
    } catch { /* muhim emas */ }

    if (saved && list.some((b) => b.id === saved)) {
      setBranchIdState(saved);
    } else if (list.length === 1) {
      // TZ 4.1 izohi — bitta filialda tanlash ko'rsatilmaydi.
      setBranchIdState(list[0].id);
    } else {
      setBranchIdState(null);
    }

    // --- Huquqlar (TZ 3.1 matritsasi) -------------------------------
    const { data: perms } = await supabase
      .from('role_permissions')
      .select('permission, allowed, school_id')
      .eq('role', user.role);

    // Maktab moslamasi platforma standartidan ustun.
    const merged = new Map<string, boolean>();
    for (const p of perms ?? []) {
      if (p.school_id === null && !merged.has(p.permission)) {
        merged.set(p.permission, p.allowed);
      }
    }
    for (const p of perms ?? []) {
      if (p.school_id !== null) merged.set(p.permission, p.allowed);
    }

    setPermissions(
      new Set([...merged.entries()].filter(([, ok]) => ok).map(([k]) => k)),
    );
  }, []);

  const reload = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    if (data.session?.user?.id) await loadContext(data.session.user.id);
  }, [loadContext]);

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (data.session?.user?.id) {
        await loadContext(data.session.user.id);
      }
      if (alive) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, s) => {
      if (!alive) return;
      setSession(s);
      if (s?.user?.id) {
        await loadContext(s.user.id);
      } else {
        setProfile(null);
        setBranches([]);
        setPermissions(new Set());
      }
      if (alive) setLoading(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [loadContext]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    try {
      localStorage.removeItem(BRANCH_KEY);
    } catch { /* muhim emas */ }
  }, []);

  const value = useMemo<AuthValue>(() => {
    const can = (p: string) => permissions.has(p);

    // TZ 4.13.4 — cheklash rejimida yangi yozuv kiritilmaydi.
    // TZ 4.13.5.4 — texnik yordam o'qish rejimida yozuv yo'q.
    const schoolWritable = profile?.school_status === 'active' ||
      profile?.school_status === 'trial';
    const readonlySession = impersonation !== null && impersonation.mode !== 'write';

    return {
      session,
      profile,
      branches,
      branchId,
      setBranchId,
      permissions,
      can,
      mayWrite: (p: string) => can(p) && schoolWritable && !readonlySession,
      impersonation,
      loading,
      error,
      signOut,
      reload,
    };
  }, [
    session, profile, branches, branchId, setBranchId, permissions,
    impersonation, loading, error, signOut, reload,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth faqat AuthProvider ichida ishlaydi');
  return ctx;
}
