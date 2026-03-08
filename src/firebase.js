import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Replace each value below with the ones from your Firebase console
const firebaseConfig = {
  apiKey: "AIzaSyCu2CR0K6Wg9_9VfcRmBcoC9c-Zs1IVncs",
  authDomain: "connections-sports-app.firebaseapp.com",
  projectId: "connections-sports-app",
  storageBucket: "connections-sports-app.firebasestorage.app",
  messagingSenderId: "545238523917",
  appId: "1:545238523917:web:e7bba0b2ac6ddf546db544",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
