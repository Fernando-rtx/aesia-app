import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { 
  getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, where, orderBy, limit, getDoc, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { 
  getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAr3gEd2hwISy2H3xyps4babDic0HSA39Y",
  authDomain: "aesia-marcacion.firebaseapp.com",
  projectId: "aesia-marcacion",
  storageBucket: "aesia-marcacion.firebasestorage.app",
  messagingSenderId: "1048380763745",
  appId: "1:1048380763745:web:585d93a0c428830dcdc420"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// ─── Autenticación ─────────────────────────────────────────────────────────────
export function loginWithGoogle() {
  return signInWithPopup(auth, provider);
}

export function logout() {
  return signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// ─── Contraseña Admin ─────────────────────────────────────────────────────────
// Por simplicidad, en lugar de guardarla en Firestore (lo cual requeriría otra colección),
// usaremos una variable estática o podríamos validarlo contra una lista blanca de emails admin en Firestore.
// Como el usuario pidió admin simple, lo mantendremos ofuscado aquí para compatibilidad.
export function checkAdminPass(pass) {
  return pass === 'aesia2024';
}

// ─── Miembros ─────────────────────────────────────────────────────────────────
export async function getMembers() {
  const q = query(collection(db, "members"));
  const snap = await getDocs(q);
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function saveMember(member) {
  const docRef = doc(db, "members", member.carnet);
  // Guardamos usando el carnet como ID de documento en Firestore
  await setDoc(docRef, {
    ...member,
    updatedAt: new Date().toISOString()
  });
  return member;
}

export async function deleteMember(carnet) {
  await deleteDoc(doc(db, "members", carnet));
}

export async function getMemberByCarnet(carnet) {
  const docRef = doc(db, "members", carnet);
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    return { id: snap.id, ...snap.data() };
  }
  return null;
}

// ─── Registros de Marcación ───────────────────────────────────────────────────
export async function saveRecord(record) {
  record.timestamp = new Date().toISOString();
  record.userEmail = auth.currentUser ? auth.currentUser.email : 'anónimo';
  const docRef = await addDoc(collection(db, "records"), record);
  return { id: docRef.id, ...record };
}

export async function deleteRecord(id) {
  await deleteDoc(doc(db, "records", id));
}

/**
 * Filtra registros para la tabla.
 */
export async function filterRecords({ date, carnet } = {}) {
  let recordsRef = collection(db, "records");
  
  // Como Firestore requiere índices compuestos, filtraremos la fecha y ordenamiento de forma híbrida.
  // Es más seguro extraer los registros recientes y filtrarlos localmente si no configuramos índices.
  const snap = await getDocs(query(recordsRef, orderBy("timestamp", "desc"), limit(500)));
  let records = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  if (date) {
    records = records.filter(r => r.timestamp.startsWith(date));
  }
  if (carnet) {
    records = records.filter(r => r.carnet.toLowerCase().includes(carnet.toLowerCase()));
  }
  return records;
}

/**
 * Exportar registros como CSV
 */
export async function exportToCSV(records) {
  const members = await getMembers();
  const header = ['ID', 'Carnet', 'Nombre', 'Carrera', 'Acción', 'Fecha', 'Hora', 'Fuera de Rango'];
  const rows = records.map(r => {
    const member = members.find(m => m.carnet === r.carnet);
    const dt = new Date(r.timestamp);
    const fecha = dt.toLocaleDateString('es-SV');
    const hora = dt.toLocaleTimeString('es-SV');
    return [
      r.id,
      r.carnet,
      member ? member.name : 'Desconocido',
      member ? member.career : '—',
      r.action.toUpperCase(),
      fecha,
      hora,
      r.outOfBounds ? 'SÍ' : 'NO'
    ];
  });

  const csvContent = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const today = new Date().toISOString().slice(0, 10);
  a.download = `AESIA_Marcaciones_${today}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Retorna array de personas actualmente DENTRO del local.
 */
export async function getCurrentlyInside() {
  const snap = await getDocs(query(collection(db, "records"), orderBy("timestamp", "desc"), limit(200)));
  const records = snap.docs.map(d => d.data());
  const members = await getMembers();
  
  const seen = new Set();
  const inside = [];

  for (const r of records) {
    if (!seen.has(r.carnet)) {
      seen.add(r.carnet);
      if (r.action === 'entrada') {
        const member = members.find(m => m.carnet === r.carnet);
        inside.push({
          carnet: r.carnet,
          name: member ? member.name : r.carnet,
          career: member ? member.career : '—',
          since: r.timestamp,
        });
      }
    }
  }
  return inside;
}

export async function getRecords(lim = 5) {
  const q = query(collection(db, "records"), orderBy("timestamp", "desc"), limit(lim));
  const snap = await getDocs(q);
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Detecta si la próxima acción es entrada o salida.
 */
export async function getNextAction(carnet) {
  const q = query(collection(db, "records"), where("carnet", "==", carnet));
  const snap = await getDocs(q);
  const records = snap.docs.map(doc => doc.data()).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  const lastRecord = records[0];
  
  if (!lastRecord || lastRecord.action === 'salida') return 'entrada';
  return 'salida';
}
