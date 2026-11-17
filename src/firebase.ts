import { initializeApp } from 'firebase/app';
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

export const db = getFirestore(app); // (default)-databasen
