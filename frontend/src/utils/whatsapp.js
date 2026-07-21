import { money } from '../pages/pageUtils.jsx';

export function normalizeWhatsappPhone(value) {
  let digits = String(value || '').replace(/[^\d]/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length < 10 || digits.length > 15) {
    throw new Error('Номер телефона невозможно использовать для WhatsApp.');
  }
  return digits;
}

export function certificateWhatsappMessage(certificate, publicUrl) {
  return [
    `Здравствуйте, ${certificate.recipient_name || 'получатель'}!`,
    '',
    `Для вас оформлен подарочный сертификат «${certificate.template_title || certificate.title || 'Сертификат'}» на сумму ${money(certificate.face_value)}.`,
    '',
    `Код сертификата: ${certificate.code}`,
    `Действителен до: ${certificate.valid_until}`,
    '',
    'Открыть сертификат:',
    publicUrl,
  ].join('\n');
}

export function certificateWhatsappUrl(certificate, publicUrl) {
  const phone = normalizeWhatsappPhone(certificate.recipient_phone || certificate.sent_to_phone);
  const text = encodeURIComponent(certificateWhatsappMessage(certificate, publicUrl));
  return `https://wa.me/${phone}?text=${text}`;
}
