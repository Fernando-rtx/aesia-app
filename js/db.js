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

// ─── Sistema de Roles Admin ───────────────────────────────────────────────────
// El rol de admin se almacena en la colección "admins" de Firestore.
// Solo se puede escribir a esa colección vía Admin SDK (script local),
// nunca desde el navegador (bloqueado por Firestore Rules).
let _adminCacheChecked = false;
let _isAdmin = false;

export async function isCurrentUserAdmin() {
  const user = auth.currentUser;
  if (!user) return false;

  // Cachear para no hacer lecturas repetidas a Firestore
  if (_adminCacheChecked) return _isAdmin;

  try {
    const docRef = doc(db, "admins", user.uid);
    const snap = await getDoc(docRef);
    _isAdmin = snap.exists();
  } catch (e) {
    console.warn("Error verificando rol admin:", e);
    _isAdmin = false;
  }
  _adminCacheChecked = true;
  return _isAdmin;
}

// Resetear caché al cambiar usuario
onAuthStateChanged(auth, () => {
  _adminCacheChecked = false;
  _isAdmin = false;
});

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
  const user = auth.currentUser;
  record.timestamp = new Date().toISOString();
  record.userEmail = user ? user.email : 'anónimo';
  record.uid = user ? user.uid : null; // Asociar con UID del usuario autenticado
  const docRef = await addDoc(collection(db, "records"), record);
  return { id: docRef.id, ...record };
}

export async function deleteRecord(id) {
  await deleteDoc(doc(db, "records", id));
}

/**
 * Filtra registros para la tabla.
 * Si el usuario es admin, devuelve todos. Si es usuario normal, solo los suyos.
 * Esto hace que la query sea compatible con las Firestore Rules.
 */
export async function filterRecords({ date, searchTerm } = {}) {
  const user = auth.currentUser;
  if (!user) return [];

  const admin = await isCurrentUserAdmin();
  let recordsRef = collection(db, "records");

  // Si no es admin, filtramos por uid en Firestore (necesario por las Rules)
  let q;
  if (admin) {
    q = query(recordsRef, orderBy("timestamp", "desc"), limit(500));
  } else {
    q = query(recordsRef, where("uid", "==", user.uid), orderBy("timestamp", "desc"), limit(500));
  }

  const snap = await getDocs(q);
  let records = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const members = await getMembers();

  if (date) {
    records = records.filter(r => r.timestamp.startsWith(date));
  }
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    records = records.filter(r => {
      const m = members.find(mb => mb.carnet === r.carnet);
      const nameMatch = m && m.name.toLowerCase().includes(term);
      const carnetMatch = r.carnet.toLowerCase().includes(term);
      return nameMatch || carnetMatch;
    });
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
 * Solo admins ven a todos. Usuarios normales solo se ven a sí mismos.
 */
export async function getCurrentlyInside() {
  const user = auth.currentUser;
  if (!user) return [];

  const admin = await isCurrentUserAdmin();
  let q;
  if (admin) {
    q = query(collection(db, "records"), orderBy("timestamp", "desc"), limit(200));
  } else {
    q = query(collection(db, "records"), where("uid", "==", user.uid), orderBy("timestamp", "desc"), limit(200));
  }

  const snap = await getDocs(q);
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

/**
 * Últimos N registros para el dashboard.
 * Solo admins ven todos; usuarios normales solo ven los suyos.
 */
export async function getRecords(lim = 5) {
  const user = auth.currentUser;
  if (!user) return [];

  const admin = await isCurrentUserAdmin();
  let q;
  if (admin) {
    q = query(collection(db, "records"), orderBy("timestamp", "desc"), limit(lim));
  } else {
    q = query(collection(db, "records"), where("uid", "==", user.uid), orderBy("timestamp", "desc"), limit(lim));
  }

  const snap = await getDocs(q);
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Detecta si la próxima acción es entrada o salida.
 * Filtra por carnet Y uid del usuario actual para respetar las Rules.
 */
export async function getNextAction(carnet) {
  const user = auth.currentUser;
  if (!user) return 'entrada';

  const q = query(
    collection(db, "records"),
    where("carnet", "==", carnet),
    where("uid", "==", user.uid)
  );
  const snap = await getDocs(q);
  const records = snap.docs.map(doc => doc.data()).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  const lastRecord = records[0];
  
  if (!lastRecord || lastRecord.action === 'salida') return 'entrada';
  return 'salida';
}
