// api/surveycake.js
// Deploy to Vercel and set FIRSTLINE_API_KEY and SURVEYCAKE_SECRET in env vars

import crypto from 'crypto';
import { fetch } from 'undici';

// SurveyCake question_id for LINE UID
const QUESTION_ID = 'aka_contactable_user_id';

export default async function handler(req, res) {
  // === CORS 設定 ===
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SurveyCake-Signature');

  // 處理預檢 (OPTIONS)
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end('Method Not Allowed');
  }

  // 驗證 SurveyCake 簽名
  const secret = process.env.SURVEYCAKE_SECRET;
  if (secret) {
    const signature = req.headers['x-surveycake-signature'];
    const raw = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (!signature || signature !== expected) {
      console.error('Invalid SurveyCake signature');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // 解析 payload
  const payload = req.body;
  const ans = payload.answers.find(a => a.question_id === QUESTION_ID);
  if (!ans) return res.status(400).json({ error: 'Missing LINE UID' });
  const lineUid = ans.value;
  const surveyTags = Array.isArray(payload.tags) ? payload.tags : [];

  try {
    // 1. 查詢聯絡人 (API 路徑使用 /api/v1/contact)
    const contactRes = await fetch(
      `https://api.firstline.cc/api/v1/contact?line_uid=${encodeURIComponent(lineUid)}`,
      { headers: { Authorization: `Bearer ${process.env.FIRSTLINE_API_KEY}` } }
    );
    if (!contactRes.ok) {
      const text = await contactRes.text();
      console.error('Error fetching contact:', contactRes.status, text);
      return res.status(contactRes.status).json({ error: 'Failed to fetch contact' });
    }
    const contacts = await contactRes.json();
    if (!contacts.length) {
      console.error('Contact not found for UID:', lineUid);
      return res.status(404).json({ error: 'Contact not found' });
    }
    const contactId = contacts[0].id;

    // 2. 取標籤列表 (API 路徑使用 /api/v1/tag)
    const tagsRes = await fetch(
      'https://api.firstline.cc/api/v1/tag',
      { headers: { Authorization: `Bearer ${process.env.FIRSTLINE_API_KEY}` } }
    );
    if (!tagsRes.ok) {
      const text = await tagsRes.text();
      console.error('Error fetching tags:', tagsRes.status, text);
      return res.status(tagsRes.status).json({ error: 'Failed to fetch tags' });
    }
    const allTags = await tagsRes.json();
    const matchedTagIds = allTags.filter(t => surveyTags.includes(t.name)).map(t => t.id);

    // 3. 更新標籤 (API 路徑使用 /api/v1/contact/{id})
    const updateRes = await fetch(
      `https://api.firstline.cc/api/v1/contact/${contactId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.FIRSTLINE_API_KEY}`
        },
        body: JSON.stringify({ tag_ids: matchedTagIds })
      }
    );
    if (!updateRes.ok) {
      const text = await updateRes.text();
      console.error('Error updating contact:', updateRes.status, text);
      return res.status(updateRes.status).json({ error: 'Failed to update contact' });
    }

    return res.status(200).json({ message: 'Tags updated successfully' });
  } catch (err) {
    console.error('Error handling webhook:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
