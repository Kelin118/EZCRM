import { Gift } from 'lucide-react';

import { money } from '../../pages/pageUtils.jsx';

export default function CertificateCard({ certificate, template, compact = false, cardRef }) {
  const design = certificate?.design || certificate?.template_snapshot || template || {};
  const title = certificate?.title || certificate?.template_title || design.title || template?.title || 'Подарочный сертификат';
  const subtitle = certificate?.subtitle || design.subtitle || template?.subtitle || 'Для оплаты услуг центра';
  const recipient = certificate?.recipient_name || 'Получатель';
  const faceValue = certificate?.face_value || template?.fixed_amount || template?.min_amount || 0;
  const remaining = certificate?.remaining_amount;
  const badge = design.badge_text || template?.badge_text || 'Подарочный сертификат';
  const style = {
    background: design.background_image_url
      ? `linear-gradient(135deg, ${design.background_from || '#fff7ed'}dd, ${design.background_to || '#fef3c7'}ee), url(${design.background_image_url}) center/cover`
      : `linear-gradient(135deg, ${design.background_from || '#fff7ed'}, ${design.background_to || '#fef3c7'})`,
    color: design.text_color || '#1f2937',
  };

  return (
    <article ref={cardRef} style={style} className={`relative overflow-hidden rounded-[28px] border border-white/70 p-6 shadow-card ${compact ? '' : 'min-h-[320px]'}`}>
      <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/25" />
      <div className="absolute -bottom-16 left-8 h-44 w-44 rounded-full bg-white/20" />
      <div className="relative z-10 flex h-full flex-col justify-between gap-8">
        <div className="flex items-start justify-between gap-4">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/65 px-4 py-2 text-xs font-black uppercase tracking-wide">
            <Gift size={16} style={{ color: design.accent_color || '#f59e0b' }} />
            {badge}
          </div>
          {certificate?.code && <span className="rounded-full bg-black/10 px-3 py-1 text-xs font-bold">{certificate.code}</span>}
        </div>
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.22em] opacity-70">{subtitle}</p>
          <h3 className="mt-3 text-3xl font-black leading-tight md:text-4xl">{title}</h3>
          <p className="mt-4 text-lg font-semibold">Для: {recipient}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-3xl bg-white/65 p-4">
            <p className="text-xs font-bold uppercase opacity-60">Номинал</p>
            <p className="mt-1 text-2xl font-black">{money(faceValue)}</p>
          </div>
          <div className="rounded-3xl bg-white/65 p-4">
            <p className="text-xs font-bold uppercase opacity-60">Действителен до</p>
            <p className="mt-1 text-xl font-black">{certificate?.valid_until || 'после оформления'}</p>
          </div>
          {remaining !== undefined && (
            <div className="rounded-3xl bg-white/65 p-4 sm:col-span-2">
              <p className="text-xs font-bold uppercase opacity-60">Доступный остаток</p>
              <p className="mt-1 text-xl font-black">{money(remaining)}</p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
