import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getFirestore } from 'firebase/firestore';

// Firebase-konfigurasjon er ikke hemmelig; tilgang styres av firestore.rules.
export const app = initializeApp({
  apiKey: 'AIzaSyCCdxHZrBeZZG0kjgjaP2fNbqsaNboo8l8',
  authDomain: 'basar-ba738.firebaseapp.com',
  projectId: 'basar-ba738',
  storageBucket: 'basar-ba738.firebasestorage.app',
  messagingSenderId: '843940127909',
  appId: '1:843940127909:web:c10d4ec53133653561994c',
});

// App Check (spam-vern): beviser at forespørsler kommer fra denne nettsiden, ikke et skript.
// Nøkkelen er en offentlig reCAPTCHA Enterprise-nettstedsnøkkel (ikke hemmelig).
// Tom nøkkel = App Check er av. Kjøres ikke lokalt (localhost), der nøkkelen ikke gjelder.
const RECAPTCHA_SITE_KEY = '6LeHXi0uAAAAAK-4M0SsV4mlWbZXwoOzh2ZEPcNS';
if (RECAPTCHA_SITE_KEY && location.hostname !== 'localhost') {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

export const db = getFirestore(app); // (default)-databasen
