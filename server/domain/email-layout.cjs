'use strict';

const defaultSite = (process.env.LTCH_SITE_URL || process.env.ALLOWED_ORIGIN || 'https://ltch.example.com').replace(/\/+$/, '');
const defaultSupportEmail = (process.env.LTCH_SUPPORT_EMAIL || process.env.ADMIN_EMAIL || 'admin@example.com').trim();
const palette = {
  navy: '#082c60',
  primary: '#013f93',
  ink: '#0f2342',
  body: '#1e3350',
  muted: '#475d76',
  subtle: '#5a7089',
  link: '#013f93',
  canvas: '#eef3f9',
  paper: '#ffffff',
  surface: '#f8fafd',
  footerBg: '#f5f8fc',
  rule: '#dde7f3',
  accent: '#ffbe00'
};

const badgeBorders = {
  '#eaf1fc': '#c7dbf7',
  '#e9f1ff': '#c7dbf7',
  '#dcfce7': '#bbf7d0',
  '#eaf8ee': '#bbf7d0',
  '#e0f2fe': '#bae6fd',
  '#fef3c7': '#fde68a',
  '#fff3d9': '#fde68a',
  '#fee2e2': '#fecaca',
  '#fcebed': '#fecaca',
  '#ede9fe': '#ddd6fe'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderHtmlLayout({
  preheader, badgeText, badgeBg = '#eaf1fc', badgeColor = palette.primary, title,
  greetingHtml, leadHtml, summary, infoTitle, infoRows = [], calloutHtml,
  bulletsTitle, bullets = [], ctaLabel, ctaUrl, footerNote,
  siteUrl, supportEmail: customSupportEmail
}) {
  const site = String(siteUrl || defaultSite).replace(/\/+$/, '');
  const supportEmail = String(customSupportEmail || defaultSupportEmail).trim();
  const fontStack = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
  const monoStack = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,'Courier New',monospace";
  const wrap = 'overflow-wrap:anywhere;word-break:break-word;';
  const paragraph = `margin:0 0 13px;font-size:16px;line-height:1.6;color:${palette.body};`;
  const sectionHeading = `margin:0 0 10px;font-size:14px;font-weight:700;line-height:1.4;color:${palette.navy};`;
  const table = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';
  const pillBorder = badgeBorders[String(badgeBg).toLowerCase()] || palette.rule;

  const badge = badgeText
    ? `<div style="margin:0 0 12px;"><span style="display:inline-block;padding:4px 12px;background:${badgeBg};color:${badgeColor};border:1px solid ${pillBorder};border-radius:999px;font-size:12px;font-weight:700;line-height:1.4;">${escapeHtml(badgeText)}</span></div>`
    : '';

  const details = infoRows.map(({label, value}, index) => {
    const border = index ? `border-top:1px solid ${palette.rule};` : '';
    return `<tr class="em-kv-row"><td class="em-kv-label" width="38%" valign="top" style="${border}padding:11px 12px 11px 0;font-size:14px;line-height:1.45;color:${palette.muted};font-weight:500;">${escapeHtml(label)}</td><td class="em-kv-val" width="62%" valign="top" style="${border}padding:11px 0;font-size:14px;font-weight:700;line-height:1.45;color:${palette.ink};${wrap}">${escapeHtml(value)}</td></tr>`;
  }).join('');

  const summaryPanel = summary ? (summary.code
    ? `<table ${table} style="margin:22px 0;"><tr><td align="center" bgcolor="#f4f8fe" style="background:#f4f8fe;border:1px solid #c7dbf7;border-radius:10px;padding:22px 16px;">
      <div style="font-size:13px;font-weight:600;line-height:1.4;color:${palette.muted};">${escapeHtml(summary.label)}</div>
      <div class="em-otp" style="margin:10px 0 8px;font-size:32px;font-weight:700;line-height:1.2;color:${palette.primary};font-family:${monoStack};letter-spacing:0.2em;">${escapeHtml(summary.value)}</div>
      ${summary.detail ? `<div style="font-size:13px;line-height:1.45;color:${palette.muted};">${escapeHtml(summary.detail)}</div>` : ''}
    </td></tr></table>`
    : `<table ${table} style="margin:20px 0;"><tr><td bgcolor="${badgeBg}" style="background:${badgeBg};border:1px solid ${pillBorder};border-left:4px solid ${badgeColor};border-radius:8px;padding:16px 18px;color:${badgeColor};">
      <div style="font-size:13px;font-weight:600;line-height:1.4;">${escapeHtml(summary.label)}</div>
      <div class="em-summary-val" style="margin-top:4px;font-size:22px;font-weight:700;line-height:1.3;">${escapeHtml(summary.value)}</div>
      ${summary.detail ? `<div style="margin-top:4px;font-size:13px;line-height:1.45;">${escapeHtml(summary.detail)}</div>` : ''}
    </td></tr></table>`
  ) : '';

  const detailsPanel = details ? `<table ${table} bgcolor="${palette.surface}" style="margin:20px 0;background:${palette.surface};border:1px solid ${palette.rule};border-radius:10px;"><tr><td style="padding:15px 18px 6px;">
    ${infoTitle ? `<h2 style="${sectionHeading}">${escapeHtml(infoTitle)}</h2>` : ''}
    <table class="em-kv-table" ${table} style="table-layout:fixed;border-collapse:collapse;">${details}</table>
  </td></tr></table>` : '';

  const guide = bullets.length ? `<table ${table} bgcolor="${palette.surface}" style="margin:20px 0;background:${palette.surface};border:1px solid ${palette.rule};border-radius:10px;"><tr><td style="padding:15px 18px;">
    ${bulletsTitle ? `<h2 style="${sectionHeading}">${escapeHtml(bulletsTitle)}</h2>` : ''}
    <table ${table}>${bullets.map((item, idx) => `<tr>
      <td width="16" valign="top" style="padding:${idx ? '6px' : '2px'} 6px 0 0;font-size:14px;line-height:1.45;color:${palette.primary};font-weight:700;">&#8226;</td>
      <td valign="top" style="padding:${idx ? '4px' : '0'} 0;font-size:14px;line-height:1.55;color:${palette.body};${wrap}">${escapeHtml(item)}</td>
    </tr>`).join('')}</table>
  </td></tr></table>` : '';

  const action = ctaLabel && ctaUrl ? `<table ${table} style="margin:24px 0 6px;"><tr><td align="left">
    <table class="em-btn-wrap" role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="em-btn-cell" align="center" bgcolor="${palette.primary}" style="background:${palette.primary};border-radius:8px;">
        <a class="em-btn" href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:13px 26px;font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(ctaLabel)}</a>
      </td>
    </tr></table>
    <div style="margin-top:10px;font-size:12px;line-height:1.5;color:${palette.muted};${wrap}">Nếu nút không mở được, truy cập trực tiếp: <a href="${escapeHtml(ctaUrl)}" style="color:${palette.link};text-decoration:underline;${wrap}">${escapeHtml(ctaUrl)}</a></div>
  </td></tr></table>` : '';

  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="only light">
<meta name="supported-color-schemes" content="light">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<title>${escapeHtml(title)}</title><style>
:root,html,body{color-scheme:light;color-scheme:only light;supported-color-schemes:light}
body,table,td,p,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse}
img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}
@media only screen and (max-width:640px){
  .em-outer{padding:20px 14px!important}
  .em-hdr{padding:16px 24px!important}
  .em-body{padding:26px 24px 24px!important}
  .em-ftr{padding:16px 24px!important}
}
@media only screen and (max-width:480px){
  .em-outer{padding:10px 8px!important}
  .em-card{border-radius:10px!important}
  .em-hdr{padding:14px 16px!important;border-radius:9px 9px 0 0!important}
  .em-hdr-link{display:none!important}
  .em-body{padding:22px 16px 20px!important}
  .em-ftr{padding:15px 16px!important;border-radius:0 0 9px 9px!important}
  .em-h1{font-size:21px!important;line-height:1.3!important}
  .em-lead{font-size:15px!important}
  .em-otp{font-size:26px!important;letter-spacing:0.14em!important}
  .em-summary-val{font-size:20px!important}
  .em-kv-table,.em-kv-table tbody,.em-kv-row{display:block!important;width:100%!important}
  .em-kv-label{display:block!important;width:100%!important;padding:10px 0 2px!important;font-size:12px!important}
  .em-kv-val{display:block!important;width:100%!important;border-top:0!important;padding:0 0 10px!important;font-size:15px!important}
  .em-btn-wrap,.em-btn-wrap tbody,.em-btn-wrap tr,.em-btn-cell{display:block!important;width:100%!important}
  .em-btn{display:block!important;width:100%!important;box-sizing:border-box!important;padding:14px 16px!important;text-align:center!important}
}
</style></head>
<body style="margin:0;padding:0;background:${palette.canvas};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;">${escapeHtml(preheader || title)}</div>
<table ${table} bgcolor="${palette.canvas}" style="background:${palette.canvas};font-family:${fontStack};color:${palette.ink};">
<tr><td class="em-outer" align="center" style="padding:32px 20px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table class="em-card" ${table} bgcolor="${palette.paper}" style="max-width:600px;width:100%;background:${palette.paper};border:1px solid #d5e1ef;border-radius:12px;overflow:hidden;box-shadow:0 4px 18px rgba(8,44,96,0.06);">
<tr><td bgcolor="${palette.navy}" class="em-hdr" style="padding:18px 32px;border-top:4px solid ${palette.accent};border-radius:11px 11px 0 0;">
  <table ${table}><tr>
    <td valign="middle">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" style="padding-right:12px;"><img src="${site}/logo.png?v=20261119_brand_v2" alt="Logo Lớp Toán cô Hạnh" width="38" height="38" style="display:block;width:38px;height:38px;border-radius:8px;"></td>
        <td valign="middle">
          <div style="color:#ffffff;font-weight:700;font-size:17px;line-height:1.25;">Lớp Toán cô Hạnh</div>
          <div style="color:#c7dbf7;font-size:12px;line-height:1.35;margin-top:2px;">Hiểu bản chất &ndash; Vững tư duy</div>
        </td>
      </tr></table>
    </td>
    <td class="em-hdr-link" align="right" valign="middle" style="padding-left:12px;">
      <a href="${site}/overview" style="display:inline-block;padding:6px 12px;border:1px solid rgba(255,255,255,0.28);border-radius:6px;color:#ffffff;font-size:12px;font-weight:600;line-height:1.2;text-decoration:none;white-space:nowrap;">Cổng học tập</a>
    </td>
  </tr></table>
</td></tr>
<tr><td class="em-body" style="padding:32px 36px 28px;">
  ${badge}
  <h1 class="em-h1" style="margin:0 0 16px;color:${palette.navy};font-size:24px;line-height:1.28;font-weight:700;${wrap}">${escapeHtml(title)}</h1>
  ${greetingHtml ? `<p class="em-lead" style="${paragraph}">${greetingHtml}</p>` : ''}
  ${leadHtml ? `<p class="em-lead" style="${paragraph}">${leadHtml}</p>` : ''}
  ${summaryPanel}
  ${detailsPanel}
  ${calloutHtml || ''}
  ${guide}
  ${action}
  ${footerNote ? `<p style="margin:20px 0 0;padding-top:14px;border-top:1px solid ${palette.rule};font-size:14px;line-height:1.6;color:${palette.muted};">${footerNote}</p>` : ''}
</td></tr>
<tr><td class="em-ftr" bgcolor="${palette.footerBg}" style="padding:18px 36px;border-top:1px solid ${palette.rule};border-radius:0 0 11px 11px;color:${palette.muted};font-size:13px;line-height:1.6;${wrap}">
  <div style="font-weight:700;color:${palette.navy};">Ban Quản trị Lớp Toán cô Hạnh</div>
  <div style="margin-top:2px;font-size:12px;color:${palette.subtle};">Không gian học tập &amp; luyện thi môn Toán THCS &ndash; THPT</div>
  <div style="margin-top:8px;">
    <a href="${site}/overview" style="color:${palette.link};font-weight:600;text-decoration:none;">Cổng học tập</a>
    &nbsp;&middot;&nbsp;
    <a href="mailto:${supportEmail}" style="color:${palette.link};font-weight:600;text-decoration:none;">Liên hệ hỗ trợ</a>
  </div>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

module.exports = { escapeHtml, renderHtmlLayout };
