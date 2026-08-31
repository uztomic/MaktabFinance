// =====================================================================
//  Marshrutlar.
//
//  Yo'l nomlari o'zbekcha — foydalanuvchi manzil satrida nima
//  ochilganini tushunsin.
//
//  Har bir sahifa o'z ichida huquqni ham tekshiradi (menyu yashirilgan
//  bo'lsa ham manzilni qo'lda yozib kirish mumkin). Haqiqiy himoya
//  esa bazadagi RLS da.
// =====================================================================

import { Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import LoginPage from '@/auth/LoginPage';
import ResetPasswordPage from '@/auth/ResetPasswordPage';
import AppShell from '@/layout/AppShell';
import SuspendedShell from '@/layout/SuspendedShell';
import { Button, Loading, Notice } from '@/ui';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { lazyPage } from '@/lib/lazyPage';

const Dashboard   = lazyPage(() => import('@/features/Dashboard'));
const Students    = lazyPage(() => import('@/features/Students'));
const StudentCard = lazyPage(() => import('@/features/StudentCard'));
const Classes     = lazyPage(() => import('@/features/Classes'));
const ClassCard   = lazyPage(() => import('@/features/ClassCard'));
const Services    = lazyPage(() => import('@/features/Services'));
const Invoices    = lazyPage(() => import('@/features/Invoices'));
const Payments    = lazyPage(() => import('@/features/Payments'));
const Debts       = lazyPage(() => import('@/features/Debts'));
const Expenses    = lazyPage(() => import('@/features/Expenses'));
const Reports     = lazyPage(() => import('@/features/Reports'));
const Leads       = lazyPage(() => import('@/features/Leads'));
const Absences    = lazyPage(() => import('@/features/Absences'));
const Teachers    = lazyPage(() => import('@/features/Teachers'));
const TeacherCard = lazyPage(() => import('@/features/TeacherCard'));
const Messages    = lazyPage(() => import('@/features/Messages'));
const Payroll     = lazyPage(() => import('@/features/Payroll'));
const PayrollCard = lazyPage(() => import('@/features/PayrollCard'));
const Branches    = lazyPage(() => import('@/features/Branches'));
const Users       = lazyPage(() => import('@/features/Users'));
const Audit       = lazyPage(() => import('@/features/Audit'));
const Settings    = lazyPage(() => import('@/features/Settings'));
const MyAttendance = lazyPage(() => import('@/features/teacher/MyAttendance'));
const MyLoad      = lazyPage(() => import('@/features/teacher/MyLoad'));
const MyPayroll   = lazyPage(() => import('@/features/teacher/MyPayroll'));
const MyDashboard = lazyPage(() => import('@/features/teacher/MyDashboard'));
const SchoolAttendance = lazyPage(() => import('@/features/SchoolAttendance'));
const Subscription = lazyPage(() => import('@/features/Subscription'));
const SupportChat  = lazyPage(() => import('@/features/SupportChat'));

/**
 *  Arxivga olingan maktab.
 *
 *  Bu to'lov masalasi EMAS, shuning uchun to'lov ekrani ko'rsatilmaydi
 *  — u "qarzingizni to'lang" deb yolg'on aytardi. Arxiv — bu maktab
 *  ishlashdan to'xtaganini bildiradi va uni faqat platforma operatori
 *  qaytara oladi.
 *
 *  Ma'lumot O'CHIRILMAYDI: baza o'qishga ochiq, faqat yozish to'silgan
 *  (`app.school_is_writable()`).
 */
function ArchivedSchool() {
  const t = useT();
  const { profile, signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">{profile?.school_name}</h1>
        <div className="mt-3">
          <Notice tone="warn">{t('school.archived')}</Notice>
        </div>
        <p className="mt-3 text-[13px] text-[var(--text-muted)]">
          {t('school.archivedHint')}
        </p>
        <Button className="mt-4" onClick={signOut}>{t('auth.logout')}</Button>
      </div>
    </div>
  );
}

function NoProfile() {
  const t = useT();
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <Notice tone="danger">{t('auth.noProfile')}</Notice>
        <Button className="mt-4" onClick={signOut}>{t('auth.logout')}</Button>
      </div>
    </div>
  );
}

export default function App() {
  const { session, profile, loading, error } = useAuth();
  const t = useT();
  const location = useLocation();

  //  Xato chegarasi oddiy sinf komponenti — u `useT` ni chaqira
  //  olmaydi, shuning uchun matnlar shu yerda tayyorlanadi.
  const errorLabels = {
    title: t('err.crashTitle'),
    hint: t('err.crashHint'),
    retry: t('err.retry'),
    home: t('err.home'),
    details: t('err.details'),
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading />
      </div>
    );
  }

  // MUHIM: parol tiklash sahifasi profil tekshiruvidan OLDIN.
  // Tiklash havolasi vaqtinchalik sessiya ochadi — agar shu yerda
  // to'xtatmasak, foydalanuvchi to'g'ri panelga tushib ketadi va
  // yangi parolni qo'yolmay qoladi.
  if (globalThis.location?.pathname.endsWith('/parol-tiklash')) {
    return (
      <Routes>
        <Route path="/parol-tiklash" element={<ResetPasswordPage />} />
      </Routes>
    );
  }

  if (!session) return <LoginPage />;
  if (error === 'noProfile' || !profile) return <NoProfile />;

  // BLOKLANGAN MAKTAB — oddiy panel ko'rsatilmaydi.
  //
  // To'lov 45 kundan ortiq kechikkanda maktab `restricted` holatiga
  // o'tadi va TZ 2.4 bo'yicha tizimga KIRA OLMAYDI.
  //
  // NEGA SHU YERDA, RLS DA EMAS (TZ 2.4 "Kirish darajasi"): bazani
  // yopib qo'ysak direktor to'lov ekranini ham ko'ra olmaydi va
  // tizim boshi berk ko'chaga kiradi — mijoz to'lay olmaydi.
  // Shuning uchun baza o'qishga ochiq qoladi (yozish esa
  // `app.school_is_writable()` bilan to'silgan), kirishni esa
  // shu qator to'sadi.
  //
  // Ma'lumot O'CHIRILMAYDI — to'lov tasdiqlangach hammasi qaytadi.
  //  `restricted` — to'lov kechikkan, to'lov ekrani ko'rsatiladi.
  //  `suspended` va `archived` — maktab butunlay to'xtatilgan yoki
  //  arxivga olingan. Ilgari bu ikkalasi HISOBGA OLINMAGAN edi: odam
  //  odatdagi panelni ko'rardi, lekin har qanday saqlash jimgina rad
  //  etilardi (`app.school_is_writable()` faqat trial/active ga ruxsat
  //  beradi). "Tugmani bosaman, hech narsa bo'lmayapti" degan holat
  //  aynan shundan kelib chiqadi.
  if (profile.school_status === 'restricted'
      || profile.school_status === 'suspended') {
    return <SuspendedShell />;
  }

  //  Arxiv — boshqa hol: to'lov bilan bog'liq emas.
  if (profile.school_status === 'archived') return <ArchivedSchool />;

  return (
    //  Har bir sahifa alohida chegara ichida: bittasida xato chiqsa
    //  butun ilova emas, faqat o'sha sahifa to'xtaydi. Yo'l o'zgarganda
    //  chegara tozalanadi — odam boshqa bo'limga o'tib ishlay oladi.
    <ErrorBoundary resetKey={location.pathname} labels={errorLabels}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<AppShell />}>
            {/*  Bosh sahifa ROLGA qarab. O'qituvchi direktorning
                 panelini ko'rmasligi kerak: u yerda maktab bo'yicha
                 moliyaviy jamlanma va o'quvchilar soni turadi. */}
            <Route
              index
              element={profile.role === 'teacher'
                ? <MyDashboard />
                : <Dashboard />}
            />
            <Route path="oquvchilar" element={<Students />} />
            <Route path="oquvchilar/:id" element={<StudentCard />} />
            <Route path="sinflar" element={<Classes />} />
            <Route path="sinflar/:id" element={<ClassCard />} />
            <Route path="xizmatlar" element={<Services />} />
            <Route path="yoqlik" element={<Absences />} />
            <Route path="murojaatlar" element={<Leads />} />
            <Route path="hisoblanma" element={<Invoices />} />
            <Route path="tolovlar" element={<Payments />} />
            <Route path="qarzdorlik" element={<Debts />} />
            <Route path="xarajatlar" element={<Expenses />} />
            <Route path="hisobotlar" element={<Reports />} />
            <Route path="oqituvchilar" element={<Teachers />} />
            <Route path="oqituvchilar/:id" element={<TeacherCard />} />
            <Route path="xabarlar" element={<Messages />} />
            <Route path="oylik" element={<Payroll />} />
            <Route path="oylik/:id" element={<PayrollCard />} />
            <Route path="filiallar" element={<Branches />} />
            <Route path="foydalanuvchilar" element={<Users />} />
            <Route path="jurnal" element={<Audit />} />
            <Route path="sozlamalar" element={<Settings />} />
            <Route path="obuna" element={<Subscription />} />
            <Route path="yordam" element={<SupportChat />} />
            {/*  Manzil bitta, ekran rolga qarab: o'qituvchida faqat
                 o'z sinflari, qolganlarda butun maktab. */}
            <Route
              path="davomat"
              element={profile.role === 'teacher'
                ? <MyAttendance />
                : <SchoolAttendance />}
            />
            <Route path="yuklamam" element={<MyLoad />} />
            <Route path="oyligim" element={<MyPayroll />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
