// netlify/functions/send-conversion.js
// تطبيق Conversions API الآمن لـ Lcare

const crypto = require('crypto');

// دالة تشفير SHA-256 للبيانات الحساسة
function hashData(data) {
  if (!data) return null;
  return crypto
    .createHash('sha256')
    .update(data.toLowerCase().trim())
    .digest('hex');
}

exports.handler = async (event) => {
  // فقط POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // فك تشفير البيانات من الموقع
    const { name, phone, email, condition, package_value } = JSON.parse(event.body);

    // التحقق من البيانات المهمة
    if (!name || !phone) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // ✅ تشفير البيانات الحساسة
    const hashedEmail = hashData(email);
    const hashedPhone = hashData(phone);
    const hashedName = hashData(name);

    // البيانات المشفرة التي سترسل إلى Facebook
    const conversionData = {
      data: [
        {
          event_name: 'Lead',
          event_time: Math.floor(Date.now() / 1000),
          user_data: {
            em: hashedEmail,      // ✅ مشفر
            ph: hashedPhone,      // ✅ مشفر
            fn: hashedName,       // ✅ مشفر
          },
          custom_data: {
            content_name: `lcare_${condition}`,
            content_category: condition,
            value: package_value,
            currency: 'IQD'
          }
        }
      ],
      // ⚠️ التوكن من environment variables (ليس هنا في الكود!)
      access_token: process.env.FB_ACCESS_TOKEN
    };

    // إرسال البيانات إلى Facebook
    const pixelId = '1263336169287572';
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${pixelId}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conversionData)
      }
    );

    const result = await response.json();

    // إذا نجح الإرسال
    if (response.ok) {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          success: true, 
          message: '✅ تم تسجيل البيانات بنجاح' 
        })
      };
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Failed to send conversion',
          details: result.error?.message 
        })
      };
    }

  } catch (error) {
    console.error('❌ Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error' })
    };
  }
};
