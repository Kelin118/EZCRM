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
  const serialCode = certificate.serial_code || certificate.code;
  const greeting = certificate.recipient_name ? `Здравствуйте, ${certificate.recipient_name}!` : 'Здравствуйте!';
  return [
    greeting,
    '',
    `Для вас оформлен подарочный сертификат № ${serialCode}`,
    `Номинал: ${money(certificate.face_value)}`,
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
