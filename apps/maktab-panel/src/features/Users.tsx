// =====================================================================
//  Foydalanuvchilar (TZ 3, 3.1).
//
//  Hisob yaratish Auth admin API sini talab qiladi — uni brauzerdan
//  chaqirib bo'lmaydi (service_role kaliti kerak). Shuning uchun bu
//  sahifa `school-user-ops` Edge Function'iga murojaat qiladi, u esa
//  chaqiruvchining haqiqatan `users.manage` huquqi borligini SERVER
//  TOMONDA tekshiradi.
// =====================================================================

import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { dateTime } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, Notice, PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';
import { useConfirm, useToast } from '@/ui/Feedback';

type Role = 'director' | 'accountant' | 'manager' | 'duty' | 'teacher';

const ROLES: Role[] = ['director', 'accountant', 'manager', 'duty', 'teacher'];

export default function Users() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { mayWrite, can, branches, profile } = useAuth();

  const toast = useToast();
  const confirmDialog = useConfirm();
  const [adding, setAdding] = useState(false);
  // deno-lint-ignore no-explicit-any
  const [editing, setEditing] = useState<any>(null);
  const [created, setCreated] = useState<{ login: string; password: string } | null>(null);
  const [resetting, setResetting] = useState<{ id: string; name: string } | null>(null);

  const canEdit = mayWrite('users.manage');

  const list = useQuery({
    queryKey: ['app-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, full_name, email, phone, role, is_active, all_branches, created_at, user_branches(branch_id, branches(name))')
        .is('deleted_at', null)
        .order('full_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async (f: {
      full_name: string; login: string; role: Role;
      all_branches: boolean; branch_ids: string[]; password: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('school-user-ops', {
        body: { action: 'create', ...f },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data as { login: string; password: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['app-users'] });
      setAdding(false);
      setCreated(data);
    },
  });

  // TZ 4.13.3 — parolni tiklash. Auth admin API kerak, shuning uchun
  // Edge Function orqali (u chaqiruvchining huquqini tekshiradi).
  const resetPassword = useMutation({
    mutationFn: async (v: { user_id: string; password: string }) => {
      const { data, error } = await supabase.functions.invoke('school-user-ops', {
        body: { action: 'reset_password', ...v },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data as { login: string; password: string };
    },
    onSuccess: (data) => {
      setResetting(null);
      setCreated(data);
    },
  });

  const saveUser = useMutation({
    mutationFn: async (f: {
      id: string; full_name: string; role: Role;
      all_branches: boolean; branch_ids: string[];
    }) => {
      const { error } = await supabase.from('app_users').update({
        full_name: f.full_name.trim(),
        role: f.role,
        all_branches: f.all_branches,
      }).eq('id', f.id);
      if (error) throw error;

      // Filial ro'yxati — avval eskilarini olib tashlab, keyin
      // yangilarini yozamiz. `all_branches` bo'lsa ro'yxat kerak emas.
      const { error: delErr } = await supabase
        .from('user_branches').delete().eq('user_id', f.id);
      if (delErr) throw delErr;

      if (!f.all_branches && f.branch_ids.length > 0) {
        const { error: insErr } = await supabase.from('user_branches')
          .insert(f.branch_ids.map((b) => ({ user_id: f.id, branch_id: b })));
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['app-users'] });
      toast.ok(t('ux.saved'));
      setEditing(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggleActive = useMutation({
    mutationFn: async (v: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('app_users')
        .update({ is_active: v.active })
        .eq('id', v.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['app-users'] });
      toast.ok(t('ux.saved'));
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!can('users.manage')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (list.isLoading) return <Loading />;
  if (list.error) {
    return <ErrorState message={(list.error as Error).message}
                       onRetry={() => list.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title={t('users.title')}
        subtitle={t('common.showing', { count: list.data?.length ?? 0 })}
        actions={canEdit && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            {t('users.add')}
          </Button>
        )}
      />

      <Card padded={false}>
        {(list.data?.length ?? 0) === 0 ? <EmptyState /> : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.fullName')}</Th>
                <Th>{t('users.role')}</Th>
                <Th>{t('common.email')} / {t('common.phone')}</Th>
                <Th>{t('users.branches')}</Th>
                <Th>{t('common.status')}</Th>
                <Th align="right">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {list.data!.map((u) => {
                // deno-lint-ignore no-explicit-any
                const ub = (u as any).user_branches ?? [];
                return (
                  <Tr key={u.id}>
                    <Td>
                      <span className="font-medium">{u.full_name}</span>
                      {u.id === profile?.id && (
                        <span className="ml-1.5 text-[11px] text-[var(--text-faint)]">
                          ({t('auth.signedInAs')})
                        </span>
                      )}
                    </Td>
                    <Td><Badge tone="brand">{t(`role.${u.role}`)}</Badge></Td>
                    <Td mono className="text-[var(--text-muted)]">
                      {u.email ?? u.phone ?? '—'}
                    </Td>
                    <Td>
                      {u.all_branches
                        ? <Badge tone="ok">{t('users.allBranches')}</Badge>
                        : (
                          <div className="flex flex-wrap gap-1">
                            {/* deno-lint-ignore no-explicit-any */}
                            {ub.map((b: any) => (
                              <Badge key={b.branch_id}>{b.branches?.name}</Badge>
                            ))}
                            {ub.length === 0 && (
                              <Badge tone="warn">{t('common.empty')}</Badge>
                            )}
                          </div>
                        )}
                    </Td>
                    <Td>
                      <Badge tone={u.is_active ? 'ok' : 'danger'}>
                        {u.is_active ? t('common.active') : t('users.block')}
                      </Badge>
                    </Td>
                    <Td align="right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {canEdit && (
                          <Button size="sm" onClick={() => setEditing(u)}>
                            {t('common.edit')}
                          </Button>
                        )}
                        {canEdit && (
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => setResetting({
                              id: u.id, name: u.full_name,
                            })}
                          >
                            {t('users.resetPassword')}
                          </Button>
                        )}
                        {/* O'z hisobini bloklash mumkin emas — aks holda
                            oxirgi direktor tizimdan chiqib qolardi. */}
                        {canEdit && u.id !== profile?.id && (
                          <Button
                            size="sm"
                            variant={u.is_active ? 'ghost' : 'secondary'}
                            onClick={async () => {
                              if (u.is_active) {
                                const ok = await confirmDialog({
                                  title: t('users.block'),
                                  message: t('users.blockConfirm', {
                                    name: u.full_name,
                                  }),
                                  warning: t('users.blockHint'),
                                  danger: true,
                                  confirmLabel: t('users.block'),
                                });
                                if (!ok) return;
                              }
                              toggleActive.mutate({
                                id: u.id, active: !u.is_active,
                              });
                            }}
                          >
                            {u.is_active ? t('users.block') : t('users.unblock')}
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-3 text-[12px] text-[var(--text-faint)]">
        {t('users.lastActive')}: {list.data?.[0]?.created_at
          ? dateTime(list.data[0].created_at, lang)
          : '—'}
      </div>

      {editing && (
        <EditUserModal
          key={editing.id}
          user={editing}
          branches={branches}
          onClose={() => setEditing(null)}
          onSubmit={(f) => saveUser.mutate({ id: editing.id, ...f })}
          busy={saveUser.isPending}
          error={saveUser.error ? (saveUser.error as Error).message : null}
        />
      )}

      {/* --- Yangi foydalanuvchi ------------------------------- */}
      <ResetPasswordModal
        target={resetting}
        onClose={() => setResetting(null)}
        onSubmit={(password) =>
          resetPassword.mutate({ user_id: resetting!.id, password })}
        busy={resetPassword.isPending}
        error={resetPassword.error ? (resetPassword.error as Error).message : null}
      />

      <AddUserModal
        open={adding}
        onClose={() => setAdding(false)}
        branches={branches}
        onSubmit={(f) => create.mutate(f)}
        busy={create.isPending}
        error={create.error ? (create.error as Error).message : null}
      />

      {/* --- Yaratilgan hisob ma'lumotlari --------------------- */}
      <Modal
        open={!!created}
        title={t('users.add')}
        onClose={() => setCreated(null)}
        footer={
          <Button variant="primary" onClick={() => setCreated(null)}>
            {t('common.close')}
          </Button>
        }
      >
        <div className="space-y-3">
          <Notice tone="warn">
            Parol faqat HOZIR ko'rsatiladi. Uni xodimga yetkazing va
            saqlab qo'ying — keyin ko'rib bo'lmaydi.
          </Notice>
          <div className="rounded-md bg-[var(--bg-inset)] px-3 py-2">
            <div className="text-[11px] uppercase text-[var(--text-muted)]">
              {t('auth.login')}
            </div>
            <div className="num text-sm font-semibold">{created?.login}</div>
          </div>
          <div className="rounded-md bg-[var(--bg-inset)] px-3 py-2">
            <div className="text-[11px] uppercase text-[var(--text-muted)]">
              {t('auth.password')}
            </div>
            <div className="num text-lg font-semibold tracking-wider">
              {created?.password}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------

function AddUserModal({
  open, onClose, branches, onSubmit, busy, error,
}: {
  open: boolean;
  onClose: () => void;
  branches: Array<{ id: string; name: string }>;
  onSubmit: (f: {
    full_name: string; login: string; role: Role;
    all_branches: boolean; branch_ids: string[]; password: string;
  }) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [fullName, setFullName] = useState('');
  const [login, setLogin] = useState('');
  const [role, setRole] = useState<Role>('accountant');
  const [allBranches, setAllBranches] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [password, setPassword] = useState('');

  function toggleBranch(id: string) {
    setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      full_name: fullName,
      login: login.trim(),
      role,
      all_branches: allBranches,
      branch_ids: allBranches ? [] : picked,
      password,
    });
  }

  return (
    <Modal
      open={open} title={t('users.add')} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="add-user" type="submit"
                  disabled={busy || !fullName || !login}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form id="add-user" onSubmit={submit} className="space-y-3">
        <Field label={t('common.fullName')} required>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)}
                 autoFocus required />
        </Field>

        <Field
          label={t('auth.login')}
          hint="Email kiritsangiz parol tiklash havolasi ishlaydi. Telefon kiritsangiz parolni siz tiklaysiz."
          required
        >
          <Input value={login} onChange={(e) => setLogin(e.target.value)}
                 placeholder="direktor@maktab.uz yoki 998901234567" required />
        </Field>

        <Field label={t('users.role')} required>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{t(`role.${r}`)}</option>
            ))}
          </Select>
        </Field>

        <Field label={t('auth.password')}
               hint="Bo'sh qoldirsangiz tizim o'zi yaratadi">
          <Input value={password} onChange={(e) => setPassword(e.target.value)}
                 minLength={8} placeholder="kamida 8 belgi" />
        </Field>

        {branches.length > 1 && (
          <div>
            <label className="mb-1 flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={allBranches}
                onChange={(e) => setAllBranches(e.target.checked)}
                className="h-4 w-4"
              />
              {t('users.allBranches')}
            </label>

            {!allBranches && (
              <div className="mt-2 space-y-1 rounded-md border p-2">
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={picked.includes(b.id)}
                      onChange={() => toggleBranch(b.id)}
                      className="h-4 w-4"
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------
//  Parolni tiklash (TZ 4.13.3)
//
//  Telefon bilan kiradiganlar uchun bu YAGONA yo'l: ularning sintetik
//  pochtasiga xat bormaydi, shuning uchun parolni administrator
//  tiklaydi va xodimga qo'lda yetkazadi.
// ---------------------------------------------------------------------

function ResetPasswordModal({
  target, onClose, onSubmit, busy, error,
}: {
  target: { id: string; name: string } | null;
  onClose: () => void;
  onSubmit: (password: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [password, setPassword] = useState('');

  return (
    <Modal
      open={!!target}
      title={t('users.resetTitle')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary" form="reset-pwd" type="submit"
            disabled={busy || (password.length > 0 && password.length < 8)}
          >
            {busy ? t('common.saving') : t('common.confirm')}
          </Button>
        </>
      }
    >
      <form
        id="reset-pwd"
        onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(password); }}
        className="space-y-3"
      >
        <p className="text-sm font-medium">{target?.name}</p>

        <Field
          label={t('users.customPassword')}
          hint={t('users.customPasswordHint')}
        >
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            placeholder="kamida 8 belgi"
            autoFocus
          />
        </Field>

        <Notice tone="warn">{t('users.resetHint')}</Notice>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------
//  FOYDALANUVCHINI TAHRIRLASH
//
//  Bu yerda ism, rol va filiallar o'zgaradi. Login va parol emas:
//  ular Auth tizimida saqlanadi va faqat server funksiyasi orqali
//  o'zgartiriladi ("Parolni tiklash" tugmasi).
// ---------------------------------------------------------------------

function EditUserModal({
  user, branches, onClose, onSubmit, busy, error,
}: {
  // deno-lint-ignore no-explicit-any
  user: any;
  branches: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSubmit: (f: {
    full_name: string; role: Role;
    all_branches: boolean; branch_ids: string[];
  }) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();

  const [fullName, setFullName] = useState<string>(user.full_name ?? '');
  const [role, setRole] = useState<Role>(user.role);
  const [allBranches, setAllBranches] = useState<boolean>(!!user.all_branches);
  const [branchIds, setBranchIds] = useState<string[]>(
    // deno-lint-ignore no-explicit-any
    ((user.user_branches ?? []) as any[]).map((b) => b.branch_id),
  );

  function toggleBranch(id: string) {
    setBranchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const valid = fullName.trim().length > 1
    && (allBranches || branchIds.length > 0);

  return (
    <Modal
      open
      title={`${t('users.edit')} — ${user.full_name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="edit-user" type="submit"
                  disabled={busy || !valid}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="edit-user"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit({
            full_name: fullName,
            role,
            all_branches: allBranches,
            branch_ids: allBranches ? [] : branchIds,
          });
        }}
        className="space-y-3"
      >
        <Field label={t('common.fullName')} required>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)}
                 autoFocus required />
        </Field>

        <Field label={t('users.login')} hint={t('users.loginLocked')}>
          <Input value={user.email ?? user.phone ?? ''} disabled />
        </Field>

        <Field label={t('users.role')} required hint={t(`role.${role}.hint`)}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{t(`role.${r}`)}</option>
            ))}
          </Select>
        </Field>

        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={allBranches}
            onChange={(e) => setAllBranches(e.target.checked)}
            className="h-4 w-4"
          />
          {t('users.allBranches')}
        </label>

        {!allBranches && (
          <Field label={t('users.branches')} required>
            <div className="space-y-1">
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={branchIds.includes(b.id)}
                    onChange={() => toggleBranch(b.id)}
                    className="h-4 w-4"
                  />
                  {b.name}
                </label>
              ))}
            </div>
          </Field>
        )}

        <Notice tone="neutral">{t('users.editHint')}</Notice>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}
