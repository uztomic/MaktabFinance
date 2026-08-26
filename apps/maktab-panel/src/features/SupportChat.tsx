// =====================================================================
//  Ijrochi bilan yozishma (maktab tomoni).
//
//  Bir xil jadval, bir xil xabarlar — super admin ham aynan shu
//  yozishmani ko'radi. Hech narsa o'chirilmaydi, ya'ni "shunday
//  degan edingiz" degan bahs hujjat bilan hal bo'ladi.
//
//  TIZIM XABARLARI ajratib ko'rsatiladi: "chek tasdiqlandi",
//  "maktab cheklandi" — bularni odam yozmagan, ular avtomatik.
//
//  MUHIM: bu sahifa BLOKLANGAN maktabda ham ochiladi (migratsiya
//  41 dagi ro'yxat). To'lov muammosini muhokama qiladigan joy
//  yopilib qolmasligi kerak.
// =====================================================================

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { dateTime } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, Field, Input, Loading, Modal,
  PageHeader, Select, Table, Td, Tr,
} from '@/ui';
import { useToast } from '@/ui/Feedback';

export default function SupportChat() {
  const t = useT();
  const { lang } = useI18n();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [composing, setComposing] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const threads = useQuery({
    queryKey: ['my-threads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_threads')
        .select('*')
        .order('last_message_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });

  const messages = useQuery({
    queryKey: ['my-messages', active],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_messages')
        .select('id, from_platform, is_system, body, created_at')
        .eq('thread_id', active!)
        .order('created_at');
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('mark_support_read', { p_thread_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-threads'] }),
  });

  const post = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('post_support_message', {
        p_thread_id: active!,
        p_body: draft.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['my-messages', active] });
      qc.invalidateQueries({ queryKey: ['my-threads'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  useEffect(() => {
    if (active) markRead.mutate(active);
    // Faqat `active` o'zgarganda ishlashi kerak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.data]);

  const list = threads.data ?? [];
  const current = list.find((x) => x.id === active) ?? null;

  function onSend(e: FormEvent) {
    e.preventDefault();
    if (draft.trim()) post.mutate();
  }

  return (
    <>
      <PageHeader
        title={t('help.title')}
        subtitle={t('help.subtitle')}
        actions={
          <Button variant="primary" onClick={() => setComposing(true)}>
            {t('help.new')}
          </Button>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[20rem_1fr]">
        <Card padded={false} className="max-h-[70vh] overflow-y-auto">
          {threads.isLoading ? <Loading /> : list.length === 0 ? (
            <EmptyState title={t('help.empty')} hint={t('help.emptyHint')} />
          ) : (
            <Table>
              <tbody>
                {list.map((th) => {
                  const unread = !th.school_read_at
                    || new Date(th.last_message_at as string)
                       > new Date(th.school_read_at as string);
                  return (
                    <Tr
                      key={th.id as string}
                      onClick={() => setActive(th.id as string)}
                      className={active === th.id ? 'bg-[var(--sel-bg)]' : ''}
                    >
                      <Td>
                        <div className="flex items-center gap-1.5">
                          {unread && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--danger)]" />
                          )}
                          <span className={`truncate text-[13px] ${unread ? 'font-semibold' : ''}`}>
                            {th.subject as string}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5
                          text-[11px] text-[var(--text-muted)]">
                          <span className="num">
                            {dateTime(th.last_message_at as string, lang)}
                          </span>
                          {th.status === 'closed' && <Badge>{t('help.closed')}</Badge>}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card padded={false} title={current ? (current.subject as string) : t('help.pick')}>
          {!current ? (
            <EmptyState title={t('help.pick')} hint={t('help.pickHint')} />
          ) : (
            <div className="flex max-h-[60vh] flex-col">
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {messages.isLoading ? <Loading /> : (messages.data ?? []).map((m) => {
                  // Maktab tomonida "meniki" — platformadan KELMAGANI.
                  const mine = !(m.from_platform as boolean);
                  const system = m.is_system as boolean;
                  return (
                    <div key={String(m.id)}
                         className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-[13px] ${
                        system
                          ? 'w-full bg-[var(--bg-inset)] text-center text-[var(--text-muted)]'
                          : mine
                            ? 'bg-brand-900 text-white'
                            : 'border bg-[var(--bg)]'
                      }`}>
                        <p className="whitespace-pre-wrap">{m.body as string}</p>
                        <p className={`mt-1 text-[11px] ${
                          mine && !system ? 'text-brand-300' : 'text-[var(--text-faint)]'
                        }`}>
                          {system
                            ? `${t('help.system')} · `
                            : mine ? '' : `${t('help.support')} · `}
                          {dateTime(m.created_at as string, lang)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottom} />
              </div>

              <form onSubmit={onSend} className="flex gap-2 border-t p-3">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('help.placeholder')}
                  className="flex-1"
                />
                <Button type="submit" variant="primary"
                        disabled={!draft.trim() || post.isPending}>
                  {t('help.send')}
                </Button>
              </form>
            </div>
          )}
        </Card>
      </div>

      {composing && (
        <NewThreadModal
          schoolName={profile?.school_name ?? ''}
          onClose={() => setComposing(false)}
          onDone={(id) => {
            qc.invalidateQueries({ queryKey: ['my-threads'] });
            setActive(id);
          }}
        />
      )}
    </>
  );
}

function NewThreadModal({ schoolName, onClose, onDone }: {
  schoolName: string; onClose: () => void; onDone: (id: string) => void;
}) {
  const t = useT();
  const toast = useToast();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('open_support_thread', {
        p_subject: subject.trim(),
        p_body: body.trim(),
        p_priority: priority,
      });
      if (error) throw error;
      return data as { thread_id: string };
    },
    onSuccess: (d) => { onDone(d.thread_id); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const valid = subject.trim().length >= 3 && body.trim().length >= 1;

  return (
    <Modal open title={t('help.new')} onClose={onClose} footer={
      <>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!valid || create.isPending}
                onClick={() => create.mutate()}>
          {t('help.send')}
        </Button>
      </>
    }>
      <div className="space-y-3">
        <p className="text-[13px] text-[var(--text-muted)]">
          {t('help.newHint', { school: schoolName })}
        </p>
        <Field label={t('help.subject')} required>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </Field>
        <Field label={t('help.priority')}>
          <Select value={priority}
                  onChange={(e) => setPriority(e.target.value as 'low' | 'normal' | 'high')}>
            <option value="low">{t('help.priorityLow')}</option>
            <option value="normal">{t('help.priorityNormal')}</option>
            <option value="high">{t('help.priorityHigh')}</option>
          </Select>
        </Field>
        <Field label={t('help.message')} required>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="w-full rounded-md border bg-[var(--bg)] px-2.5 py-2 text-sm
              text-[var(--text)] focus:border-brand-500"
            required
          />
        </Field>
      </div>
    </Modal>
  );
}
