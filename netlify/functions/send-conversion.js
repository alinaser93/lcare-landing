const crypto = require('crypto');

const PIXEL_ID = '1263336169287572';

function hash(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

function normalizeIraqiPhone(raw) {
  if (!raw) return undefined;
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = '964' + digits.slice(1);
  else if (!digits.startsWith('964')) digits = '964' + digits;
  return digits;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing FB_ACCESS_TOKEN' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { name, phone, condition, condition_label, package: pkg, package_value, event_id, event_source_url, fbp, fbc } = body;

    if (!name || !phone) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    const nameParts = String(name).trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;
    const normalizedPhone = normalizeIraqiPhone(phone);

    const clientIp = event.headers['x-nf-client-connection-ip'] ||
      (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined;
    const userAgent = event.headers['user-agent'] || undefined;

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

    Object.keys(user_data).forEach(k => user_data[k] === undefined && delete user_data[k]);

    const payload = {
      data: [
        {
          event_name: 'Lead',
          event_time: Math.floor(Date.now() / 1000),
          event_id: event_id,
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
      ],
      
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
      body: JSON.stringify({ success: false, error: result.error?.message || 'Failed' })
    };

  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server error' }) };
  }
};
