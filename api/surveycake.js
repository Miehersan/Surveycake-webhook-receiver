// api/surveycake.js
// Deploy to Vercel and set FIRSTLINE_API_KEY and SURVEYCAKE_SECRET in env vars

import crypto from 'crypto';
import fetch from 'node-fetch';

// SurveyCake question_id for LINE UID
const QUESTION_ID = 'aka_contactable_user_id';

export default async function handler(req, res) {
  // === CORS 設定，允許瀏覽器測試 ===
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SurveyCake-Signature');

  // 處理預檢 (OPTIONS) 請求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end('Method Not Allowed');
  }

  // 1. Verify SurveyCake signature if configured
  const secret = process.env.SURVEYCAKE_SECRET;
  if (secret) {
    const signature = req.headers['x-surveycake-signature'];
    const payloadRaw = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(payloadRaw).digest('hex');
    if (!signature || signature !== expected) {
      console.error('Invalid signature');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // 2. Extract LINE UID and SurveyCake tags
  const payload = req.body;
  const ans = payload.answers.find(a => a.question_id === QUESTION_ID);
  if (!ans) {
    console.error('Missing LINE UID question');
    return res.status(400).json({ error: 'Missing LINE UID' });
  }
  const lineUid = ans.value;
  const surveyTags = Array.isArray(payload.tags) ? payload.tags : [];

  try {
    // 3. Lookup contact by LINE UID
    const listRes = await fetch(
      `https://api.firstline.cc/api/v1/contact?line_uid=${encodeURIComponent(lineUid)}`,
      { headers: { Authorization: `Bearer ${process.env.FIRSTLINE_API_KEY}` } }
    );
    const contacts = await listRes.json();
    if (!Array.isArray(contacts) || contacts.length === 0) {
      console.error('Contact not found:', lineUid);
      return res.status(404).json({ error: 'Contact not found' });
    }
    const contactId = contacts[0].id;

    // 4. Fetch existing FirstLine tags to map names to IDs
    const tagListRes = await fetch(
      'https://api.firstline.cc/api/v1/tag',
      { headers: { Authorization: `Bearer ${process.env.FIRSTLINE_API_KEY}` } }
    );
    const allTags = await tagListRes.json();
    // Filter tags that match surveyTags names
    const matchedTagIds = allTags
      .filter(t => surveyTags.includes(t.name))
      .map(t => t.id);

    // 5. Update contact's tags using tag_ids
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
      const err = await updateRes.text();
      console.error('Update failed:', err);
      return res.status(500).json({ error: 'Update failed' });
    }

    return res.status(200).json({ message: 'Tags updated successfully' });
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
