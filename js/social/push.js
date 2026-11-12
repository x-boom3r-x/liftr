/* Web Push subscriptions belong to the signed-in social profile and this device. */
import { SOCIAL_CONFIG, SOCIAL_ENABLED } from './config.js';
import { sb } from './client.js';

const PUSH_FUNCTION = '/functions/v1/send-social-push';
let configCache = null;

function el(id){ return document.getElementById(id); }
function toast(message){ if (typeof window.toast === 'function') window.toast(message); }
function meId(){ return (window.socialUser || {}).id || null; }
function isIOS(){
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone(){
  return !!navigator.standalone || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}
function supported(){
  return !!(window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window &&
    'Notification' in window && SOCIAL_CONFIG && SOCIAL_CONFIG.supabaseUrl);
}
function setButton(label, hint, disabled){
  const button = el('phonePushBtn');
  const copy = el('phonePushHint');
  if (button){ button.textContent = label; button.disabled = !!disabled; button.dataset.enabled = label === 'Turn off on this phone' ? 'true' : 'false'; }
  if (copy) copy.textContent = hint;
}
function publicKeyBytes(value){
  const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function pushConfig(){
  if (configCache) return configCache;
  const url = String(SOCIAL_CONFIG.supabaseUrl || '').replace(/\/$/, '') + PUSH_FUNCTION;
  const response = await fetch(url, { method: 'GET', cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error('Push service is not ready.');
  const data = await response.json();
  if (!data || !data.publicKey) throw new Error('Push service is not configured yet.');
  configCache = data;
  return data;
}
async function registration(){ return await navigator.serviceWorker.ready; }

export async function refreshPhonePushState(){
  if (!el('phonePushBtn')) return false;
  if (!SOCIAL_ENABLED || !meId()){
    setButton('Sign in first', 'Sign in to Social to link phone alerts to your account.', true);
    return false;
  }
  if (isIOS() && !isStandalone()){
    setButton('Add LIFTR to Home Screen', 'On iPhone, install LIFTR from Safari’s Share menu before enabling push alerts.', true);
    return false;
  }
  if (!supported()){
    setButton('Unavailable here', 'This browser does not support web push notifications.', true);
    return false;
  }
  if (Notification.permission === 'denied'){
    setButton('Allow in browser settings', 'Notifications are blocked for LIFTR in this browser.', true);
    return false;
  }
  try {
    const current = await (await registration()).pushManager.getSubscription();
    if (current){
      setButton('Turn off on this phone', 'This device is linked to your Social notifications.', false);
      return true;
    }
    const cfg = await pushConfig();
    setButton(current ? 'Turn off on this phone' : 'Enable on this phone',
      current ? 'This device is linked to your Social notifications.' : 'Receive Social alerts when LIFTR is closed.', false);
    return !!current;
  } catch(e){
    configCache = null;
    setButton('Not ready yet', 'Phone alerts need the LIFTR push service to be configured.', true);
    return false;
  }
}

export async function togglePhonePush(){
  const c = sb();
  const me = meId();
  if (!c || !me){ toast('Sign in to Social before enabling phone alerts.'); return false; }
  if (isIOS() && !isStandalone()){
    toast('On iPhone, open LIFTR in Safari, choose Share, then Add to Home Screen.');
    return false;
  }
  if (!supported()){
    toast('This browser does not support web push notifications.');
    return false;
  }
  const button = el('phonePushBtn');
  const disabling = !!(button && button.dataset.enabled === 'true');
  if (button) button.disabled = true;
  try {
    /* Keep the permission request as the first async operation after the tap. */
    if (!disabling){
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted'){
        toast(permission === 'denied' ? 'Allow notifications in your browser settings.' : 'Phone alerts were not enabled.');
        await refreshPhonePushState();
        return false;
      }
    }
    const reg = await registration();
    const current = await reg.pushManager.getSubscription();
    if (current || disabling){
      if (!current){ await refreshPhonePushState(); return true; }
      const { error } = await c.from('push_subscriptions').delete()
        .eq('user_id', me).eq('endpoint', current.endpoint);
      if (error) throw new Error(error.message || 'Could not remove this device.');
      await current.unsubscribe();
      configCache = null;
      toast('Phone alerts turned off on this device.');
      await refreshPhonePushState();
      return true;
    }
    const cfg = await pushConfig();
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKeyBytes(cfg.publicKey)
    });
    const { error } = await c.from('push_subscriptions').upsert({
      user_id: me,
      endpoint: subscription.endpoint,
      subscription: subscription.toJSON(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'endpoint' });
    if (error){ await subscription.unsubscribe(); throw new Error(error.message || 'Could not save this device.'); }
    toast('Phone alerts enabled for this device.');
    await refreshPhonePushState();
    return true;
  } catch(e){
    toast((e && e.message) || 'Could not enable phone alerts.');
    await refreshPhonePushState();
    return false;
  }
}

export async function removePhonePushForSignOut(userId = meId()){
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const c = sb();
    const me = userId || meId();
    await sub.unsubscribe();
    if (c && me){
      await Promise.race([
        c.from('push_subscriptions').delete().eq('user_id', me).eq('endpoint', sub.endpoint),
        new Promise(resolve => setTimeout(resolve, 1200))
      ]);
    }
  } catch(e){}
}
