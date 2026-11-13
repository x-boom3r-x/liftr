import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS, POST',
  'Content-Type': 'application/json'
};

const messages: Record<string, string> = {
  follow: 'started following you.',
  follow_request: 'asked to follow you.',
  like: 'reacted to your post.',
  comment: 'commented on your post.',
  mention: 'mentioned you.'
};

function response(body: unknown, status = 200){
  return new Response(JSON.stringify(body), { status, headers: cors });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') || '';
  if (req.method === 'GET') return publicKey ? response({ publicKey }) : response({ error: 'not_configured' }, 503);
  if (req.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);

  const expected = Deno.env.get('PUSH_WEBHOOK_SECRET') || '';
  if (!expected || req.headers.get('authorization') !== `Bearer ${expected}`){
    return response({ error: 'unauthorized' }, 401);
  }

  try {
    const payload = await req.json();
    const record = payload && payload.record;
    if (payload.type !== 'INSERT' || payload.table !== 'notifications' ||
        !record || !record.id || !record.user_id || !record.actor_id || !messages[record.type]){
      return response({ error: 'invalid_event' }, 400);
    }

    const url = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') || '';
    const subject = Deno.env.get('VAPID_SUBJECT') || 'https://web-app-one-flax.vercel.app';
    if (!url || !serviceKey || !publicKey || !privateKey) return response({ error: 'not_configured' }, 503);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: notice, error: noticeError } = await admin.from('notifications')
      .select('id,user_id,actor_id,type')
      .eq('id', record.id).eq('user_id', record.user_id).maybeSingle();
    if (noticeError || !notice || notice.actor_id !== record.actor_id || notice.type !== record.type){
      return response({ error: 'notification_not_found' }, 404);
    }

    const typeColumn = notice.type === 'follow_request' ? 'follow' : notice.type;
    if (['follow','like','comment','mention'].includes(typeColumn)){
      const { data: prefs } = await admin.from('social_notification_preferences')
        .select(typeColumn).eq('user_id', notice.user_id).maybeSingle();
      if (prefs && prefs[typeColumn] === false) return response({ sent: 0, reason: 'disabled_by_user' });
    }

    const [{ data: actor }, { data: devices }] = await Promise.all([
      admin.from('profiles').select('display_name,username').eq('id', notice.actor_id).maybeSingle(),
      admin.from('push_subscriptions').select('endpoint,subscription').eq('user_id', notice.user_id)
    ]);
    if (!devices || !devices.length) return response({ sent: 0 });

    const name = actor?.display_name || actor?.username || 'A lifter';
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const message = JSON.stringify({
      title: 'LIFTR Social',
      body: `${name} ${messages[notice.type]}`,
      url: '/index.html?shortcut=notifications',
      tag: `social-${notice.id}`
    });
    const results = await Promise.allSettled(devices.map(async device => {
      try {
        await webpush.sendNotification(device.subscription, message, { TTL: 60, urgency: 'normal' });
        return true;
      } catch (error) {
        const status = Number((error as { statusCode?: number })?.statusCode || 0);
        if (status === 404 || status === 410){
          await admin.from('push_subscriptions').delete().eq('endpoint', device.endpoint);
        }
        throw error;
      }
    }));
    return response({ sent: results.filter(r => r.status === 'fulfilled').length });
  } catch (_error) {
    return response({ error: 'push_delivery_failed' }, 500);
  }
});
