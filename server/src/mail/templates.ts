// E-Mail-Texte – schlicht, auf Deutsch, jeweils als Text und als einfaches HTML.
import { config } from '../config';
import type { Mail } from './mail.service';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function layout(to: string, subject: string, paragraphs: string[], button?: { label: string; url: string }, footer?: string): Mail {
  const text = [...paragraphs, ...(button ? [`${button.label}: ${button.url}`] : []), ...(footer ? ['', footer] : [])].join('\n\n');
  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2933">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="font-size:20px;font-weight:700;color:#1c7ed6;margin-bottom:16px">MeterBook</div>
<div style="background:#fff;border-radius:8px;padding:24px;line-height:1.5;font-size:15px">
${paragraphs.map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n')}
${button ? `<p style="margin:20px 0 6px"><a href="${esc(button.url)}" style="display:inline-block;background:#1c7ed6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${esc(button.label)}</a></p>
<p style="margin:0;font-size:12px;color:#6b7280;word-break:break-all">${esc(button.url)}</p>` : ''}
</div>
${footer ? `<p style="font-size:12px;color:#6b7280;margin:14px 4px">${esc(footer)}</p>` : ''}
</div></body></html>`;
  return { to, subject, text, html };
}

export function inviteMail(to: string, name: string, invitedBy: string, token: string): Mail {
  return layout(
    to,
    'Willkommen bei MeterBook',
    [
      `Hallo ${name},`,
      `${invitedBy} hat dir ein Konto bei MeterBook eingerichtet – damit hältst du deine Zählerstände für Strom und Wasser fest und siehst deinen Verbrauch auf einen Blick.`,
      `Lege jetzt dein Passwort fest. Der Link gilt 7 Tage. Angemeldet wirst du mit dieser E-Mail-Adresse: ${to}`,
    ],
    { label: 'Passwort festlegen', url: `${config.publicUrl}/passwort-setzen?token=${token}` },
    'Du hast mit dieser Einladung nichts zu tun? Dann ignoriere die E-Mail einfach.',
  );
}

export function resetMail(to: string, name: string, token: string): Mail {
  return layout(
    to,
    'MeterBook: Passwort zurücksetzen',
    [`Hallo ${name},`, 'für dein MeterBook-Konto wurde ein neues Passwort angefordert. Über den folgenden Link legst du es fest; er gilt eine Stunde.'],
    { label: 'Neues Passwort festlegen', url: `${config.publicUrl}/passwort-setzen?token=${token}` },
    'Du hast nichts angefordert? Dann ignoriere die E-Mail – dein bisheriges Passwort bleibt gültig.',
  );
}

export function reminderMail(to: string, name: string, meters: string[], interval: 'WEEKLY' | 'MONTHLY'): Mail {
  const when = interval === 'WEEKLY' ? 'wöchentliche' : 'monatliche';
  return layout(
    to,
    meters.length === 1 ? `Zeit zum Ablesen: ${meters[0]}` : `Zeit zum Ablesen: ${meters.length} Zähler`,
    [`Hallo ${name},`, `das ist deine ${when} Erinnerung. Diese Zähler warten auf eine Ablesung:`, meters.map((m) => `• ${m}`).join('\n')],
    { label: 'Jetzt ablesen', url: `${config.publicUrl}/ablesen` },
    'Die Erinnerung kannst du in MeterBook unter „Einstellungen“ ändern, überspringen oder abschalten.',
  );
}
