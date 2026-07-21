import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import api from '../api/axios.js';
import CertificateCard from '../components/certificates/CertificateCard.jsx';
import { money } from './pageUtils.jsx';

export default function PublicCertificatePage() {
  const { token } = useParams();
  const [certificate, setCertificate] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`public/certificates/${token}/`)
      .then(({ data }) => setCertificate(data))
      .catch(() => setError('Сертификат не найден или ссылка недействительна.'));
  }, [token]);

  const inactive = certificate && !['active', 'partially_used'].includes(certificate.status);

  return (
    <main className="min-h-screen bg-app px-4 py-8">
      <div className="mx-auto grid max-w-3xl gap-5">
        <div className="text-center">
          <p className="text-sm font-black uppercase tracking-[0.24em] text-brand">EZCRM</p>
          <h1 className="mt-2 text-3xl font-black text-slate-900">Подарочный сертификат</h1>
        </div>
        {error ? (
          <div className="rounded-[24px] border border-red-100 bg-white p-8 text-center text-red-700 shadow-card">
            <AlertTriangle className="mx-auto" size={42} />
            <p className="mt-3 font-bold">{error}</p>
          </div>
        ) : certificate ? (
          <>
            <CertificateCard certificate={certificate} />
            {inactive ? (
              <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                Сертификат имеет статус “{certificate.status_display || certificate.status}” и может быть недоступен для использования.
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
                <CheckCircle2 size={20} />
                Сертификат активен. Доступный остаток: {money(certificate.remaining_amount)}.
              </div>
            )}
            <section className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-card">
              <h2 className="text-lg font-black text-slate-900">Условия</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{certificate.terms || 'Используйте код сертификата при оплате услуг центра.'}</p>
            </section>
          </>
        ) : (
          <div className="rounded-[24px] bg-white p-8 text-center font-semibold text-slate-500 shadow-card">Загрузка...</div>
        )}
      </div>
    </main>
  );
}
