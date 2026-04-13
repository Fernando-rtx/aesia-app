/**
 * setup-admin.js — Script de configuración local para registrar admins en Firestore.
 * 
 * INSTRUCCIONES:
 * 1. Instala dependencias:  npm install firebase
 * 2. Inicia sesión en la app web con tu cuenta de Google (aesia190@gmail.com).
 * 3. Copia tu UID de Firebase (lo verás en la consola de Firebase > Authentication > Users).
 * 4. Ejecuta este script:   node scripts/setup-admin.js TU_UID_AQUI
 * 
 * Esto creará un documento en la colección "admins" con tu UID como ID.
 * Las reglas de Firestore bloquean la escritura a "admins" desde el navegador,
 * pero este script usa las credenciales directas del proyecto para escribir.
 * 
 * NOTA: Este script usa el SDK de cliente con las mismas credenciales públicas.
 * Para producción real se usaría el Admin SDK con una Service Account,
 * pero para este caso el enfoque es suficiente ya que las reglas de Firestore
 * bloquean la escritura a /admins desde cualquier cliente web.
 * 
 * ALTERNATIVA RÁPIDA (sin script):
 * Ve a la consola de Firebase > Firestore > Crear colección "admins".
 * Crea un documento cuyo ID sea tu UID de Firebase.
 * Ponle un campo "email" con valor "aesia190@gmail.com" y "role" con valor "admin".
 */

// Para ejecutar necesitas Node.js y el paquete firebase:
// npm install firebase

import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAr3gEd2hwISy2H3xyps4babDic0HSA39Y",
  authDomain: "aesia-marcacion.firebaseapp.com",
  projectId: "aesia-marcacion",
  storageBucket: "aesia-marcacion.firebasestorage.app",
  messagingSenderId: "1048380763745",
  appId: "1:1048380763745:web:585d93a0c428830dcdc420"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function setupAdmin() {
  const uid = process.argv[2];
  const email = process.argv[3] || "aesia190@gmail.com";

  if (!uid) {
    console.error("❌ Uso: node scripts/setup-admin.js <UID> [email]");
    console.error("   Ejemplo: node scripts/setup-admin.js abc123xyz aesia190@gmail.com");
    console.error("\n   Para obtener tu UID:");
    console.error("   1. Ve a https://console.firebase.google.com/project/aesia-marcacion/authentication/users");
    console.error("   2. Busca tu correo y copia el 'UID de usuario'.");
    process.exit(1);
  }

  try {
    await setDoc(doc(db, "admins", uid), {
      email: email,
      role: "admin",
      createdAt: new Date().toISOString(),
    });
    console.log(`✅ Admin registrado exitosamente!`);
    console.log(`   UID: ${uid}`);
    console.log(`   Email: ${email}`);
    console.log(`\n   Ahora recarga la app web y tu cuenta tendrá acceso de administrador.`);
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error("\n   ALTERNATIVA: crea el documento manualmente en la consola de Firebase:");
    console.error("   Firestore > Colección 'admins' > Documento con ID = tu UID");
    console.error("   Campos: email (string), role (string: 'admin')");
  }

  process.exit(0);
}

setupAdmin();
