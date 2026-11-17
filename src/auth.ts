// Innlogging brukes bare av admin og lenkesidene, og lastes derfor separat.
import { getAuth } from 'firebase/auth';
import { app } from './firebase';

export const auth = getAuth(app);
