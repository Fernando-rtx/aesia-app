import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { 
  getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, where, orderBy, limit, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { 
  getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAr3gEd2hwISy2H3xyps4babDic0HSA39Y",
  authDomain: "aesia-marcacion.firebaseapp.com",
  projectId: "aesia-marcacion",
  storageBucket: "aesia-marcacion.firebasestorage.app",
  messagingSenderId: "1048380763745",
  appId: "1:1048380763745:web:585d93a0c428830dcdc420"
};

const app = initializeApp(firebaseConfig);
export const db  = getFirestore(app);
export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// ─── Autenticación Google ─────────────────────────────────────────────────────
export function loginWithGoogle() {
  return signInWithPopup(auth, provider);
}

export function logout() {
  return signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// ─── Autenticación Email / Contraseña ─────────────────────────────────────────
/**
 * Registra una cuenta nueva y crea automáticamente su perfil de miembro.
 * El carnet es el ID del documento en Firestore (clave natural de la UES).
 */
export async function registerWithEmail(name, carnet, email, password) {
  const cleanCarnet = carnet.trim().toUpperCase();

  // 1. Verificar que el carnet no esté ya en uso
  const existing = await getDoc(doc(db, "members", cleanCarnet));
  if (existing.exists()) {
    throw new Error('Este carnet ya está registrado. Si ya tienes cuenta, inicia sesión.');
  }

  // 2. Crear cuenta en Firebase Auth
  const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const user = userCredential.user;

  // 3. Crear documento de miembro vinculado al uid
  try {
    await setDoc(doc(db, "members", cleanCarnet), {
      name:      name.trim(),
      carnet:    cleanCarnet,
      email:     email.trim().toLowerCase(),
      uid:       user.uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Si falla la base de datos, revertimos la creación de la cuenta
    await deleteUser(user).catch(() => {});
    throw new Error('Error de permisos o conexión. Intenta de nuevo. (' + err.message + ')');
  }

  return userCredential;
}

/** Inicia sesión con email y contraseña. */
export function loginWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

/** Envía correo de recuperación de contraseña. */
export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email.trim());
}

// ─── Sistema de Roles Admin ───────────────────────────────────────────────────
let _adminCacheChecked = false;
let _isAdmin = false;

export async function isCurrentUserAdmin() {
  const user = auth.currentUser;
  if (!user) return false;
  if (_adminCacheChecked) return _isAdmin;
  try {
    const snap = await getDoc(doc(db, "admins", user.uid));
    _isAdmin = snap.exists();
  } catch (e) {
    _isAdmin = false;
  }
  _adminCacheChecked = true;
  return _isAdmin;
}

onAuthStateChanged(auth, () => {
  _adminCacheChecked = false;
  _isAdmin = false;
});

// ─── Miembros ─────────────────────────────────────────────────────────────────
export async function getMembers() {
  const snap = await getDocs(collection(db, "members"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveMember(member) {
  const docRef = doc(db, "members", member.carnet);
  await setDoc(docRef, { ...member, updatedAt: new Date().toISOString() });
  return member;
}

export async function deleteMember(carnet) {
  await deleteDoc(doc(db, "members", carnet));
}

export async function getMemberByCarnet(carnet) {
  const snap = await getDoc(doc(db, "members", carnet));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Busca el miembro vinculado al uid del usuario logueado.
 * Usado en el flujo de marcación automática (un solo clic).
 */
export async function getMemberByUid(uid) {
  if (!uid) return null;
  const q = query(collection(db, "members"), where("uid", "==", uid));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

// ─── Registros de Marcación ───────────────────────────────────────────────────
export async function saveRecord(record) {
  const user = auth.currentUser;
  record.timestamp = new Date().toISOString();
  record.userEmail  = user ? user.email : 'anónimo';
  record.uid        = user ? user.uid   : null;
  const docRef = await addDoc(collection(db, "records"), record);
  return { id: docRef.id, ...record };
}

export async function deleteRecord(id) {
  await deleteDoc(doc(db, "records", id));
}

/**
 * Filtra registros. Si es admin, trae todos; si no, solo los propios.
 */
export async function filterRecords({ date, searchTerm } = {}) {
  const user = auth.currentUser;
  if (!user) return [];
  const admin = await isCurrentUserAdmin();
  const ref = collection(db, "records");
  const q = admin
    ? query(ref, orderBy("timestamp", "desc"), limit(500))
    : query(ref, where("uid", "==", user.uid), orderBy("timestamp", "desc"), limit(500));
  const snap = await getDocs(q);
  let records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const members = await getMembers();
  if (date)       records = records.filter(r => r.timestamp.startsWith(date));
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    records = records.filter(r => {
      const m = members.find(mb => mb.carnet === r.carnet);
      return (m && m.name.toLowerCase().includes(term)) || r.carnet.toLowerCase().includes(term);
    });
  }
  return records;
}

/** Exportar registros como CSV */
export async function exportToCSV(records) {
  const members = await getMembers();
  const header  = ['ID', 'Carnet', 'Nombre', 'Acción', 'Fecha', 'Hora', 'Fuera de Rango'];
  const rows    = records.map(r => {
    const m    = members.find(mb => mb.carnet === r.carnet);
    const dt   = new Date(r.timestamp);
    return [
      r.id,
      r.carnet,
      m ? m.name    : 'Desconocido',
      r.action.toUpperCase(),
      dt.toLocaleDateString('es-SV'),
      dt.toLocaleTimeString('es-SV'),
      r.outOfBounds ? 'SÍ' : 'NO',
    ];
  });
  const csv  = [header, ...rows].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `AESIA_${new Date().toISOString().slice(0,10)}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

/** Personas actualmente dentro del local. */
export async function getCurrentlyInside() {
  const user = auth.currentUser;
  if (!user) return [];
  const admin = await isCurrentUserAdmin();
  const q = admin
    ? query(collection(db, "records"), orderBy("timestamp", "desc"), limit(200))
    : query(collection(db, "records"), where("uid", "==", user.uid), orderBy("timestamp", "desc"), limit(200));
  const snap    = await getDocs(q);
  const records = snap.docs.map(d => d.data());
  const members = await getMembers();
  const seen    = new Set();
  const inside  = [];
  for (const r of records) {
    if (!seen.has(r.carnet)) {
      seen.add(r.carnet);
      if (r.action === 'entrada') {
        const m = members.find(mb => mb.carnet === r.carnet);
        inside.push({ carnet: r.carnet, name: m ? m.name : r.carnet, since: r.timestamp });
      }
    }
  }
  return inside;
}

/** Últimos N registros para el dashboard. */
export async function getRecords(lim = 5) {
  const user = auth.currentUser;
  if (!user) return [];
  const admin = await isCurrentUserAdmin();
  const q = admin
    ? query(collection(db, "records"), orderBy("timestamp", "desc"), limit(lim))
    : query(collection(db, "records"), where("uid", "==", user.uid), orderBy("timestamp", "desc"), limit(lim));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Métricas avanzadas para el dashboard */
export async function getDashboardMetrics() {
  const user = auth.currentUser;
  if (!user) return { today: 0, month: 0, peakHour: '—', activeUsers: 0 };
  const admin = await isCurrentUserAdmin();
  
  const q = admin
    ? query(collection(db, "records"), orderBy("timestamp", "desc"), limit(500))
    : query(collection(db, "records"), where("uid", "==", user.uid), orderBy("timestamp", "desc"), limit(500));
    
  const snap = await getDocs(q);
  const records = snap.docs.map(d => d.data());
  
  const todayStr = new Date().toISOString().slice(0, 10);
  const thisMonthStr = todayStr.slice(0, 7);
  
  let visitsToday = 0;
  let visitsMonth = 0;
  const hourCounts = {};
  const activeMembers = new Set();
  
  records.forEach(r => {
    if (r.action !== 'entrada') return;
    const rDate = r.timestamp.slice(0, 10);
    const rMonth = r.timestamp.slice(0, 7);
    const rHour = new Date(r.timestamp).getHours();
    
    if (rDate === todayStr) visitsToday++;
    if (rMonth === thisMonthStr) {
      visitsMonth++;
      activeMembers.add(r.carnet);
      hourCounts[rHour] = (hourCounts[rHour] || 0) + 1;
    }
  });
  
  let peakHour = '—';
  if (Object.keys(hourCounts).length > 0) {
    const peak = Object.entries(hourCounts).reduce((a, b) => a[1] > b[1] ? a : b)[0];
    const ph = parseInt(peak, 10);
    const suffix = ph >= 12 ? 'PM' : 'AM';
    const hour12 = ph % 12 || 12;
    peakHour = `${hour12}:00 ${suffix}`;
  }
  
  // Calcular últimos 7 días
  const last7Days = [];
  const daysVisits = {};
  for(let i=6; i>=0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dStr = d.toISOString().slice(0, 10);
    last7Days.push(dStr);
    daysVisits[dStr] = 0;
  }
  
  // Inicializar 24 horas
  const hours24 = Array(24).fill(0);
  
  records.forEach(r => {
    if (r.action !== 'entrada') return;
    const rDate = r.timestamp.slice(0, 10);
    const rHour = new Date(r.timestamp).getHours();
    
    if (daysVisits[rDate] !== undefined) {
      daysVisits[rDate]++;
    }
    hours24[rHour]++;
  });
  
  const visitsLast7Days = last7Days.map(d => daysVisits[d]);
  
  return {
    today: visitsToday,
    month: visitsMonth,
    activeUsers: activeMembers.size,
    peakHour,
    chartVisits: { labels: last7Days, data: visitsLast7Days },
    chartHours: { data: hours24 }
  };
}

/** Detecta la próxima acción (entrada/salida) para un carnet. */
export async function getNextAction(carnet) {
  const user = auth.currentUser;
  if (!user) return 'entrada';
  const q    = query(collection(db, "records"), where("carnet", "==", carnet), where("uid", "==", user.uid));
  const snap = await getDocs(q);
  const last = snap.docs.map(d => d.data()).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  return (!last || last.action === 'salida') ? 'entrada' : 'salida';
}
