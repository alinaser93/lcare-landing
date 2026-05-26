// netlify/functions/send-conversion.js
// 🔐 Conversions API الآمن لـ Lcare IQ — النسخة المحسّنة (دقة عالية)
// التوكن يُقرأ من Netlify Environment Variables ولا يظهر أبداً في الكود

const crypto = require('crypto');

const PIXEL_ID = '1263336169287572';

// تشفير SHA-256 (فيسبوك يتطلب تشفير كل البيانات الحساسة)
function hash(value) {
  if (!value) return undefined;
  return crypto
    .createHash('sha256')
    .update(String(value).trim().toLowerCase())
    .digest('hex');
}

// تنسيق رقم الهاتف العراقي لصيغة دولية يفهمها فيسبوك (964XXXXXXXXXX)
function normalizeIraqiPhone(raw) {
  if (!raw) return undefined;
  // إزالة كل شيء عدا الأرقام
  let digits = String(raw).replace(/\D/g, '');
  // إزالة 00 الدولية إن وُجدت
  if (digits.startsWith('00')) digits = digits.slice(2);
  // إذا بدأ بصفر محلي (07xx) نحوله لـ 9647xx
  if (digits.startsWith('0')) digits = '964' + digits.slice(1);
  // إذا لم يبدأ بكود الدولة نضيفه
  else if (!digits.startsWith('964')) digits = '964' + digits;
  return digits;
}

exports.handler = async (event) => {
  // قبول POST فقط
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // التأكد من وجود التوكن
  const ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing FB_ACCESS_TOKEN' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      name, phone, condition, condition_label,
      package: pkg, package_value, event_id,
      event_source_url, fbp, fbc
    } = body;

    if (!name || !phone) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // فصل الاسم لأول/أخير لتحسين المطابقة
    const nameParts = String(name).trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

    const normalizedPhone = normalizeIraqiPhone(phone);

    // عنوان IP و User-Agent يحسّنان دقة المطابقة بشكل كبير
    const clientIp =
      event.headers['x-nf-client-connection-ip'] ||
      (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      undefined;
    const userAgent = event.headers['user-agent'] || undefined;

    // بناء user_data (كل البيانات الشخصية مشفّرة، عدا fbp/fbc/ip/ua)
    const user_data = {
      ph: normalizedPhone ? [hash(normalizedPhone)] : undefined,
      fn: firstName ? [hash(firstName)] : undefined,
      ln: lastName ? [hash(lastName)] : undefined,
      country: [hash('iq')],
      client_ip_address: clientIp,
      client_user_agent: userAgent,
      fbp: fbp || undefined,
      fbc: fbc || undefined
    };

    // إزالة الحقول الفارغة
    Object.keys(user_data).forEach(k => user_data[k] === undefined && delete user_data[k]);

    const payload = {
      data: [
        {
          event_name: 'Lead',
          event_time: Math.floor(Date.now() / 1000),
          event_id: event_id,                 // ← للـ Deduplication مع البكسل
          action_source: 'website',
          event_source_url: event_source_url || 'https://lcareiq.com',
          user_data: user_data,
          custom_data: {
            content_name: 'subscription_' + (condition_label || condition || ''),
            content_category: condition_label || condition || '',
            package: pkg || '',
            value: package_value || 0,
            currency: 'IQD'
          }
        }
      ]
      // ملاحظة: لإضافة test_events أثناء الاختبار أضف هنا: test_event_code: 'TESTXXXXX'
    };

    const url = `https://graph.facebook.com/v18.0/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (response.ok) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, events_received: result.events_received, fbtrace_id: result.fbtrace_id })
      };
    }
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: result.error?.message || 'Failed', details: result })
    };

  } catch (error) {
    console.error('❌ Error:', error);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server error' }) };
  }
};
