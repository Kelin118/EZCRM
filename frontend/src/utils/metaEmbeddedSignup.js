const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';
const SDK_SCRIPT_ID = 'meta-jssdk';

let sdkPromise = null;
let initializedKey = '';

export function isMetaOrigin(origin) {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'https:' && (
      hostname === 'facebook.com'
      || hostname.endsWith('.facebook.com')
      || hostname === 'meta.com'
      || hostname.endsWith('.meta.com')
    );
  } catch {
    return false;
  }
}

export function parseEmbeddedSignupMessage(event) {
  if (!isMetaOrigin(event.origin)) return null;
  let payload = event.data;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (!payload || payload.type !== 'WA_EMBEDDED_SIGNUP') return null;
  return payload;
}

export function loadMetaSdk(publicConfig) {
  if (!publicConfig?.app_id || !publicConfig?.graph_api_version) {
    return Promise.reject(new Error('Meta public config is incomplete.'));
  }
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      if (window.FB) {
        resolve(window.FB);
        return;
      }
      const existing = document.getElementById(SDK_SCRIPT_ID);
      if (existing) {
        existing.addEventListener('load', () => resolve(window.FB));
        existing.addEventListener('error', reject);
        return;
      }
      const script = document.createElement('script');
      script.id = SDK_SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.src = SDK_URL;
      script.onload = () => resolve(window.FB);
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }
  return sdkPromise.then((FB) => {
    const key = `${publicConfig.app_id}:${publicConfig.graph_api_version}`;
    if (FB && initializedKey !== key) {
      FB.init({
        appId: publicConfig.app_id,
        cookie: true,
        xfbml: false,
        version: publicConfig.graph_api_version,
      });
      initializedKey = key;
    }
    return FB;
  });
}

export function startWhatsAppBusinessAppOnboarding(publicConfig, callback) {
  if (!window.FB) {
    throw new Error('Meta SDK is not loaded.');
  }
  window.FB.login(callback, {
    config_id: publicConfig.whatsapp_config_id,
    response_type: 'code',
    override_default_response_type: true,
    extras: {
      setup: {},
      featureType: 'whatsapp_business_app_onboarding',
      sessionInfoVersion: '3',
    },
  });
}
