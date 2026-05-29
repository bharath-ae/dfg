// DrivePro owner and shared app bootstrap code.
// Shared Firebase/auth/data setup stays here because the owner panel is the top-level app shell.
// ============================================================
// FIREBASE CONFIGURATION
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyDTjBL6tbQ1cbX-0Fvn8i6D5cEuf-Tr1w8",
  authDomain: "driving-scoolmanagement.firebaseapp.com",
  projectId: "driving-scoolmanagement",
  storageBucket: "driving-scoolmanagement.firebasestorage.app",
  messagingSenderId: "741852892786",
  appId: "1:741852892786:web:7a419b6efcba83be7d7ceb",
  measurementId: "G-HG1WLCY5W0"
};

// Global variables — declared FIRST so they are never in the TDZ
let currentUser = null;
let currentRole = null;
let currentSchoolId = null;
let userSchools = [];
let currentPage = null;
let messaging = null;
let firebaseFunctions = null;
const FCM_VAPID_KEY =
  (typeof process !== 'undefined' && process.env && process.env.FCM_VAPID_KEY) ||
  window.FCM_VAPID_KEY ||
  'BMa96QRVNuVUS2iiMDJnUSu9WtKTPGgsR2CaPaOhglk17sr8__QP6qQRMaxPjM-5XllAE52ObZUUcB1yLikICwY';

// ============================================================
// GEOLOCATION SERVICE
// ============================================================
const LocationService = {
  // Get current user location
  getCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by this browser'));
        return;
      }
      
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
        },
        (error) => {
          reject(new Error('Unable to retrieve location: ' + error.message));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  },

  // Calculate distance between two points using Haversine formula
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in meters
  },

  // Convert degrees to radians
  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  },

  // Check if user is within specified radius of school
  isWithinSchoolRadius(userLat, userLon, schoolLat, schoolLon, radiusMeters = 100) {
    const distance = this.calculateDistance(userLat, userLon, schoolLat, schoolLon);
    return distance <= radiusMeters;
  }
};

// Get school location and populate form fields
async function getSchoolLocation() {
  const statusDiv = document.getElementById('location-status');
  const latInput = document.getElementById('school-latitude');
  const lonInput = document.getElementById('school-longitude');
  
  statusDiv.textContent = 'Getting location...';
  statusDiv.style.color = 'var(--text2)';
  
  try {
    const location = await LocationService.getCurrentLocation();
    latInput.value = location.latitude.toFixed(6);
    lonInput.value = location.longitude.toFixed(6);
    statusDiv.textContent = `✓ Location captured (accuracy: ±${Math.round(location.accuracy)}m)`;
    statusDiv.style.color = 'var(--success)';
  } catch (error) {
    statusDiv.textContent = '❌ ' + error.message;
    statusDiv.style.color = 'var(--danger)';
  }
}

// Initialize Firebase — deferred until DOM is ready so all CDN scripts have executed
let auth, db, analytics;

function initFirebase() {
  if (typeof firebase === 'undefined') {
    console.error('Firebase SDK unavailable. Check CDN connectivity.');
    const splash = document.getElementById('splash');
    if (splash) {
      const msg = document.createElement('p');
      msg.style.cssText = 'color:#f87171;font-size:13px;text-align:center;margin-top:12px;';
      msg.textContent = 'Firebase failed to load. Check your internet connection and reload.';
      splash.querySelector('.splash-card')?.appendChild(msg);
    }
    return false;
  }
  try {
    // Avoid re-initializing if already done
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    auth = firebase.auth();
    db   = firebase.firestore();
    try { analytics = firebase.analytics(); } catch(e) { console.warn('Analytics unavailable:', e.message); }
    try { messaging = firebase.messaging(); } catch(e) { console.warn('Messaging unavailable:', e.message); }
    try { firebaseFunctions = firebase.functions(); } catch(e) { console.warn('Functions unavailable:', e.message); }
    return true;
  } catch(e) {
    console.error('Firebase init error:', e.message);
    return false;
  }
}

// Initialize EmailJS (optional)
function initEmailJS() {
  try {
    if (typeof emailjs !== 'undefined') {
      emailjs.init("YOUR_PUBLIC_KEY"); // Replace with your EmailJS public key
    }
  } catch(e) { console.warn('EmailJS init failed:', e.message); }
}

document.addEventListener('DOMContentLoaded', function() {
  initFirebase();
  initEmailJS();
  registerFirebaseMessagingServiceWorker();
});

async function registerFirebaseMessagingServiceWorker() {
  if (!('serviceWorker' in navigator) || !messaging) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    console.log('Service worker registered for FCM:', registration.scope);
  } catch (error) {
    console.warn('FCM service worker registration failed:', error);
  }
}

async function requestNotificationPermission() {
  if (!messaging) {
    console.warn('Firebase Messaging is not initialized.');
    return null;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Notification permission not granted.');
      return null;
    }

    const vapidKey = FCM_VAPID_KEY;
    const token = await messaging.getToken({ vapidKey });
    return token;
  } catch (error) {
    console.error('Failed to get FCM token:', error);
    return null;
  }
}

async function saveUserFcmToken(email, token) {
  if (!db || !email || !token) return;

  try {
    await db.collection('userTokens').doc(email.toLowerCase()).set({
      email: email.toLowerCase(),
      token,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log('Saved FCM token for', email);
  } catch (error) {
    console.error('Error saving FCM token to Firestore:', error);
  }
}

async function registerUserNotificationToken() {
  if (!currentUser || !currentUser.email) return;
  try {
    const token = await requestNotificationPermission();
    if (!token) return;
    await saveUserFcmToken(currentUser.email, token);
  } catch (error) {
    console.warn('Notification token registration skipped:', error);
  }
}

async function handleUserLoggedIn(user, selectedRole, loginBtn, originalText) {
  if (!user) {
    throw new Error('Signed in user is not available.');
  }

  FirebaseService.setUser(user);
  currentUser = user;
  await registerUserNotificationToken();

  const role = selectedRole || document.querySelector('.role-btn.active')?.id.replace('role-', '') || 'owner';
  const verifiedRole = await verifyUserRole(user.uid, role);
  if (!verifiedRole) {
    throw new Error('You are not authorized for this role');
  }
  currentRole = verifiedRole;

  if (currentRole === 'owner') {
    await loadUserSchools();
    if (userSchools.length === 0) {
      console.log('No schools found, redirecting to school selector for creation');
      await continueToAppDirectly();
      setTimeout(() => {
        navigateTo('school-selector');
      }, 500);
    } else {
      await continueToAppDirectly();
    }
  } else if (currentRole === 'office' || currentRole === 'instructor') {
    await loadUserMemberSchools();
    if (userSchools.length === 0) {
      throw new Error('You are not assigned to any school. Please contact your administrator.');
    }
    currentSchoolId = userSchools[0].id;
    FirebaseService.setSchool(currentSchoolId);
    await continueToApp();
  } else {
    throw new Error('Invalid role specified');
  }

  if (loginBtn && originalText !== undefined) {
    loginBtn.textContent = originalText;
    loginBtn.disabled = false;
  }
}

async function writeUserSchoolsIndexAsCreatedUser(secondaryApp, userId, schoolId, role, ownerEmail) {
  if (!secondaryApp || !userId || !schoolId) {
    throw new Error('Missing secondary app, user ID, or school ID for userSchools index write');
  }

  const secondaryDb = secondaryApp.firestore();
  await secondaryDb.collection('userSchools').doc(userId).set({
    schoolIds: firebase.firestore.FieldValue.arrayUnion(schoolId),
    roles: { [schoolId]: role },
    ownerEmails: { [schoolId]: ownerEmail || null },
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

function getAttendanceUserKey(user) {
  if (!user) return 'Unknown';
  return user.displayName || user.email || user.uid || 'Unknown';
}

function getAttendanceCollectionForRole(role) {
  if (role === 'instructor') return 'instructorAttendance';
  if (role === 'owner' || role === 'office' || role === 'admin') return 'adminAttendance';
  return 'staffAttendance';
}

function getAttendanceDocId(date, role, user) {
  const uid = user && user.uid ? user.uid : 'unknown';
  if (role === 'instructor') return date + '_instructor_' + uid;
  if (role === 'owner' || role === 'office' || role === 'admin') return date + '_office_' + uid;
  return date + '_staff_' + uid;
}

async function loadSelfAttendanceRecords(limitDays = 30) {
  if (typeof db === 'undefined' || !currentSchoolId || !currentUser) return [];
  const records = [];
  for (let i = 0; i < limitDays; i++) {
    const date = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    const docId = getAttendanceDocId(date, currentRole, currentUser);
    const doc = await db.collection('schools').doc(currentSchoolId).collection('attendance').doc(docId).get();
    if (doc.exists) records.push(doc.data());
  }
  return records;
}

async function syncSelfAttendanceToRoleCollection(date, attendanceData, role = currentRole, user = currentUser) {
  if (!currentSchoolId || !user) return;
  const collectionName = getAttendanceCollectionForRole(role);
  const userKey = getAttendanceUserKey(user);
  await FirebaseService.updateAttendanceByType(date, userKey, attendanceData, collectionName);
}

// Firebase Security Rules for SaaS Multi-Tenant (copy these to Firestore Rules in Firebase Console):
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Helper functions
    function isOwner(schoolId) {
      return request.auth != null && 
             resource.data.ownerId == request.auth.uid;
    }
    
    function isSchoolMember(schoolId) {
      return request.auth != null && 
             exists(/databases/$(database)/documents/schools/$(schoolId)/users/$(request.auth.uid));
    }
    
    function getUserRole(schoolId) {
      return get(/databases/$(database)/documents/schools/$(schoolId)/users/$(request.auth.uid)).data.role;
    }
    
    function hasRole(schoolId, requiredRole) {
      return isSchoolMember(schoolId) && getUserRole(schoolId) == requiredRole;
    }
    
    // userSchools index — users can only read/write their own doc
    match /userSchools/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Schools collection - strict role-based access
    match /schools/{schoolId} {
      // Owners can read their schools
      allow read: if isOwner(schoolId);
      
      // School members can read basic school info
      allow read: if isSchoolMember(schoolId);
      
      // Only owners can create schools
      allow create: if request.auth != null && 
        request.auth.uid == request.resource.data.ownerId;
      
      // Only owners can update schools
      allow update: if isOwner(schoolId);
      
      // Only owners can delete schools
      allow delete: if isOwner(schoolId);
      
      // Students collection - role-based access
      match /students/{studentId} {
        // Owners and office staff can read/write all students
        allow read, write: if isOwner(schoolId) || hasRole(schoolId, 'office');
        
        // Instructors can read all students (client-side filtering by assignment)
        allow read: if hasRole(schoolId, 'instructor');
        
        // Instructors can update classes/attendance/status fields on their students
        allow update: if hasRole(schoolId, 'instructor') &&
          resource.data.instructorEmail == request.auth.token.email;
      }
      
      // Transactions collection - role-based access
      match /transactions/{transactionId} {
        // Owners can read/write all transactions
        allow read, write: if isOwner(schoolId);
        
        // Office staff can read/write all transactions
        allow read, write: if hasRole(schoolId, 'office');
        
        // Instructors can only read transactions (no write access)
        allow read: if isSchoolMember(schoolId);
      }
      
      // Users subcollection - manage school members
      match /users/{userId} {
        // Only owners can manage users
        allow read, write: if isOwner(schoolId);
        
        // Users can read their own role
        allow read: if request.auth != null && request.auth.uid == userId;
      }
      
      // Attendance collection - one document per date, keyed by student name
      match /attendance/{date} {
        allow read, write: if isOwner(schoolId) || hasRole(schoolId, 'office') || hasRole(schoolId, 'instructor');
      }
      
      // Schedule collection - role-based access
      match /schedule/{scheduleId} {
        // Owners can read/write all schedules
        allow read, write: if isOwner(schoolId);
        
        // Office staff can read/write all schedules
        allow read, write: if hasRole(schoolId, 'office');
        
        // Instructors can read schedules and update their own
        allow read: if isSchoolMember(schoolId);
        allow update: if hasRole(schoolId, 'instructor') && 
          resource.data.instructorEmail == request.auth.token.email;
      }
      
      // Fuel log - instructor access only for their entries
      match /fuel/{fuelId} {
        // Owners can read/write all fuel entries
        allow read, write: if isOwner(schoolId);
        
        // Office staff can read all fuel entries
        allow read: if hasRole(schoolId, 'office');
        
        // Instructors can read all and write/create their own entries
        allow read: if isSchoolMember(schoolId);
        allow create: if hasRole(schoolId, 'instructor') &&
          request.auth.token.email == request.resource.data.instructorEmail;
        allow update, delete: if hasRole(schoolId, 'instructor') &&
          request.auth.token.email == resource.data.instructorEmail;
      }
      
      // Staff subcollection
      match /staff/{staffId} {
        allow read, write: if isOwner(schoolId) || hasRole(schoolId, 'office');
        allow read: if request.auth != null && request.auth.uid == staffId;
      }
      
      // Notifications subcollection
      match /notifications/{notifId} {
        allow read, write: if isOwner(schoolId) || isSchoolMember(schoolId);
      }
      
      // Default deny for all other collections
      match /{collection}/{documentId} {
        allow read, write: if false;
      }
    }
  }
}
*/

// ============================================================
// SAAS MULTI-TENANT FIREBASE SERVICE MODULE
// ============================================================
const FirebaseService = {
  // School management
  get schoolsRef() { return db.collection('schools'); },
  
  // Collection references with school context
  get studentsRef() { return db.collection('schools').doc(currentSchoolId).collection('students'); },
  get transactionsRef() { return db.collection('schools').doc(currentSchoolId).collection('transactions'); },
  get dlTestsRef() { return db.collection('schools').doc(currentSchoolId).collection('dlTests'); },
  get attendanceRef() { return db.collection('schools').doc(currentSchoolId).collection('attendance'); },
  get scheduleRef() { return db.collection('schools').doc(currentSchoolId).collection('schedule'); },
  get fuelRef() { return db.collection('schools').doc(currentSchoolId).collection('fuel'); },
  get notificationsRef() { return db.collection('schools').doc(currentSchoolId).collection('notifications'); },
  
  // Set current school context
  setSchool(schoolId) {
    currentSchoolId = schoolId;
  },
  
  // Get current school
  getCurrentSchool() {
    return currentSchoolId;
  },
  
  // Set current user
  setUser(user) {
    currentUser = user;
  },
  
  // Get current user
  getCurrentUser() {
    return currentUser;
  },

  getOwnerScope(extraSchoolId = null) {
    const school = (userSchools || []).find(s => s.id === (extraSchoolId || currentSchoolId)) || {};
    return {
      ownerId: school.ownerId || (currentRole === 'owner' && currentUser ? currentUser.uid : null),
      ownerEmail: school.ownerEmail || (currentRole === 'owner' && currentUser ? currentUser.email : null)
    };
  },

  // Generic CRUD operations
  async addDocument(collection, data) {
    try {
      const docRef = await collection.add({
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { id: docRef.id, ...data };
    } catch (error) {
      console.error('Error adding document:', error);
      throw error;
    }
  },

  async updateDocument(collection, docId, data) {
    try {
      await collection.doc(docId).update({
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { id: docId, ...data };
    } catch (error) {
      console.error('Error updating document:', error);
      throw error;
    }
  },

  async deleteDocument(collection, docId) {
    try {
      await collection.doc(docId).delete();
      return docId;
    } catch (error) {
      console.error('Error deleting document:', error);
      throw error;
    }
  },

  async deleteCollection(collectionRef, batchSize = 400) {
    const snapshot = await collectionRef.limit(batchSize).get();
    if (snapshot.empty) return 0;

    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    if (snapshot.size >= batchSize) {
      return snapshot.size + await this.deleteCollection(collectionRef, batchSize);
    }
    return snapshot.size;
  },

  async backfillOwnerMappingForSchool(schoolId) {
    if (!schoolId) return 0;

    const schoolRef = this.schoolsRef.doc(schoolId);
    const schoolDoc = await schoolRef.get();
    if (!schoolDoc.exists) return 0;

    const schoolData = schoolDoc.data();
    const ownerId = schoolData.ownerId || (currentUser ? currentUser.uid : null);
    const ownerEmail = schoolData.ownerEmail || (currentUser ? currentUser.email : null);
    if (!ownerId && !ownerEmail) return 0;

    let updated = 0;
    for (const collectionName of ['students', 'users', 'staff']) {
      const snapshot = await schoolRef.collection(collectionName).get();
      for (let i = 0; i < snapshot.docs.length; i += 400) {
        const batch = db.batch();
        let batchWrites = 0;
        snapshot.docs.slice(i, i + 400).forEach(doc => {
          const item = doc.data();
          if (item.ownerId !== ownerId || item.ownerEmail !== ownerEmail || item.schoolId !== schoolId) {
            batch.set(doc.ref, { ownerId, ownerEmail, schoolId }, { merge: true });
            updated++;
            batchWrites++;
          }
        });
        if (batchWrites > 0) await batch.commit();
      }
    }

    return updated;
  },

  async getDocuments(collection, orderBy = 'createdAt', orderDirection = 'desc') {
    try {
      const snapshot = await collection.orderBy(orderBy, orderDirection).get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting documents:', error);
      throw error;
    }
  },

  async getDocument(collection, docId) {
    try {
      const doc = await collection.doc(docId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Error getting document:', error);
      throw error;
    }
  },

  // Real-time listeners
  onDocumentsChange(collection, callback, orderBy = 'createdAt', orderDirection = 'desc') {
    return collection.orderBy(orderBy, orderDirection).onSnapshot(snapshot => {
      const documents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      callback(documents);
    }, error => {
      console.error('Error in real-time listener:', error);
    });
  },

  // Specific operations for students
  async addStudent(studentData) {
    return this.addDocument(this.studentsRef, studentData);
  },

  async updateStudent(studentId, studentData) {
    return this.updateDocument(this.studentsRef, studentId, studentData);
  },

  async deleteStudent(studentId) {
    return this.deleteDocument(this.studentsRef, studentId);
  },

  async getStudents() {
    return this.getDocuments(this.studentsRef, 'enrolled', 'desc');
  },

  onStudentsChange(callback) {
    return this.onDocumentsChange(this.studentsRef, callback, 'enrolled', 'desc');
  },

  // Specific operations for transactions
  async addTransaction(transactionData) {
    return this.addDocument(this.transactionsRef, transactionData);
  },

  async getTransactions(monthFilter = null) {
    let query = this.transactionsRef.orderBy('date', 'desc');
    if (monthFilter) {
      query = query.where('date', '>=', monthFilter + '-01').where('date', '<=', monthFilter + '-31');
    }
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  onTransactionsChange(callback, monthFilter = null) {
    let query = this.transactionsRef.orderBy('date', 'desc');
    if (monthFilter) {
      query = query.where('date', '>=', monthFilter + '-01').where('date', '<=', monthFilter + '-31');
    }
    return query.onSnapshot(snapshot => {
      const transactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      callback(transactions);
    });
  },

  // Specific operations for attendance
  async updateAttendance(date, studentName, attendanceData) {
    const docRef = this.attendanceRef.doc(date);
    const doc = await docRef.get();
    const currentData = doc.exists ? doc.data() : {};
    
    await docRef.set({
      ...currentData,
      [studentName]: attendanceData,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  async getAttendance(date) {
    const doc = await this.attendanceRef.doc(date).get();
    return doc.exists ? doc.data() : {};
  },

  onAttendanceChange(date, callback) {
    return this.attendanceRef.doc(date).onSnapshot(doc => {
      callback(doc.exists ? doc.data() : {});
    });
  },

  // Additional attendance collections for different user types
  get staffAttendanceRef() { return db.collection('schools').doc(currentSchoolId).collection('staffAttendance'); },
  get adminAttendanceRef() { return db.collection('schools').doc(currentSchoolId).collection('adminAttendance'); },
  get instructorAttendanceRef() { return db.collection('schools').doc(currentSchoolId).collection('instructorAttendance'); },

  async updateAttendanceByType(date, userName, attendanceData, collectionName) {
    let collectionRef;
    switch(collectionName) {
      case 'staffAttendance':
        collectionRef = this.staffAttendanceRef;
        break;
      case 'adminAttendance':
        collectionRef = this.adminAttendanceRef;
        break;
      case 'instructorAttendance':
        collectionRef = this.instructorAttendanceRef;
        break;
      default:
        collectionRef = this.attendanceRef;
    }
    
    const docRef = collectionRef.doc(date);
    const doc = await docRef.get();
    const currentData = doc.exists ? doc.data() : {};
    
    currentData[userName] = attendanceData;
    
    await docRef.set(currentData, { merge: true });
  },

  async getAttendanceByType(date, collectionName) {
    let collectionRef;
    switch(collectionName) {
      case 'staffAttendance':
        collectionRef = this.staffAttendanceRef;
        break;
      case 'adminAttendance':
        collectionRef = this.adminAttendanceRef;
        break;
      case 'instructorAttendance':
        collectionRef = this.instructorAttendanceRef;
        break;
      default:
        collectionRef = this.attendanceRef;
    }
    
    const doc = await collectionRef.doc(date).get();
    return doc.exists ? doc.data() : {};
  },

  // Authentication helpers
  async signIn(email, password) {
    if (!auth) {
      if (!initFirebase()) throw new Error('Firebase is not available. Check your internet connection and reload.');
    }
    try {
      const result = await auth.signInWithEmailAndPassword(email, password);
      return result.user;
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  },

  async signUp(email, password) {
    try {
      const result = await auth.createUserWithEmailAndPassword(email, password);
      return result.user;
    } catch (error) {
      console.error('Sign up error:', error);
      throw error;
    }
  },

  async signOut() {
    try {
      await auth.signOut();
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  },

  onAuthChange(callback) {
    return auth.onAuthStateChanged(callback);
  },
  
  // School management functions
  async createSchool(schoolData) {
    try {
      const docRef = await this.schoolsRef.add({
        ...schoolData,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        status: 'active'
      });
      return { id: docRef.id, ...schoolData };
    } catch (error) {
      console.error('Error creating school:', error);
      throw error;
    }
  },
  
  async getSchool(schoolId) {
    try {
      const doc = await this.schoolsRef.doc(schoolId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Error getting school:', error);
      throw error;
    }
  },
  
  async getUserSchools(userId) {
    try {
      const snapshot = await this.schoolsRef.where('ownerId', '==', userId).get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting user schools:', error);
      throw error;
    }
  },
  
  async getUserMemberSchools(userId) {
    // ── Strategy ──────────────────────────────────────────────────────────────
    // We store a top-level document at /userSchools/{uid} when an admin is
    // created. It contains { schoolIds: [...], roles: { schoolId: role } }.
    // On login we read that single doc (user reads their own → always allowed),
    // then do direct .get() on each school doc (allowed for members).
    // This requires ZERO collection listing and ZERO indexes.
    // ─────────────────────────────────────────────────────────────────────────
    try {
      const userSchools = [];

      // Primary path: read the user's own top-level membership index doc
      let indexDoc;
      try {
        indexDoc = await db.collection('userSchools').doc(userId).get();
      } catch (e) {
        console.warn('Could not read /userSchools/' + userId + ':', e.message);
        indexDoc = null;
      }

      if (indexDoc && indexDoc.exists) {
        const indexData = indexDoc.data();
        const schoolIds = indexData.schoolIds || [];
        const roles = indexData.roles || {};
        const ownerEmails = indexData.ownerEmails || {};

        console.log('getUserMemberSchools index doc found, schools:', schoolIds);

        for (const schoolId of schoolIds) {
          const storedRole = roles[schoolId] || 'office';
          // Normalize: treat 'admin' as 'office' to match login buttons
          const resolvedRole = (storedRole === 'admin') ? 'office' : storedRole;
          
          // Try to fetch school document, but use index data if permission denied
          try {
            const schoolDoc = await this.schoolsRef.doc(schoolId).get();
            if (schoolDoc.exists) {
              userSchools.push({
                id: schoolDoc.id,
                ...schoolDoc.data(),
                userRole: resolvedRole
              });
            }
          } catch (schoolErr) {
            console.warn('Could not fetch school', schoolId, ':', schoolErr.message);
            // Fallback: use minimal data from index for role verification
            userSchools.push({
              id: schoolId,
              userRole: resolvedRole,
              ownerEmail: ownerEmails[schoolId] || null,
              name: 'School (details unavailable)',
              _fromIndex: true
            });
          }
        }
        return userSchools;
      }

      // Fallback: try reading the UID-keyed user doc directly if we know the schoolId
      // from the user's profile (stored during createSchoolWithAdmin).
      // This covers accounts created after the UID-doc fix but before the index doc fix.
      console.log('No /userSchools index doc found for', userId, '— trying direct UID doc fallback');

      // We can't list schools, so try the collectionGroup approach as last resort
      // (requires the index to be deployed via firestore.indexes.json)
      try {
        const userDocsSnap = await db
          .collectionGroup('users')
          .where('userId', '==', userId)
          .get();

        console.log('collectionGroup fallback hits:', userDocsSnap.size);

        for (const userDoc of userDocsSnap.docs) {
          const uData = userDoc.data();
          const schoolId = uData.schoolId;
          if (!schoolId) continue;

          const storedRole = uData.role || uData.userRole || 'office';
          const resolvedRole = (storedRole === 'admin') ? 'office' : storedRole;

          try {
            const schoolDoc = await this.schoolsRef.doc(schoolId).get();
            if (schoolDoc.exists) {
              userSchools.push({
                id: schoolDoc.id,
                ...schoolDoc.data(),
                userRole: resolvedRole
              });

              // Write the index doc now so next login uses the fast path
              try {
                const existing = await db.collection('userSchools').doc(userId).get();
                const existingData = existing.exists ? existing.data() : { schoolIds: [], roles: {}, ownerEmails: {} };
                if (!existingData.schoolIds.includes(schoolId)) {
                  existingData.schoolIds.push(schoolId);
                  existingData.roles[schoolId] = resolvedRole;
                  existingData.ownerEmails[schoolId] = schoolDoc.data().ownerEmail || null;
                  await db.collection('userSchools').doc(userId).set(existingData);
                  console.log('Wrote /userSchools index doc for', userId);
                }
              } catch (idxErr) {
                console.warn('Could not write index doc (non-fatal):', idxErr.message);
              }
            }
          } catch (schoolErr) {
            console.warn('Could not fetch school', schoolId, ':', schoolErr.message);
          }
        }
      } catch (cgErr) {
        console.warn('collectionGroup query failed (index may not be deployed):', cgErr.message);
      }

      return userSchools;
    } catch (error) {
      console.error('Error getting user member schools:', error);
      throw error;
    }
  },
  
  async addUserToSchool(schoolId, userId, role = 'member') {
    try {
      await this.schoolsRef.doc(schoolId).collection('users').doc(userId).set({
        userId,
        role,
        addedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error('Error adding user to school:', error);
      throw error;
    }
  },
  
  async getUserSchoolRole(schoolId, userId) {
    try {
      const doc = await this.schoolsRef.doc(schoolId).collection('users').doc(userId).get();
      return doc.exists ? doc.data().role : null;
    } catch (error) {
      console.error('Error getting user school role:', error);
      throw error;
    }
  },
  
    
  async deleteSchool(schoolId) {
    try {
      const schoolRef = this.schoolsRef.doc(schoolId);
      const schoolDoc = await schoolRef.get();
      const schoolData = schoolDoc.exists ? schoolDoc.data() : {};
      const ownerId = schoolData.ownerId || (currentUser ? currentUser.uid : null);

      const subcollections = [
        'students',
        'transactions',
        'dlTests',
        'attendance',
        'studentAttendance',
        'staffAttendance',
        'adminAttendance',
        'instructorAttendance',
        'schedule',
        'fuel',
        'notifications',
        'users',
        'staff',
        'vehicles'
      ];

      const userDocs = [];
      for (const collectionName of ['users', 'staff']) {
        try {
          const snapshot = await schoolRef.collection(collectionName).get();
          snapshot.docs.forEach(doc => {
            const userId = doc.data().userId || doc.data().firebaseId || doc.id;
            if (userId) userDocs.push(userId);
          });
        } catch (e) {
          console.warn('Could not collect membership docs from', collectionName, e.message);
        }
      }

      for (const collectionName of subcollections) {
        await this.deleteCollection(schoolRef.collection(collectionName));
      }

      for (const userId of [...new Set(userDocs)]) {
        try {
          await db.collection('userSchools').doc(userId).set({
            schoolIds: firebase.firestore.FieldValue.arrayRemove(schoolId),
            roles: { [schoolId]: firebase.firestore.FieldValue.delete() },
            ownerEmails: { [schoolId]: firebase.firestore.FieldValue.delete() },
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (e) {
          console.warn('Could not remove school from userSchools index for', userId, e.message);
        }
      }

      await schoolRef.delete();

      if (ownerId) {
        try {
          await db.collection('userSchools').doc(ownerId).set({
            schoolIds: firebase.firestore.FieldValue.arrayRemove(schoolId),
            roles: { [schoolId]: firebase.firestore.FieldValue.delete() },
            ownerEmails: { [schoolId]: firebase.firestore.FieldValue.delete() },
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (e) {
          console.warn('Could not update owner userSchools index:', e.message);
        }
      }
      return true;
    } catch (error) {
      console.error('Error deleting school:', error);
      throw error;
    }
  },

  async deleteOwnerData(ownerId, ownerEmail = null) {
    try {
      if (!ownerId && !ownerEmail) {
        throw new Error('Owner id or owner email is required');
      }

      const schoolsByOwnerId = ownerId
        ? await this.schoolsRef.where('ownerId', '==', ownerId).get()
        : { docs: [] };
      const schoolsByOwnerEmail = ownerEmail
        ? await this.schoolsRef.where('ownerEmail', '==', ownerEmail).get()
        : { docs: [] };

      const schools = new Map();
      [...schoolsByOwnerId.docs, ...schoolsByOwnerEmail.docs].forEach(doc => {
        schools.set(doc.id, { id: doc.id, ...doc.data() });
      });

      for (const schoolId of schools.keys()) {
        await this.deleteSchool(schoolId);
      }

      if (ownerEmail) {
        await db.collection('Owners').doc(ownerEmail.trim()).delete();
      }
      if (ownerId) {
        try {
          await db.collection('userSchools').doc(ownerId).delete();
        } catch (e) {
          console.warn('Could not delete owner userSchools index:', e.message);
        }
      }

      return { deletedSchools: schools.size };
    } catch (error) {
      console.error('Error deleting owner data:', error);
      throw error;
    }
  }
};

// ============================================================
// SAAS SCHOOL MANAGEMENT
// ============================================================

// Load user's owned schools
async function loadUserSchools() {
  try {
    if (!currentUser) return;
    
    userSchools = await FirebaseService.getUserSchools(currentUser.uid);
    
    const schoolSelect = document.getElementById('school-select');
    schoolSelect.innerHTML = '<option value="">Select your school...</option>';
    
    userSchools.forEach(school => {
      const option = document.createElement('option');
      option.value = school.id;
      option.textContent = school.name;
      schoolSelect.appendChild(option);
    });
    
  } catch (error) {
    console.error('Error loading user schools:', error);
  }
}

// Load schools where user is a member (for office/instructor roles)
async function loadUserMemberSchools() {
  try {
    if (!currentUser) return;
    
    userSchools = await FirebaseService.getUserMemberSchools(currentUser.uid);
    const memberSchools = userSchools; // Keep for UI updates
    
    const schoolSelect = document.getElementById('school-select');
    schoolSelect.innerHTML = '<option value="">Select your school...</option>';
    
    if (memberSchools.length === 0) {
      // No schools found, show message
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No schools available';
      option.disabled = true;
      schoolSelect.appendChild(option);
    } else {
      memberSchools.forEach(school => {
        const option = document.createElement('option');
        option.value = school.id;
        option.textContent = school.name;
        if (school.userRole) {
          option.textContent += ` (${school.userRole})`;
        }
        schoolSelect.appendChild(option);
      });
    }
    
  } catch (error) {
    console.error('Error loading user member schools:', error);
  }
}

// ============================================================
// DATA STORE (Firebase-backed)
// ============================================================

const COLORS = ['#3b82f6','#8b5cf6','#ec4899','#f97316','#10b981','#14b8a6','#f59e0b'];

// Firebase-backed data store
let data = {
  students: [],
  transactions: [],
  dlTests: [],
  fuel: [],
  schedule: {},
  dailySchedule: {},
  attendance: {},
  staffAttendance: {},
  adminAttendance: {},
  instructorAttendance: {},
  admins: [],
  staff: [],
  instructors: [],
  vehicles: [],
  notifications: [],
  otherServices: [],
  studentAttendanceRecords: []
};

// Real-time listeners array to cleanup later
const listeners = [];

// Load initial data from Firebase
async function loadInitialData() {
  // Helper: tag incoming items with current school and merge (removes old entries for this school)
  function mergeSchoolData(existing, incoming, schoolId) {
    const tagged = incoming.map(item => ({ ...item, schoolId: item.schoolId || schoolId }));
    const others = (existing || []).filter(item => item.schoolId && item.schoolId !== schoolId);
    return [...others, ...tagged];
  }
  const sid = currentSchoolId;

  try {
    // Load data based on user role
    if (currentRole === 'owner') {
      // Owner loads all data — scoped to the currently selected school
      const [students, transactions, dlTests, fuel, notifications] = await Promise.allSettled([
        FirebaseService.getStudents(),
        FirebaseService.getTransactions(),
        FirebaseService.getDocuments(FirebaseService.dlTestsRef),
        FirebaseService.getDocuments(FirebaseService.fuelRef),
        FirebaseService.getDocuments(FirebaseService.notificationsRef)
      ]);
      if (students.status === 'fulfilled')      data.students      = mergeSchoolData(data.students,      students.value,      sid);
      if (transactions.status === 'fulfilled')  data.transactions  = mergeSchoolData(data.transactions,  transactions.value,  sid);
      if (dlTests.status === 'fulfilled')       data.dlTests       = mergeSchoolData(data.dlTests,       dlTests.value,       sid);
      if (fuel.status === 'fulfilled')          data.fuel          = mergeSchoolData(data.fuel,          fuel.value,          sid);
      if (notifications.status === 'fulfilled') data.notifications = mergeSchoolData(data.notifications, notifications.value, sid);
    } else if (currentRole === 'office') {
      const [students, transactions, dlTests, notifications] = await Promise.allSettled([
        FirebaseService.getStudents(),
        FirebaseService.getTransactions(),
        FirebaseService.getDocuments(FirebaseService.dlTestsRef),
        FirebaseService.getDocuments(FirebaseService.notificationsRef)
      ]);
      if (students.status === 'fulfilled')      data.students      = mergeSchoolData(data.students,      students.value,      sid);
      if (transactions.status === 'fulfilled')  data.transactions  = mergeSchoolData(data.transactions,  transactions.value,  sid);
      if (dlTests.status === 'fulfilled')       data.dlTests       = mergeSchoolData(data.dlTests,       dlTests.value,       sid);
      if (notifications.status === 'fulfilled') data.notifications = mergeSchoolData(data.notifications, notifications.value, sid);
    } else if (currentRole === 'instructor') {
      const [students, fuel] = await Promise.allSettled([
        FirebaseService.getStudents(),
        FirebaseService.getDocuments(FirebaseService.fuelRef)
      ]);
      if (students.status === 'fulfilled') data.students = mergeSchoolData(data.students, students.value, sid);
      if (fuel.status === 'fulfilled')     data.fuel     = mergeSchoolData(data.fuel,     fuel.value,     sid);
    }

    // Load today's attendance (all roles need this)
    const today = new Date().toISOString().split('T')[0];
    try {
      data.attendance[today] = await FirebaseService.getAttendance(today);
    } catch (e) {
      console.warn('Could not load attendance:', e.message);
      data.attendance[today] = [];
    }

    try {
      data.adminAttendance[today] = await FirebaseService.getAttendanceByType(today, 'adminAttendance');
    } catch (e) {
      console.warn('Could not load admin attendance:', e.message);
      data.adminAttendance[today] = {};
    }

    try {
      data.instructorAttendance[today] = await FirebaseService.getAttendanceByType(today, 'instructorAttendance');
    } catch (e) {
      console.warn('Could not load instructor attendance:', e.message);
      data.instructorAttendance[today] = {};
    }
    
    // Load schedule entries for all days
    try {
      const scheduleSnapshot = await FirebaseService.scheduleRef.get();
      scheduleSnapshot.forEach(doc => {
        data.dailySchedule[doc.id] = doc.data();
      });
    } catch (e) {
      console.warn('Could not load schedule:', e.message);
    }
    
    console.log('Initial data loaded from Firebase');
  } catch (error) {
    console.error('Error loading initial data:', error);
  }
}

// Setup real-time listeners
function setupRealtimeListeners() {
  // Non-owner roles get targeted listeners only (students, attendance, schedule)
  
  // Clear existing listeners
  listeners.forEach(unsubscribe => unsubscribe());
  listeners.length = 0;
  
  // Students listener — only replaces data for currentSchoolId, preserves other schools
  try {
    const _listenSchoolId = currentSchoolId;
    const studentsUnsubscribe = FirebaseService.onStudentsChange(students => {
      // Tag each incoming student with the school we were listening to
      const tagged = students.map(s => ({ ...s, schoolId: s.schoolId || _listenSchoolId }));
      // Remove stale entries for this school, keep entries from other schools
      const others = (data.students || []).filter(s => s.schoolId && s.schoolId !== _listenSchoolId);
      data.students = [...others, ...tagged];
      if (currentPage === 'all-students' || currentPage === 'dashboard' || currentPage === 'my-students') {
        renderStudentsTable();
        renderDashboard();
        renderInstructorStudents();
      }
    });
    listeners.push(studentsUnsubscribe);
  } catch (e) {
    console.warn('Could not setup students listener:', e.message);
  }
  
  // Transactions listener — same school-scoped merge pattern
  if (currentRole === 'owner' || currentRole === 'office') {
    try {
      const _listenSchoolId = currentSchoolId;
      const transactionsUnsubscribe = FirebaseService.onTransactionsChange(transactions => {
        const tagged = transactions.map(t => ({ ...t, schoolId: t.schoolId || _listenSchoolId }));
        const others = (data.transactions || []).filter(t => t.schoolId && t.schoolId !== _listenSchoolId);
        data.transactions = [...others, ...tagged];
        if (currentPage === 'cashflow' || currentPage === 'dashboard') {
          renderCashflow();
          renderDashboard();
        }
      });
      listeners.push(transactionsUnsubscribe);
    } catch (e) {
      console.warn('Could not setup transactions listener:', e.message);
    }
  }
  
  // Today's attendance listener (owner only)
  try {
    const today = new Date().toISOString().split('T')[0];
    const attendanceUnsubscribe = FirebaseService.onAttendanceChange(today, attendance => {
      data.attendance[today] = attendance;
      if (currentPage === 'attendance' || currentPage === 'dashboard') {
        renderAttendance();
        renderDashboard();
      }
    });
    listeners.push(attendanceUnsubscribe);
  } catch (e) {
    console.warn('Could not setup attendance listener:', e.message);
  }

  // Admin/instructor attendance listener for today's self-attendance check
  try {
    const today = new Date().toISOString().split('T')[0];
    const adminAttendanceUnsubscribe = FirebaseService.schoolsRef.doc(currentSchoolId)
      .collection('adminAttendance')
      .doc(today)
      .onSnapshot(snapshot => {
        data.adminAttendance[today] = snapshot.exists ? snapshot.data() : {};
        if (currentPage === 'class-schedule' || currentPage === 'dashboard') {
          renderSchedule();
          renderDashboard();
        }
      }, error => {
        console.warn('Admin attendance snapshot failed:', error.message);
      });
    listeners.push(adminAttendanceUnsubscribe);

    const instructorAttendanceUnsubscribe = FirebaseService.schoolsRef.doc(currentSchoolId)
      .collection('instructorAttendance')
      .doc(today)
      .onSnapshot(snapshot => {
        data.instructorAttendance[today] = snapshot.exists ? snapshot.data() : {};
        if (currentPage === 'class-schedule' || currentPage === 'dashboard') {
          renderSchedule();
          renderDashboard();
        }
      }, error => {
        console.warn('Instructor attendance snapshot failed:', error.message);
      });
    listeners.push(instructorAttendanceUnsubscribe);
  
    // Schedule listener: keep local daily schedule in sync for current school
    try {
      const scheduleUnsubscribe = FirebaseService.scheduleRef.onSnapshot(snapshot => {
        // Refresh local dailySchedule map for this school
        const ids = [];
        snapshot.docs.forEach(doc => {
          ids.push(doc.id);
          data.dailySchedule[doc.id] = doc.data();
        });
        // Remove any local entries that no longer exist
        Object.keys(data.dailySchedule).forEach(k => { if (!ids.includes(k)) delete data.dailySchedule[k]; });
        if (currentPage === 'class-schedule' || currentPage === 'dashboard') {
          try { renderSchedule(); } catch(e){}
          try { renderDashboard(); } catch(e){}
        }
        // If this is an instructor user, update their student list when schedule changes
        try {
          if (currentRole === 'instructor') renderInstructorStudents();
        } catch (e) {}
      }, error => {
        console.warn('Schedule snapshot failed:', error.message);
      });
      listeners.push(scheduleUnsubscribe);
    } catch (e) {
      console.warn('Could not setup schedule listener:', e.message);
    }
  } catch (e) {
    console.warn('Could not setup self-attendance listeners:', e.message);
  }
  
  // Notifications listener (owner only)
  try {
    const notificationsUnsubscribe = FirebaseService.onDocumentsChange(FirebaseService.notificationsRef, notifications => {
      data.notifications = notifications;
      if (currentPage === 'notifications') {
        renderNotifications();
      }
    }, 'createdAt', 'desc');
    listeners.push(notificationsUnsubscribe);
  } catch (e) {
    console.warn('Could not setup notifications listener:', e.message);
  }
  
  // Admins listener (only if current school is selected)
  if (currentSchoolId && currentRole === 'owner') {
    const adminsUnsubscribe = FirebaseService.schoolsRef.doc(currentSchoolId).collection('users').onSnapshot(snapshot => {
      const firebaseAdmins = snapshot.docs.map(doc => ({ id: doc.id, firebaseId: doc.id, ...doc.data() }));
      // Ignore stale empty flush that fires when a previous listener is unsubscribed
      if (firebaseAdmins.length === 0 && data.admins.length > 0) return;
      data.admins = firebaseAdmins;
      if (currentPage === 'admin-management') renderAdminsTable();
    }, error => {
      console.error('Error in admins listener:', error);
    });
    listeners.push(adminsUnsubscribe);
  }
  
  // Staff listener (only if current school is selected)
  if (currentSchoolId && (currentRole === 'owner' || currentRole === 'office')) {
    const staffUnsubscribe = FirebaseService.schoolsRef.doc(currentSchoolId).collection('staff').onSnapshot(snapshot => {
      const firebaseStaff = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Ignore stale empty flush that fires when a previous listener is unsubscribed
      if (firebaseStaff.length === 0 && data.staff.length > 0) return;
      data.staff = firebaseStaff;
      if (currentPage === 'staff-management') renderStaffTable();
    }, error => {
      console.error('Error in staff listener:', error);
    });
    listeners.push(staffUnsubscribe);
  }
}

// ============================================================
// NAVIGATION CONFIG
// ============================================================
const navConfig = {
  owner: [
    {section:'Overall', items:[
      {id:'overall-dashboard',icon:'&#127759;',label:'All Schools'},
      {id:'overall-students',icon:'&#128101;',label:'All Students'},
      {id:'overall-cashflow',icon:'&#128176;',label:'All Revenue'},
      {id:'overall-reports',icon:'&#128200;',label:'All Reports'},
    ]},
    {section:'Current School', items:[
      {id:'school-selector',icon:'&#128179;',label:'Select School'},
      {id:'dashboard',icon:'&#128202;',label:'Dashboard'},
      {id:'all-students',icon:'&#128101;',label:'All Students'},
      {id:'cashflow',icon:'&#128176;',label:'Cash Flow'},
      {id:'other-services',icon:'&#128222;',label:'Other Services'},
      {id:'student-tracking',icon:'&#128205;',label:'Student Tracking'},
      {id:'reports',icon:'&#128200;',label:'Reports'},
      {id:'admin-management',icon:'&#128100;',label:'Admin Management'},
      {id:'staff-management',icon:'&#128104;',label:'Staff Management'},
    ]},
    {section:'Fleet Management', items:[
      {id:'owner-fuel',icon:'&#9981;',label:'Fuel Dashboard'},
      {id:'vehicles',icon:'&#128663;',label:'Vehicles'},
      {id:'owner-attendance',icon:'&#9989;',label:'Attendance Management'},
    ]},
  ],
  office: [
    {section:'Overview', items:[
      {id:'dashboard',icon:'&#128202;',label:'Dashboard'},
      {id:'all-students',icon:'&#128101;',label:'All Students'},
      {id:'cashflow',icon:'&#128176;',label:'Cash Flow'},
      {id:'other-services',icon:'&#128222;',label:'Other Services'},
      {id:'reports',icon:'&#128200;',label:'Reports'},
    ]},
    {section:'Operations', items:[
      {id:'add-student',icon:'&#43;',label:'Enroll Student'},
      {id:'dl-tests',icon:'&#128990;',label:'DL Tests'},
      {id:'notifications',icon:'&#128226;',label:'Notifications'},
      {id:'office-attendance',icon:'&#9989;',label:'My Attendance'},
      {id:'owner-attendance',icon:'&#128202;',label:'Staff Attendance'},
      {id:'staff-management',icon:'&#128104;',label:'Staff Management'},
    ]},
  ],
  instructor: [
    {section:'My Teaching', items:[
      {id:'dashboard',icon:'&#128202;',label:'Dashboard'},
      {id:'my-students',icon:'&#128100;',label:'My Students'},
      {id:'class-schedule',icon:'&#128197;',label:'Class Schedule'},
      {id:'attendance',icon:'&#9989;',label:'Attendance'},
    ]},
    {section:'Vehicle', items:[
      {id:'petrol',icon:'&#26fd;',label:'Petrol Log'},
    ]},
  ]
};

const roleLabels = {owner:'Owner',office:'Office',instructor:'Instructor'};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

// Email validation function
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// ============================================================
// ROLE VERIFICATION & ACCESS CONTROL
// ============================================================

// Verify user role from database (prevents UI manipulation)
async function verifyUserRole(userId, selectedRole) {
  console.log('verifyUserRole called with userId:', userId, 'selectedRole:', selectedRole);
  try {
    if (selectedRole === 'owner') {
      console.log('Checking owner role for user:', userId);
      
      // Get user email to check against owners collection
      const user = await FirebaseService.getCurrentUser();
      console.log('Current user object:', user);
      const userEmail = user ? user.email : null;
      console.log('User email for verification:', userEmail);
      
      if (!userEmail) {
        console.log('Owner access denied: no email found');
        return null;
      }
      
      // Check if user email exists in owners collection
      try {
        console.log('Checking owners collection for document ID:', userEmail);
        const ownerDoc = await db.collection('Owners').doc(userEmail.trim()).get();
        console.log('Owner document exists:', ownerDoc.exists);
        console.log('Owner document data:', ownerDoc.data());
        
        if (ownerDoc.exists) {
          console.log('Owner found in collection, validating subscription...');
          // Validate subscription for owner
          await validateSubscriptionForRole(userId, userEmail, 'owner');
          console.log('Owner access granted for email:', userEmail);
          return 'owner';
        } else {
          console.log('Owner access denied: email not in owners list:', userEmail);
          // Try to list all owners to debug
          const allOwners = await db.collection('Owners').get();
          console.log('All owners in collection:', allOwners.docs.map(doc => doc.id));
          return null;
        }
      } catch (error) {
        console.error('Error checking owners collection:', error);
        // Re-throw subscription-related errors so they can be handled properly
        if (error.message && (error.message.includes('subscription') || error.message.includes('incomplete') || error.message.includes('setup'))) {
          throw error;
        }
        return null;
      }
    } else {
      console.log('Checking non-owner role:', selectedRole, 'for user:', userId);
      // Check if user is assigned as office/instructor in any school
      const memberSchools = await FirebaseService.getUserMemberSchools(userId);
      console.log('Member schools for user', userId, ':', memberSchools);
      console.log('Looking for role:', selectedRole, 'in schools:', memberSchools);
      
      // Check if user has the selected role in any school
      let hasRole = memberSchools.some(school => {
        console.log('Checking school:', school.id, '| stored userRole:', school.userRole, '| selected:', selectedRole);
        // Match exact role, or treat 'admin' stored value as 'office'
        const storedRole = school.userRole === 'admin' ? 'office' : school.userRole;
        return storedRole === selectedRole;
      });
      
      // Fallback: back-fill users subcollection for staff created before the dual-write fix.
      // Triggered when: no schools at all, OR all schools are _fromIndex (school doc unreadable,
      // meaning the users/{uid} doc is missing so Firestore rules block school reads).
      const needsBackfill = memberSchools.length === 0 ||
        memberSchools.every(s => s._fromIndex);
      if (needsBackfill) {
        console.log('No member schools found via userSchools index — trying staff subcollection fallback');
        try {
          const staffSnap = await db.collectionGroup('staff').where('userId', '==', userId).get();
          if (!staffSnap.empty) {
            for (const staffDoc of staffSnap.docs) {
              const staffData = staffDoc.data();
              const schoolId = staffData.schoolId || staffDoc.ref.parent.parent.id;
              const staffRole = staffData.role === 'instructor' ? 'instructor' : 'office';
              if (staffRole === selectedRole && schoolId) {
                console.log('Found staff record in schools/' + schoolId + '/staff, role:', staffRole);
                // Back-fill the users subcollection and userSchools index so future logins use the fast path
                const ownerEmail = staffData.ownerEmail || null;
                try {
                  await db.collection('schools').doc(schoolId).collection('users').doc(userId).set({
                    userId,
                    role: staffRole,
                    userRole: staffRole,
                    name: staffData.name,
                    email: staffData.email,
                    schoolId,
                    status: 'active',
                    addedAt: firebase.firestore.FieldValue.serverTimestamp()
                  }, { merge: true });
                  await db.collection('userSchools').doc(userId).set({
                    schoolIds: firebase.firestore.FieldValue.arrayUnion(schoolId),
                    roles: { [schoolId]: staffRole },
                    ownerEmails: { [schoolId]: ownerEmail },
                    updatedAt: new Date().toISOString()
                  }, { merge: true });
                  console.log('Back-filled users doc and userSchools index for staff user', userId);
                } catch (backfillErr) {
                  console.warn('Back-fill failed (non-fatal):', backfillErr.message);
                }
                hasRole = true;
                // Reload memberSchools so currentSchoolId can be set downstream
                const reloaded = await FirebaseService.getUserMemberSchools(userId);
                userSchools = reloaded.length > 0 ? reloaded : [{ id: schoolId, userRole: staffRole }];
                break;
              }
            }
          }
        } catch (staffFallbackErr) {
          console.warn('Staff subcollection fallback failed (index may not be deployed):', staffFallbackErr.message);
        }
      }
      
      console.log('Has role result:', hasRole);
      
      if (hasRole) {
        console.log('Role found, validating subscription...');
        // Get user email for subscription validation
        const user = await FirebaseService.getCurrentUser();
        const userEmail = user ? user.email : null;
        
        if (userEmail) {
          // Validate subscription for staff/admin
          await validateSubscriptionForRole(userId, userEmail, selectedRole);
          console.log('Subscription validated for', selectedRole, ':', userEmail);
          return selectedRole;
        } else {
          console.log('No email found for subscription validation');
          return null;
        }
      }
      
      return null;
    }
  } catch (error) {
    console.error('Error verifying user role:', error);
    // Re-throw subscription-related errors so they can be handled properly
    if (error.message && (error.message.includes('subscription') || error.message.includes('incomplete') || error.message.includes('setup'))) {
      throw error;
    }
    return null;
  }
}

// Check if user has permission to access a specific page
function hasPageAccess(pageId) {
  if (!currentRole || !currentUser) return false;
  
  const rolePermissions = {
    owner: [
      'overall-dashboard', 'overall-students', 'overall-cashflow', 'overall-reports',
      'school-selector', 'dashboard', 'all-students', 'cashflow', 'reports', 'admin-management', 'staff-management',
      'owner-fuel', 'vehicles', 'owner-attendance'
    ],
    office: [
      'dashboard', 'all-students', 'cashflow', 'reports',
      'dl-tests', 'notifications', 'office-attendance', 'owner-attendance', 'class-schedule', 'instructor', 'staff-management'
    ],
    instructor: [
      'dashboard', 'my-students', 'class-schedule', 'attendance', 'petrol'
    ]
  };
  
  return rolePermissions[currentRole].includes(pageId);
}

// Check owner subscription and show renewal message if needed
async function checkOwnerSubscription(userEmail) {
  try {
    const ownerDoc = await db.collection('Owners').doc(userEmail.trim()).get();
    if (!ownerDoc.exists) {
      return { valid: false, message: 'You are not authorized for this role' };
    }
    
    const ownerData = ownerDoc.data();
    console.log('Owner data for subscription check:', ownerData);
    
    // Check if document has subscription fields
    if (!ownerData || Object.keys(ownerData).length === 0) {
      return { valid: false, message: 'Your subscription information is incomplete. Please contact support to complete your subscription setup.' };
    }
    
    if (ownerData.subscriptionStatus !== 'active' || !ownerData.subscriptionExpiry) {
      return { valid: false, message: 'Please renew your subscription to continue.' };
    }
    
    const expiryDate = new Date(ownerData.subscriptionExpiry);
    const currentDate = new Date();
    
    if (expiryDate <= currentDate) {
      return { valid: false, message: 'Your subscription has expired. Please renew your subscription to continue.' };
    }
    
    return { valid: true };
  } catch (error) {
    console.error('Error checking subscription:', error);
    return { valid: false, message: 'Error checking subscription status' };
  }
}

// Check subscription for any user (owner, staff, admin) based on their school
async function checkUserSubscription(userId, userEmail, selectedRole) {
  try {
    if (selectedRole === 'owner') {
      // For owners, check their direct subscription
      return await checkOwnerSubscription(userEmail);
    } else {
      // For staff/admin, check their school's subscription (linked to owner)
      const memberSchools = await FirebaseService.getUserMemberSchools(userId);
      
      if (memberSchools.length === 0) {
        return { valid: false, message: 'You are not assigned to any school' };
      }
      
      // Check subscription for the first school (all schools under same owner should have same subscription)
      const school = memberSchools[0];
      const schoolDoc = await db.collection('schools').doc(school.id).get();
      
      if (!schoolDoc.exists) {
        return { valid: false, message: 'School not found' };
      }
      
      const schoolData = schoolDoc.data();
      const ownerEmail = schoolData.ownerEmail || schoolData.createdBy;
      
      if (!ownerEmail) {
        return { valid: false, message: 'Unable to verify school subscription' };
      }
      
      // Check the owner's subscription
      const ownerSubscription = await checkOwnerSubscription(ownerEmail);
      
      if (!ownerSubscription.valid) {
        return { valid: false, message: `School subscription issue: ${ownerSubscription.message}` };
      }
      
      return { valid: true };
    }
  } catch (error) {
    console.error('Error checking user subscription:', error);
    return { valid: false, message: 'Error checking subscription status' };
  }
}

// Enhanced subscription validation for all user types
async function validateSubscriptionForRole(userId, userEmail, selectedRole) {
  console.log(`Validating subscription for ${selectedRole}: ${userEmail}`);
  
  let ownerEmail = null;
  
  if (selectedRole === 'owner') {
    // For owners, check their own pause status
    ownerEmail = userEmail;
    console.log(`User is owner, checking pause list for: ${ownerEmail}`);
  } else {
    // For non-owners, find their associated owner
    console.log(`User is ${selectedRole}, finding associated owner...`);
    try {
      const memberSchools = await FirebaseService.getUserMemberSchools(userId);
      console.log(`Member schools for ${userEmail}:`, memberSchools);
      
      if (memberSchools.length > 0) {
        // Get the owner from the first school they belong to
        const school = memberSchools[0];
        ownerEmail = school.ownerEmail || school.email; // Try to get owner email from school
        console.log(`Found associated owner for ${selectedRole}: ${ownerEmail}`);
      } else {
        console.log(`No schools found for ${selectedRole} ${userEmail}, skipping subscription check`);
        return true;
      }
    } catch (error) {
      console.log(`Error finding owner for ${selectedRole} ${userEmail}: ${error.message}`);
      return true; // Allow login if we can't determine owner
    }
  }
  
  if (!ownerEmail) {
    console.log(`No owner email found for ${selectedRole} ${userEmail}, skipping subscription check`);
    return true;
  }
  
  // Check if the owner is in pause list
  let isOwnerOnpause = false;
  try {
    // Try UID-based lookup first
    const ownerUid = userId; // Use the current user's UID
    const onpauseDoc = await db.collection('onpause').doc(ownerUid).get();
    isOwnerOnpause = onpauseDoc.exists;
    console.log(`Owner UID ${ownerUid} is in pause list: ${isOwnerOnpause}`);
    
    // If not found by UID, try email-based lookup for backward compatibility
    if (!isOwnerOnpause && ownerEmail) {
      const emailOnpauseDoc = await db.collection('onpause').doc(ownerEmail).get();
      isOwnerOnpause = emailOnpauseDoc.exists;
      console.log(`Owner email ${ownerEmail} is in pause list: ${isOwnerOnpause}`);
    }
  } catch (error) {
    console.log(`Error checking pause list for owner ${ownerEmail}: ${error.message}`);
    // If we can't check the pause list, assume owner is NOT in pause list (allow normal login)
    isOwnerOnpause = false;
    console.log(`Assuming owner ${ownerEmail} is not in pause list due to permission error`);
  }
  
  // Only check subscription if the owner is in the pause list
  if (isOwnerOnpause) {
    console.log(`Owner ${ownerEmail} is in pause list, checking subscription...`);
    const subscriptionCheck = await checkUserSubscription(userId, ownerEmail, 'owner');
    
    if (!subscriptionCheck.valid) {
      const userRoleText = selectedRole === 'owner' ? 'Your' : `Your owner's`;
      console.log(`Subscription validation failed: ${subscriptionCheck.message}`);
      throw new Error(`${userRoleText} subscription is incomplete. Please contact support to complete the subscription setup.`);
    }
    
    console.log(`Subscription validation passed for owner in pause list: ${ownerEmail}`);
  } else {
    console.log(`Owner ${ownerEmail} is not in pause list - allowing normal login`);
  }
  
  return true;
}

// Show subscription renewal modal
function showSubscriptionRenewal(message, selectedRole = null) {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
    background: rgba(0,0,0,0.5); display: flex; align-items: center; 
    justify-content: center; z-index: 10000;
  `;
  
  modal.innerHTML = `
    <div style="background: white; padding: 40px; border-radius: 15px; max-width: 450px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">
      <div style="width: 60px; height: 60px; background: #fef3c7; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
        <svg width="30" height="30" fill="#f59e0b" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/>
        </svg>
      </div>
      <h3 style="color: #333; margin-bottom: 15px; font-size: 24px;">Subscription Required</h3>
      <p style="color: #666; margin-bottom: 25px; line-height: 1.5;">${message}</p>
      
      <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 25px; text-align: left;">
        <p style="color: #475569; margin: 0; font-size: 14px;"><strong>Next steps:</strong></p>
        <ul style="color: #64748b; margin: 8px 0 0 20px; font-size: 13px;">
          <li>Contact your administrator</li>
          <li>Renew your subscription plan</li>
          <li>Check your payment status</li>
        </ul>
      </div>
      
      <div style="display: flex; justify-content: center;">
        <button onclick="this.closest('div').parentElement.remove()" style="background: #3b82f6; color: white; padding: 12px 24px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px;">OK</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Check if user is in onpause collection and update modal buttons
  const userId = currentUser ? currentUser.uid : null;
  if (userId) {
    updateModalForOnpauseUsers(userId, selectedRole);
  }
}

// Check if user is owner and in pause list, then update modal accordingly
async function updateModalForOnpauseUsers(userId, selectedRole) {
  // Find the modal and update to show only OK button
  const modal = document.querySelector('[style*="position: fixed"]');
  if (modal) {
    const buttonContainer = modal.querySelector('div[style*="display: flex"]');
    if (buttonContainer) {
      // Always show only OK button for all users
      buttonContainer.innerHTML = `
        <button onclick="this.closest('div').parentElement.remove()" style="background: #3b82f6; color: white; padding: 12px 24px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px;">OK</button>
      `;
    }
  }
}



// Check if user has permission to perform an action
function hasActionPermission(action, data = {}) {
  if (!currentRole || !currentUser) return false;
  
  switch (action) {
    case 'create_school':
      return currentRole === 'owner';
    
    case 'delete_school':
      return currentRole === 'owner';
    
    case 'add_admin':
      return currentRole === 'owner';
    
    case 'edit_admin':
      return currentRole === 'owner';
    
    case 'remove_admin':
      return currentRole === 'owner';
    
    case 'manage_users':
      return currentRole === 'owner';
    
    case 'add_student':
      return currentRole === 'owner' || currentRole === 'office';
    
    case 'edit_student':
      if (currentRole === 'owner' || currentRole === 'office') return true;
      if (currentRole === 'instructor' && data.instructorEmail === currentUser.email) return true;
      return false;
    
    case 'delete_student':
      return currentRole === 'owner' || currentRole === 'office';
    
    case 'add_transaction':
      return currentRole === 'owner' || currentRole === 'office';
    
    case 'edit_transaction':
      return currentRole === 'owner' || currentRole === 'office';
    
    case 'delete_transaction':
      return currentRole === 'owner' || currentRole === 'office';
    
    case 'mark_attendance':
      // ALL users require location verification for attendance marking
      if (!data.checkLocation) return true;
      return checkLocationForAttendance();
    
    case 'view_reports':
      return currentRole === 'owner' || currentRole === 'office';
    
    case 'add_fuel_entry':
      return currentRole === 'owner' || currentRole === 'office' || currentRole === 'instructor';
    
    case 'add_staff':
      return currentRole === 'owner' || currentRole === 'office';
    
    case 'edit_staff':
      return currentRole === 'owner' || currentRole === 'office';
    
    case 'delete_staff':
      return currentRole === 'owner' || currentRole === 'office';
    
    default:
      return false;
  }
}

// Check if user is within 100m radius of school for attendance marking
async function checkLocationForAttendance() {
  try {
    // Get current user location
    const userLocation = await LocationService.getCurrentLocation();
    
    // Get current school data
    if (!currentSchoolId) {
      console.error('No school selected');
      return false;
    }
    
    // Find the current school from userSchools
    const currentSchool = userSchools.find(school => school.id === currentSchoolId);
    if (!currentSchool || !currentSchool.latitude || !currentSchool.longitude) {
      console.error('School location not set');
      return false;
    }
    
    // Check if user is within 100m radius
    const isWithinRadius = LocationService.isWithinSchoolRadius(
      userLocation.latitude,
      userLocation.longitude,
      currentSchool.latitude,
      currentSchool.longitude,
      100 // 100 meters
    );
    
    if (!isWithinRadius) {
      const distance = LocationService.calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        currentSchool.latitude,
        currentSchool.longitude
      );
      console.log(`User is ${Math.round(distance)}m away from school (need to be within 100m)`);
    }
    
    return isWithinRadius;
  } catch (error) {
    console.error('Error checking location for attendance:', error);
    return false;
  }
}

// Restrict UI elements based on user role
function restrictUIByRole() {
  if (!currentRole) return;
  
  // Hide/show navigation items based on role
  document.querySelectorAll('.nav-item').forEach(item => {
    const pageId = item.id.replace('nav-', '');
    if (!hasPageAccess(pageId)) {
      item.style.display = 'none';
    } else {
      item.style.display = 'flex';
    }
  });
  
  // Restrict action buttons
  document.querySelectorAll('[data-action]').forEach(button => {
    const action = button.dataset.action;
    if (!hasActionPermission(action)) {
      button.style.display = 'none';
      button.disabled = true;
    } else {
      button.style.display = 'inline-flex';
      button.disabled = false;
    }
  });
  
  // Restrict form inputs
  document.querySelectorAll('input[data-permission], select[data-permission], button[data-permission]').forEach(element => {
    const permission = element.dataset.permission;
    if (!hasActionPermission(permission)) {
      element.disabled = true;
      element.style.opacity = '0.5';
      element.style.cursor = 'not-allowed';
    } else {
      element.disabled = false;
      element.style.opacity = '1';
      element.style.cursor = 'pointer';
    }
  });
}

// ============================================================
// LOGIN / LOGOUT
// ============================================================
function selectRole(role) {
  currentRole = role;
  ['owner','office','instructor'].forEach(r => {
    document.getElementById('role-'+r).classList.toggle('active', r===role);
  });
}
async function doLogin() {
  // Get current role from UI
  const activeRole = document.querySelector('.role-btn.active');
  const selectedRole = activeRole ? activeRole.id.replace('role-', '') : 'owner';
  
  // Show loading state
  const loginBtn = document.querySelector('.btn-login');
  const originalText = loginBtn.textContent;
  loginBtn.textContent = 'Signing In...';
  loginBtn.disabled = true;
  
  try {
    
    // Get credentials
    const email = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;
    
    if (!email || !password) {
      throw new Error('Please enter email and password');
    }
    
    // Sign in with Firebase
    const user = await FirebaseService.signIn(email, password);
    await handleUserLoggedIn(user, selectedRole, loginBtn, originalText);
    
  } catch (error) {
    console.error('Login error:', error);
    console.log('Error message:', error.message);
    console.log('Error includes subscription keywords:', error.message && (error.message.includes('subscription') || error.message.includes('incomplete') || error.message.includes('setup')));
    
    let errorMessage = 'Login failed. Please try again.';
    
    if (error.code === 'auth/user-not-found') {
      errorMessage = 'User not found. Please check your email.';
    } else if (error.code === 'auth/wrong-password') {
      errorMessage = 'Incorrect password. Please try again.';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Invalid email address.';
    } else if (error.code === 'auth/too-many-requests') {
      errorMessage = 'Too many failed attempts. Please try again later.';
    } else if (error.message && (error.message.includes('subscription') || error.message.includes('incomplete') || error.message.includes('setup'))) {
      // Show subscription renewal modal for subscription-related errors
      const activeRole = document.querySelector('.role-btn.active');
      const selectedRole = activeRole ? activeRole.id.replace('role-', '') : 'owner';
      showSubscriptionRenewal(error.message, selectedRole);
      // Reset login button
      const loginBtn = document.querySelector('.btn-login');
      loginBtn.textContent = originalText;
      loginBtn.disabled = false;
      return; // Don't show generic error
    } else if (error.message) {
      errorMessage = error.message;
      alert(errorMessage);
    }
    const loginBtn = document.querySelector('.btn-login');
    loginBtn.textContent = originalText;
    loginBtn.disabled = false;
  }
}

// Continue to app directly (no school selection during login)
async function continueToAppDirectly() {
  try {
    
    // Show app
    document.getElementById('splash').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('sidebar-role-name').textContent = roleLabels[currentRole];
    buildNav();
    const firstPage = 'overall-dashboard';
    navigateTo(firstPage);
    document.getElementById('dash-date').textContent = new Date().toLocaleDateString('en-IN',{weekday:'short',year:'numeric',month:'short',day:'numeric'});
    document.getElementById('att-today-date').textContent = new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    document.getElementById('cf-month-filter').value = new Date().toISOString().slice(0,7);
    
    // Show school selector in dashboard if schools exist
    if (userSchools.length > 0) {
      showSchoolSelectorInDashboard();
    }
    
    // Apply role-based restrictions
    restrictUIByRole();
    
  } catch (error) {
    console.error('Error loading app:', error);
    alert('Error loading application. Please try again.');
  }
}

// Continue to app after school selection
async function continueToApp() {
  try {
    if (!currentSchoolId) {
      alert('Please select a school');
      return;
    }
    
    // Initialize Firebase data for selected school
    await loadInitialData();
    setupRealtimeListeners();
    
    // Show app
    document.getElementById('splash').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('sidebar-role-name').textContent = roleLabels[currentRole];
    buildNav();
    // Set first page based on role
    const firstPage = currentRole === 'owner' ? 'overall-dashboard' : 'dashboard';
    navigateTo(firstPage);
    document.getElementById('dash-date').textContent = new Date().toLocaleDateString('en-IN',{weekday:'short',year:'numeric',month:'short',day:'numeric'});
    document.getElementById('att-today-date').textContent = new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    document.getElementById('cf-month-filter').value = new Date().toISOString().slice(0,7);
    const ownerFuelFilter = document.getElementById('owner-fuel-month-filter');
    if (ownerFuelFilter) ownerFuelFilter.value = new Date().toISOString().slice(0,7);
    renderAllData();
    
    // Apply role-based restrictions
    restrictUIByRole();
        
  } catch (error) {
    console.error('Error loading app:', error);
    alert('Error loading application. Please try again.');
  }
}

// Show school selector in dashboard
function showSchoolSelectorInDashboard() {
  const selector = document.getElementById('dashboard-school-selector');
  const prompt = document.getElementById('create-school-prompt');
  const select = document.getElementById('dashboard-school-select');
  
  // Check if elements exist before accessing them
  if(selector) selector.style.display = 'block';
  if(prompt) prompt.style.display = 'none';
  
  // Populate school options
  if(select) {
    select.innerHTML = '<option value="">Select school...</option>';
    userSchools.forEach(school => {
      const option = document.createElement('option');
      option.value = school.id;
      option.textContent = school.name;
      select.appendChild(option);
    });
  }
}

// Show create school prompt
function showCreateSchoolPrompt() {
  const selector = document.getElementById('dashboard-school-selector');
  const prompt = document.getElementById('create-school-prompt');
  
  selector.style.display = 'none';
  prompt.style.display = 'block';
}

// Select school from dashboard
async function selectDashboardSchool() {
  const select = document.getElementById('dashboard-school-select');
  const schoolId = select.value;
  
  if (schoolId) {
    FirebaseService.setSchool(schoolId);
    currentSchoolId = schoolId;
    
    // Initialize data for selected school
    await loadInitialData();
    setupRealtimeListeners();
    renderAllData();
    
    // Hide selector after selection
    document.getElementById('dashboard-school-selector').style.display = 'none';
  }
}

async function doLogout() {
  try {
    await FirebaseService.signOut();
    document.getElementById('splash').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    
    // Reset SaaS state
    currentSchoolId = null;
    currentUser = null;
    userSchools = [];
    FirebaseService.setSchool(null);
    FirebaseService.setUser(null);
    
    // Clear forms
    const _lu = document.getElementById('login-user'); if(_lu) _lu.value = '';
    const _lp = document.getElementById('login-pass'); if(_lp) _lp.value = '';
    const _sn = document.getElementById('school-name'); if(_sn) _sn.value = '';
    const _se = document.getElementById('school-email'); if(_se) _se.value = '';
    const _sp = document.getElementById('school-phone'); if(_sp) _sp.value = '';
    
    // Reset UI
    const _ss = document.getElementById('school-section'); if(_ss) _ss.style.display = 'none';
    const _nsf = document.getElementById('new-school-form'); if(_nsf) _nsf.style.display = 'none';
    const _lf = document.getElementById('login-form'); if(_lf) _lf.style.display = 'none';
    
    // Reset login button
    const loginBtn = document.querySelector('.btn-login');
    loginBtn.textContent = 'Sign In →';
    loginBtn.onclick = doLogin;
    
  } catch (error) {
    console.error('Logout error:', error);
    // Still show splash screen even if logout fails
    document.getElementById('splash').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
  }
}

// ============================================================
// NAVIGATION
// ============================================================
function buildNav() {
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = '';
  navConfig[currentRole].forEach(section => {
    const sec = document.createElement('div');
    sec.className = 'nav-section';
    sec.innerHTML = `<div class="nav-section-title">${section.section}</div>`;
    section.items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'nav-item';
      el.id = 'nav-'+item.id;
      el.innerHTML = `<span class="ni">${item.icon}</span>${item.label}`;
      el.onclick = () => navigateTo(item.id);
      sec.appendChild(el);
    });
    nav.appendChild(sec);
  });
}

function navigateTo(pageId) {
  // Check if user has permission to access this page
  if (!hasPageAccess(pageId)) {
    alert('You do not have permission to access this page.');
    return;
  }
  
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-'+pageId);
  if(page) page.classList.add('active');
  const nav = document.getElementById('nav-'+pageId);
  if(nav) nav.classList.add('active');
  currentPage = pageId;
  refreshPage(pageId);
  
  // Apply role-based restrictions after navigation
  setTimeout(restrictUIByRole, 100);
}

// ============================================================
// ROLE-BASED DATA FILTERING
// ============================================================

// Filter data based on user role and permissions
function filterDataByRole(dataType, items) {
  if (!currentRole || !currentUser) return items;
  if (!Array.isArray(items)) return items;

  // ALWAYS filter by current school first — no item from another school should ever appear
  let schoolFiltered = items;
  if (currentSchoolId) {
    schoolFiltered = items.filter(item => {
      // Items with no schoolId at all are legacy — include them only if there's only 1 school
      if (!item.schoolId) return (userSchools || []).length <= 1;
      return item.schoolId === currentSchoolId;
    });
  }

  switch (dataType) {
    case 'students':
      if (currentRole === 'owner' || currentRole === 'office') {
        return schoolFiltered;
      } else if (currentRole === 'instructor') {
        const instructorName = getCurrentInstructorName();
        return schoolFiltered.filter(student =>
          student.instructorEmail === currentUser.email ||
          student.instructor === currentUser.email ||
          student.instructor === instructorName
        );
      }
      break;

    case 'transactions':
      if (currentRole === 'owner' || currentRole === 'office') {
        return schoolFiltered;
      } else if (currentRole === 'instructor') {
        return schoolFiltered;
      }
      break;

    case 'attendance':
      if (currentRole === 'owner' || currentRole === 'office') {
        return schoolFiltered;
      } else if (currentRole === 'instructor') {
        const instructorName = getCurrentInstructorName();
        const myStudents = (data.students || []).filter(student =>
          student.schoolId === currentSchoolId &&
          (student.instructorEmail === currentUser.email ||
           student.instructor === currentUser.email ||
           student.instructor === instructorName)
        );
        const myStudentIds = myStudents.map(s => s.id || s.name);
        return schoolFiltered.filter(item =>
          myStudentIds.includes(item.studentId || item.studentName)
        );
      }
      break;

    case 'schedule':
      return schoolFiltered;

    case 'fuel':
      return schoolFiltered;

    default:
      return schoolFiltered;
  }

  return schoolFiltered;
}

// Get filtered data for current user
function getFilteredData(dataType) {
  const originalData = data[dataType];
  if (!originalData) return [];
  
  if (Array.isArray(originalData)) {
    return filterDataByRole(dataType, originalData);
  } else if (typeof originalData === 'object') {
    // For object data like attendance (keyed by date)
    const filtered = {};
    Object.keys(originalData).forEach(key => {
      filtered[key] = filterDataByRole(dataType, originalData[key]);
    });
    return filtered;
  }
  
  return originalData;
}

// ============================================================
// RENDER ALL DATA
// ============================================================
function renderAllData() {
  // Pre-populate instructor dropdown for static enrollment page
  const s2 = document.getElementById('s-instructor');
  if (s2) {
    s2.innerHTML = '<option value="">Select Instructor</option>';
    const today = new Date().toISOString().split('T')[0];
    const attendanceToday = (data.instructorAttendance && data.instructorAttendance[today]) || (data.adminAttendance && data.adminAttendance[today]) || {};
    const instructors = (data.staff || []).filter(st => st.role === 'instructor');
    const adminInst = (data.admins || []).filter(a => a.role === 'instructor');
    const allInst = instructors.length > 0 ? instructors : adminInst;
    const present = allInst.filter(inst => {
      const key = inst.name || inst.email || inst.userId || inst.firebaseId;
      const rec = attendanceToday[key] || attendanceToday[inst.email] || attendanceToday[inst.name];
      return rec && rec.status === 'present';
    });
    const listToUse = present.length > 0 ? present : allInst;
    listToUse.forEach(inst => {
      const opt = document.createElement('option');
      opt.value = inst.name;
      opt.textContent = inst.name;
      s2.appendChild(opt);
    });
  }
  renderStudentsTable();
  renderSchedule();
  renderNotifications();
  renderAttendance();
  renderInstructorStudents();
  renderDashboard();
  
  // Owner-only renders
  if (currentRole === 'owner') {
    renderCashflow();
    renderReport();
    renderDLTests();
    renderAdminsTable();
    renderOwnerFuelDashboard();
    renderSchoolSwitcher();
    loadOtherServices();
    scheduleDailyNotification();
  }
  
  // Office renders
  if (currentRole === 'office') {
    renderCashflow();
    renderReport();
    renderDLTests();
    loadOtherServices();
  }
  
  // Instructor-specific renders
  if (currentRole === 'instructor') {
    renderDriverFuelPage();
  }
}

function refreshPage(id) {
  if(id==='overall-dashboard') renderOverallDashboard();
  else if(id==='overall-students') renderOverallStudents();
  else if(id==='overall-cashflow') renderOverallCashflow();
  else if(id==='overall-reports') renderOverallReports();
  else if(id==='school-selector') renderSchoolSelector();
  else if(id==='dashboard') renderDashboard();
  else if(id==='all-students') renderStudentsTable();
  else if(id==='cashflow') renderCashflow();
  else if(id==='dl-tests') renderDLTests();
  else if(id==='attendance') renderAttendance();
  else if(id==='class-schedule') renderSchedule();
  else if(id==='petrol') renderDriverFuelPage();
  else if(id==='owner-fuel') renderOwnerFuelDashboard();
  else if(id==='vehicles') renderVehicles();
  else if(id==='owner-attendance') renderOwnerAttendance();
  else if(id==='office-attendance') { renderOfficeAttHistory(); const d=document.getElementById('office-att-date'); if(d) d.textContent='Today — '+new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'}); }
  else if(id==='notifications') renderNotifications();
  else if(id==='reports') renderReport();
  else if(id==='my-students') renderInstructorStudents();
  else if(id==='admin-management') renderAdminsTable();
  else if(id==='staff-management') renderStaffTable();
  else if(id==='other-services') renderOtherServices();
  else if(id==='student-tracking') renderStudentTracking();
  else if(id==='add-student') { /* static form page, no render needed */ }
}

// ============================================================
// OVERALL VIEW - ALL SCHOOLS
// ============================================================
// ── helper: fetch one school's data from Firebase ──────────────────────────
async function fetchSchoolSnapshot(schoolId) {
  try {
    const [studentsSnap, txSnap, staffSnap] = await Promise.all([
      db.collection('schools').doc(schoolId).collection('students').get(),
      db.collection('schools').doc(schoolId).collection('transactions').get(),
      db.collection('schools').doc(schoolId).collection('staff').get()
    ]);
    return {
      students:     studentsSnap.docs.map(d => ({ id: d.id, ...d.data(), schoolId })),
      transactions: txSnap.docs.map(d => ({ id: d.id, ...d.data(), schoolId })),
      staff:        staffSnap.docs.map(d => ({ id: d.id, ...d.data(), schoolId }))
    };
  } catch (e) {
    console.warn('fetchSchoolSnapshot failed for', schoolId, e.message);
    return { students: [], transactions: [], staff: [] };
  }
}

async function renderOverallDashboard() {
  const dateElement = document.getElementById('overall-date');
  if (dateElement) dateElement.textContent = new Date().toLocaleDateString('en-IN',{weekday:'short',year:'numeric',month:'short',day:'numeric'});

  if (userSchools.length === 0) {
    ['total-schools','total-students-all','total-revenue','total-expenses','total-instructors','total-classes']
      .forEach(id => { const el = document.getElementById(id); if(el) el.textContent='0'; });
    const perf = document.getElementById('schools-performance');
    if (perf) perf.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2);">No schools found. Create your first school.</div>';
    return;
  }

  const thisMonth = new Date().toISOString().slice(0,7);

  // Show loading state
  const perf = document.getElementById('schools-performance');
  if (perf) perf.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">Loading school data…</div>';

  // Fetch each school independently
  const snapshots = await Promise.all(userSchools.map(s => fetchSchoolSnapshot(s.id)));

  let totalStudents=0, totalRevenue=0, totalExpenses=0, totalInstructors=0;
  const perSchool = userSchools.map((school, i) => {
    const snap = snapshots[i];
    const students = snap.students.length;
    const revenue  = snap.transactions.filter(t=>t.type==='income'&&(t.date||'').startsWith(thisMonth)).reduce((s,t)=>s+(t.amount||0),0);
    const expenses = snap.transactions.filter(t=>t.type==='expense'&&(t.date||'').startsWith(thisMonth)).reduce((s,t)=>s+(t.amount||0),0);
    const instructors = snap.staff.filter(st=>st.role==='instructor').length;
    totalStudents += students; totalRevenue += revenue; totalExpenses += expenses; totalInstructors += instructors;
    return { school, students, revenue, expenses, instructors };
  });

  ['total-schools','total-students-all','total-revenue','total-expenses','total-instructors'].forEach((id,i) => {
    const val = [userSchools.length, totalStudents, '₹'+totalRevenue.toLocaleString(), '₹'+totalExpenses.toLocaleString(), totalInstructors][i];
    const el = document.getElementById(id); if(el) el.textContent = val;
  });

  if (perf) {
    let html = '<table class="data-table"><thead><tr><th>School</th><th>Students</th><th>Monthly Revenue</th><th>Monthly Expenses</th><th>Net</th><th>Instructors</th></tr></thead><tbody>';
    perSchool.forEach(({school,students,revenue,expenses,instructors}) => {
      const net = revenue - expenses;
      html += `<tr>
        <td><strong>${school.name}</strong></td>
        <td>${students}</td>
        <td style="color:var(--success)">₹${revenue.toLocaleString()}</td>
        <td style="color:var(--danger)">₹${expenses.toLocaleString()}</td>
        <td style="color:${net>=0?'var(--success)':'var(--danger)'}">₹${net.toLocaleString()}</td>
        <td>${instructors}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    perf.innerHTML = html;
  }
}

async function renderOverallStudents() {
  const studentsPage = document.getElementById('page-overall-students');
  if (!studentsPage) return;

  studentsPage.innerHTML = '<div class="page-header"><h2>All Students</h2><p>Students from all your driving schools</p></div><div style="text-align:center;padding:30px;color:var(--text2);">Loading…</div>';

  if (userSchools.length === 0) {
    studentsPage.innerHTML = '<div class="page-header"><h2>All Students</h2></div><div style="text-align:center;padding:40px;color:var(--text2);">No schools found.</div>';
    return;
  }

  const snapshots = await Promise.all(userSchools.map(s => fetchSchoolSnapshot(s.id)));

  let allStudents = [];
  const perSchool = userSchools.map((school, i) => {
    const students = snapshots[i].students;
    students.forEach(s => allStudents.push({ ...s, schoolName: school.name }));
    return {
      school,
      total:     students.length,
      active:    students.filter(s=>s.status==='Active').length,
      completed: students.filter(s=>s.status==='Completed').length,
      pending:   students.filter(s=>s.status==='Pending').length,
      totalFee:  students.reduce((sum,s)=>sum+(s.totalFee||0),0),
      paid:      students.reduce((sum,s)=>sum+(s.paid||0),0)
    };
  });

  const totals = perSchool.reduce((acc,s)=>({
    total:acc.total+s.total, active:acc.active+s.active,
    completed:acc.completed+s.completed, pending:acc.pending+s.pending,
    totalFee:acc.totalFee+s.totalFee, paid:acc.paid+s.paid
  }), {total:0,active:0,completed:0,pending:0,totalFee:0,paid:0});

  allStudents.sort((a,b)=>a.name.localeCompare(b.name));

  let html = '<div class="page-header"><h2>All Students</h2><p>Students from all your driving schools</p></div>';

  // Summary cards
  html += `<div class="stats-grid">
    <div class="stat-card accent"><div class="sc-label">Total Students</div><div class="sc-value" style="color:var(--primary)">${totals.total}</div><div class="sc-sub">Across all schools</div></div>
    <div class="stat-card blue"><div class="sc-label">Active</div><div class="sc-value" style="color:var(--accent2)">${totals.active}</div><div class="sc-sub">Currently learning</div></div>
    <div class="stat-card green"><div class="sc-label">Completed</div><div class="sc-value" style="color:var(--success)">${totals.completed}</div><div class="sc-sub">License obtained</div></div>
    <div class="stat-card"><div class="sc-label">Pending Balance</div><div class="sc-value" style="color:var(--warning)">₹${(totals.totalFee-totals.paid).toLocaleString()}</div><div class="sc-sub">Yet to collect</div></div>
  </div>`;

  // School-wise breakdown
  html += '<div class="card"><div class="card-title">School-wise Breakdown</div><table class="data-table"><thead><tr><th>School</th><th>Total</th><th>Active</th><th>Completed</th><th>Total Fee</th><th>Collected</th><th>Pending</th></tr></thead><tbody>';
  perSchool.forEach(({school,total,active,completed,totalFee,paid})=>{
    html += `<tr>
      <td><strong>${school.name}</strong></td><td>${total}</td>
      <td><span class="badge badge-green">${active}</span></td>
      <td><span class="badge badge-purple">${completed}</span></td>
      <td>₹${totalFee.toLocaleString()}</td>
      <td style="color:var(--success)">₹${paid.toLocaleString()}</td>
      <td style="color:var(--warning)">₹${(totalFee-paid).toLocaleString()}</td>
    </tr>`;
  });
  html += '</tbody></table></div>';

  // All students table
  html += '<div class="card"><div class="card-title">All Students</div><table class="data-table"><thead><tr><th>Name</th><th>School</th><th>Phone</th><th>Vehicle</th><th>Instructor</th><th>Status</th><th>Classes</th><th>Fee</th><th>Paid</th><th>Balance</th></tr></thead><tbody>';
  allStudents.slice(0,50).forEach(s => {
    const balance = (s.totalFee||0)-(s.paid||0);
    const statusCls = s.status==='Active'?'badge-green':s.status==='Completed'?'badge-purple':'badge-amber';
    html += `<tr>
      <td><strong>${s.name}</strong><div style="font-size:11px;color:var(--text2)">${s.phone}</div></td>
      <td><span class="badge badge-gray">${s.schoolName}</span></td>
      <td>${s.phone}</td>
      <td>${s.vehicle||'—'}</td>
      <td>${s.instructor||'—'}</td>
      <td><span class="badge ${statusCls}">${s.status}</span></td>
      <td>${s.classes||0}/${s.totalClasses||27}</td>
      <td>₹${(s.totalFee||0).toLocaleString()}</td>
      <td style="color:var(--success)">₹${(s.paid||0).toLocaleString()}</td>
      <td style="color:${balance>0?'var(--danger)':'var(--success)'}">₹${balance.toLocaleString()}</td>
    </tr>`;
  });
  html += '</tbody></table></div>';

  studentsPage.innerHTML = html;
}

async function renderOverallCashflow() {
  const cashflowPage = document.getElementById('page-overall-cashflow');
  if (!cashflowPage) return;

  cashflowPage.innerHTML = '<div class="page-header"><h2>All Revenue</h2><p>Combined financial data from all schools</p></div><div style="text-align:center;padding:30px;color:var(--text2);">Loading…</div>';

  if (userSchools.length === 0) {
    cashflowPage.innerHTML = '<div class="page-header"><h2>All Revenue</h2></div><div style="text-align:center;padding:40px;color:var(--text2);">No schools found.</div>';
    return;
  }

  const thisMonth = new Date().toISOString().slice(0,7);
  const snapshots = await Promise.all(userSchools.map(s => fetchSchoolSnapshot(s.id)));

  let allTransactions = [];
  const perSchool = userSchools.map((school, i) => {
    const txs = snapshots[i].transactions;
    txs.forEach(t => allTransactions.push({ ...t, schoolName: school.name }));
    const income  = txs.filter(t=>t.type==='income' &&(t.date||'').startsWith(thisMonth)).reduce((s,t)=>s+(t.amount||0),0);
    const expense = txs.filter(t=>t.type==='expense'&&(t.date||'').startsWith(thisMonth)).reduce((s,t)=>s+(t.amount||0),0);
    const totalIncome  = txs.filter(t=>t.type==='income' ).reduce((s,t)=>s+(t.amount||0),0);
    const totalExpense = txs.filter(t=>t.type==='expense').reduce((s,t)=>s+(t.amount||0),0);
    // pending from students
    const students = snapshots[i].students;
    const pending = students.reduce((s,st)=>{const b=(st.totalFee||0)-(st.paid||0);return s+(b>0?b:0);},0);
    return { school, income, expense, net:income-expense, totalIncome, totalExpense, pending };
  });

  const totals = perSchool.reduce((acc,s)=>({
    income:acc.income+s.income, expense:acc.expense+s.expense,
    totalIncome:acc.totalIncome+s.totalIncome, totalExpense:acc.totalExpense+s.totalExpense,
    pending:acc.pending+s.pending
  }),{income:0,expense:0,totalIncome:0,totalExpense:0,pending:0});

  allTransactions.sort((a,b)=>(b.date||'').localeCompare(a.date||''));

  let html = '<div class="page-header"><h2>All Revenue</h2><p>Combined financial data from all schools</p></div>';

  html += `<div class="stats-grid">
    <div class="stat-card green"><div class="sc-label">This Month Income</div><div class="sc-value" style="color:var(--success)">₹${totals.income.toLocaleString()}</div><div class="sc-sub">All schools</div></div>
    <div class="stat-card red"><div class="sc-label">This Month Expenses</div><div class="sc-value" style="color:var(--danger)">₹${totals.expense.toLocaleString()}</div><div class="sc-sub">All schools</div></div>
    <div class="stat-card accent"><div class="sc-label">Net Profit</div><div class="sc-value" style="color:${totals.income-totals.expense>=0?'var(--success)':'var(--danger)'}">₹${(totals.income-totals.expense).toLocaleString()}</div><div class="sc-sub">This month</div></div>
    <div class="stat-card"><div class="sc-label">Pending Collection</div><div class="sc-value" style="color:var(--warning)">₹${totals.pending.toLocaleString()}</div><div class="sc-sub">From students</div></div>
  </div>`;

  // Per-school breakdown
  html += '<div class="card"><div class="card-title">School-wise Financial Performance (This Month)</div><table class="data-table"><thead><tr><th>School</th><th>Income</th><th>Expenses</th><th>Net Profit</th><th>Pending</th></tr></thead><tbody>';
  perSchool.forEach(({school,income,expense,net,pending})=>{
    html += `<tr>
      <td><strong>${school.name}</strong></td>
      <td style="color:var(--success)">₹${income.toLocaleString()}</td>
      <td style="color:var(--danger)">₹${expense.toLocaleString()}</td>
      <td style="color:${net>=0?'var(--success)':'var(--danger)'}">₹${net.toLocaleString()}</td>
      <td style="color:var(--warning)">₹${pending.toLocaleString()}</td>
    </tr>`;
  });
  html += '</tbody></table></div>';

  // All transactions
  html += '<div class="card"><div class="card-title">All Transactions</div><table class="data-table"><thead><tr><th>Date</th><th>School</th><th>Description</th><th>Category</th><th>Type</th><th>Amount</th></tr></thead><tbody>';
  allTransactions.slice(0,50).forEach(t => {
    const clr = t.type==='income'?'var(--success)':'var(--danger)';
    const pfx = t.type==='income'?'+':'-';
    html += `<tr>
      <td style="color:var(--text2);font-size:12px;">${t.date||''}</td>
      <td><span class="badge badge-gray">${t.schoolName}</span></td>
      <td>${t.desc||''}</td>
      <td><span class="badge badge-gray">${t.category||''}</span></td>
      <td><span class="badge ${t.type==='income'?'badge-green':'badge-red'}">${t.type}</span></td>
      <td style="font-weight:600;color:${clr}">${pfx}₹${(t.amount||0).toLocaleString()}</td>
    </tr>`;
  });
  html += '</tbody></table></div>';

  cashflowPage.innerHTML = html;
}

async function renderOverallReports() {
  const reportsPage = document.getElementById('page-overall-reports');
  if (!reportsPage) return;

  reportsPage.innerHTML = '<div class="page-header"><h2>All Reports</h2><p>Combined reports from all driving schools</p></div><div style="text-align:center;padding:30px;color:var(--text2);">Loading…</div>';

  if (userSchools.length === 0) {
    reportsPage.innerHTML = '<div class="page-header"><h2>All Reports</h2></div><div style="text-align:center;padding:40px;color:var(--text2);">No schools found.</div>';
    return;
  }

  const thisMonth = new Date().toISOString().slice(0,7);
  const snapshots = await Promise.all(userSchools.map(s => fetchSchoolSnapshot(s.id)));

  const perSchool = userSchools.map((school, i) => {
    const students = snapshots[i].students;
    const txs      = snapshots[i].transactions;
    const instructors = snapshots[i].staff.filter(st=>st.role==='instructor').length;
    const revenue  = txs.filter(t=>t.type==='income' &&(t.date||'').startsWith(thisMonth)).reduce((s,t)=>s+(t.amount||0),0);
    const expenses = txs.filter(t=>t.type==='expense'&&(t.date||'').startsWith(thisMonth)).reduce((s,t)=>s+(t.amount||0),0);
    const completed = students.filter(s=>s.status==='Completed').length;
    const totalClasses = students.reduce((s,st)=>s+(st.classes||0),0);
    const pending = students.reduce((s,st)=>{const b=(st.totalFee||0)-(st.paid||0);return s+(b>0?b:0);},0);
    return { school, students:students.length, active:students.filter(s=>s.status==='Active').length, completed, revenue, expenses, net:revenue-expenses, totalClasses, pending, instructors };
  });

  const totals = perSchool.reduce((acc,s)=>({
    students:acc.students+s.students, active:acc.active+s.active,
    completed:acc.completed+s.completed, revenue:acc.revenue+s.revenue,
    expenses:acc.expenses+s.expenses, totalClasses:acc.totalClasses+s.totalClasses,
    pending:acc.pending+s.pending, instructors:acc.instructors+s.instructors
  }),{students:0,active:0,completed:0,revenue:0,expenses:0,totalClasses:0,pending:0,instructors:0});

  const completionRate = totals.students > 0 ? Math.round((totals.completed/totals.students)*100) : 0;
  const avgRevPerStudent = totals.students > 0 ? Math.round(totals.revenue/totals.students) : 0;
  const netProfit = totals.revenue - totals.expenses;
  const margin = totals.revenue > 0 ? Math.round((netProfit/totals.revenue)*100) : 0;

  let html = '<div class="page-header"><h2>All Reports</h2><p>Combined reports from all driving schools</p></div>';

  html += `<div class="stats-grid">
    <div class="stat-card accent"><div class="sc-label">Total Schools</div><div class="sc-value" style="color:var(--primary)">${userSchools.length}</div></div>
    <div class="stat-card blue"><div class="sc-label">Total Students</div><div class="sc-value" style="color:var(--accent2)">${totals.students}</div></div>
    <div class="stat-card green"><div class="sc-label">Monthly Revenue</div><div class="sc-value" style="color:var(--success)">₹${totals.revenue.toLocaleString()}</div></div>
    <div class="stat-card"><div class="sc-label">Net Profit</div><div class="sc-value" style="color:${netProfit>=0?'var(--success)':'var(--danger)'}">₹${netProfit.toLocaleString()}</div></div>
    <div class="stat-card"><div class="sc-label">Completion Rate</div><div class="sc-value">${completionRate}%</div></div>
    <div class="stat-card"><div class="sc-label">Pending Collection</div><div class="sc-value" style="color:var(--warning)">₹${totals.pending.toLocaleString()}</div></div>
  </div>`;

  html += '<div class="card"><div class="card-title">School Performance Comparison</div><table class="data-table"><thead><tr><th>School</th><th>Students</th><th>Active</th><th>Completed</th><th>Instructors</th><th>Revenue</th><th>Expenses</th><th>Net</th><th>Completion%</th><th>Pending</th></tr></thead><tbody>';
  perSchool.forEach(s=>{
    const rate = s.students>0?Math.round((s.completed/s.students)*100):0;
    const rateCls = rate>=80?'badge-green':rate>=60?'badge-amber':'badge-red';
    html += `<tr>
      <td><strong>${s.school.name}</strong></td>
      <td>${s.students}</td>
      <td><span class="badge badge-green">${s.active}</span></td>
      <td><span class="badge badge-purple">${s.completed}</span></td>
      <td>${s.instructors}</td>
      <td style="color:var(--success)">₹${s.revenue.toLocaleString()}</td>
      <td style="color:var(--danger)">₹${s.expenses.toLocaleString()}</td>
      <td style="color:${s.net>=0?'var(--success)':'var(--danger)'}">₹${s.net.toLocaleString()}</td>
      <td><span class="badge ${rateCls}">${rate}%</span></td>
      <td style="color:var(--warning)">₹${s.pending.toLocaleString()}</td>
    </tr>`;
  });
  html += '</tbody></table></div>';

  html += `<div class="card"><div class="card-title">Business Insights</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
      <div style="background:var(--surface2);padding:16px;border-radius:10px;">
        <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">Avg Revenue / Student</div>
        <div style="font-size:22px;font-weight:700;font-family:'Syne'">₹${avgRevPerStudent.toLocaleString()}</div>
      </div>
      <div style="background:var(--surface2);padding:16px;border-radius:10px;">
        <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">Profit Margin</div>
        <div style="font-size:22px;font-weight:700;font-family:'Syne';color:${margin>=0?'var(--success)':'var(--danger)'}">${margin}%</div>
      </div>
      <div style="background:var(--surface2);padding:16px;border-radius:10px;">
        <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">Total Classes Done</div>
        <div style="font-size:22px;font-weight:700;font-family:'Syne'">${totals.totalClasses}</div>
      </div>
    </div>
  </div>`;

  reportsPage.innerHTML = html;
}

async function renderSchoolSelector() {
  console.log('renderSchoolSelector called');
  console.log('userSchools before loading:', userSchools);
  
  // Reload schools data to ensure it's fresh
  try {
    console.log('Loading user schools...');
    await loadUserSchools();
    console.log('userSchools after loading:', userSchools);
  } catch (error) {
    console.error('Error loading schools:', error);
  }
  
  // Wait a moment for the page to be fully visible
  await new Promise(resolve => setTimeout(resolve, 50));
  
  // Set date
  const dateElement = document.getElementById('selector-date');
  if(dateElement) dateElement.textContent = new Date().toLocaleDateString('en-IN',{weekday:'short',year:'numeric',month:'short',day:'numeric'});
  
  // Populate schools grid
  const schoolsGrid = document.getElementById('schools-grid');
  if(schoolsGrid) {
    console.log('Schools grid found, userSchools.length:', userSchools.length);
    
    if(userSchools.length === 0) {
      console.log('No schools to display');
      schoolsGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text2);">No schools available. Create your first school to get started.</div>';
    } else {
      console.log('Rendering schools:', userSchools.map(s => s.name));
      schoolsGrid.innerHTML = userSchools.map(school => `
        <div class="school-card" style="border:2px solid var(--border); border-radius:12px; padding:20px; transition:all 0.2s; position: relative;">
          <button onclick="deleteSchool('${school.id}', '${school.name}')" style="position: absolute; top:10px; right:10px; background:var(--danger); color:white; border:none; border-radius:50%; width:30px; height:30px; cursor:pointer; font-size:16px; display:flex; align-items:center; justify-content:center; z-index:10;" title="Delete School">×</button>
          <div onclick="selectSchoolForView('${school.id}', '${school.name}')" style="cursor:pointer;">
            <div style="display:flex;align-items:center;gap:15px;margin-bottom:15px;">
              <div class="avatar" style="background:var(--accent);color:white;width:50px;height:50px;font-size:20px;border-radius:12px;">${school.name.charAt(0)}</div>
              <div>
                <div style="font-weight:600;font-size:16px;color:var(--text);">${school.name}</div>
                <div style="font-size:12px;color:var(--text2);">Owner View</div>
              </div>
            </div>
            <div style="border-top:1px solid var(--border);padding-top:15px;margin-top:15px;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">
                <div><strong>Status:</strong> <span class="badge badge-green">Active</span></div>
                <div><strong>Students:</strong> <span style="color:var(--text2);">View in dashboard</span></div>
                <div><strong>Revenue:</strong> <span style="color:var(--success);">View in cashflow</span></div>
              </div>
            </div>
          </div>
        </div>
      `).join('');
    }
  } else {
    console.log('Schools grid not found! Checking if page is visible...');
    
    // Debug: Check if the school selector page is visible
    const schoolSelectorPage = document.getElementById('page-school-selector');
    if(schoolSelectorPage) {
      console.log('School selector page found, classes:', schoolSelectorPage.className);
      console.log('Page style:', schoolSelectorPage.style.cssText);
    } else {
      console.log('School selector page not found at all!');
    }
    
    // Debug: List all pages
    const allPages = document.querySelectorAll('.page');
    console.log('All pages found:', allPages.length);
    allPages.forEach((page, index) => {
      console.log(`Page ${index}: id=${page.id}, classes=${page.className}`);
    });
  }
}

// Modal functions for school creation with manager
function openCreateSchoolWithManagerModal() {
  const modal = document.getElementById('modal-create-school-with-manager');
  modal.style.display = 'flex';
  // Clear form
  document.getElementById('new-school-name').value = '';
  document.getElementById('new-school-address').value = '';
  document.getElementById('new-school-phone').value = '';
  document.getElementById('cs-admin-name').value = '';
  document.getElementById('cs-admin-email').value = '';
  document.getElementById('cs-admin-password').value = '';
  document.getElementById('cs-admin-confirm-password').value = '';
  document.getElementById('cs-admin-role').value = 'office';
  document.getElementById('cs-admin-phone').value = '';
  document.getElementById('perm-students').checked = true;
  document.getElementById('perm-transactions').checked = true;
  document.getElementById('perm-attendance').checked = true;
  document.getElementById('perm-reports').checked = true;
}

function closeCreateSchoolWithManagerModal() {
  document.getElementById('modal-create-school-with-manager').style.display = 'none';
}

function closeCreateSchoolWithAdminModal() {
  const modal = document.getElementById('modal-create-school-with-admin');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Password Reset Modal Functions
function openPasswordResetModal() {
  const modal = document.getElementById('modal-password-reset');
  modal.style.display = 'flex';
  // Clear form
  document.getElementById('reset-email').value = '';
}

function closePasswordResetModal() {
  document.getElementById('modal-password-reset').style.display = 'none';
}

async function sendPasswordReset() {
  const email = document.getElementById('reset-email').value;
  
  if (!email) {
    addNotification('Please enter your email address', 'error');
    return;
  }
  
  if (!validateEmail(email)) {
    addNotification('Please enter a valid email address', 'error');
    return;
  }
  
  try {
    console.log('Attempting to send password reset to:', email);
    
    // Use Firebase Auth's built-in password reset (primary method)
    await auth.sendPasswordResetEmail(email);
    
    console.log('Password reset email sent successfully to:', email);
    addNotification(`Password reset link sent to ${email}. Check your inbox (and spam folder).`, 'success');
    closePasswordResetModal();
    
  } catch (firebaseError) {
    console.error('Firebase password reset failed:', firebaseError);
    console.error('Error code:', firebaseError.code);
    console.error('Error message:', firebaseError.message);
    
    // Handle specific Firebase errors
    if (firebaseError.code === 'auth/user-not-found') {
      addNotification('No account found with this email address', 'error');
    } else if (firebaseError.code === 'auth/invalid-email') {
      addNotification('Invalid email address format', 'error');
    } else if (firebaseError.code === 'auth/too-many-requests') {
      addNotification('Too many password reset attempts. Please try again later', 'error');
    } else if (firebaseError.code === 'auth/internal-error') {
      addNotification('Firebase email service not configured. Please follow these steps:', 'error');
      setTimeout(() => {
        alert('FIREBASE EMAIL CONFIGURATION REQUIRED:\n\n1. Go to Firebase Console → Authentication → Templates\n2. Click "Get Started" for email/password authentication\n3. Configure password reset email template\n4. Verify sender email address\n5. Save and test\n\nAlternatively, contact your system administrator.');
      }, 1000);
    } else {
      addNotification(`Password reset service unavailable. Please contact support at support@drivepro.com`, 'error');
    }
  }
}

// Check EmailJS configuration
function checkEmailJSConfig() {
  try {
    // Try to access emailjs to see if it's properly configured
    if (typeof emailjs === 'undefined') {
      return false;
    }
    return true;
  } catch (error) {
    // EmailJS not configured
    return false;
  }
}

// Store the last admin details globally for copy function
let lastAdminDetails = {
  email: '',
  password: '',
  school: ''
};

function copyAdminDetails() {
  console.log('Copy admin function called');
  console.log('lastAdminDetails:', lastAdminDetails);
  
  // Try to get from global variable first
  let email = lastAdminDetails.email;
  let password = lastAdminDetails.password;
  let school = lastAdminDetails.school;
  
  // If global variable is empty, try DOM elements
  if (!email) {
    email = document.getElementById('admin-login-email')?.textContent || '';
    console.log('Email from DOM:', email);
  }
  
  if (!password) {
    password = document.getElementById('admin-login-password')?.textContent || '';
    console.log('Password from DOM:', password);
  }
  
  if (!school) {
    school = document.getElementById('admin-school-name')?.textContent || '';
    console.log('School from DOM:', school);
  }
  
  if (!email || !password || !school) {
    console.error('Missing admin details:', { email, password, school });
    addNotification('Admin details not available', 'error');
    return;
  }
  
  const details = `Admin Login Details:\n\nEmail: ${email}\nPassword: ${password}\nSchool: ${school}\nLogin URL: http://127.0.0.1:5500\n\nNote: Save these credentials securely.`;
  
  console.log('Copying admin details:', details);
  
  // Copy to clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(details).then(() => {
      console.log('Clipboard API success');
      addNotification('Admin details copied to clipboard!', 'success');
    }).catch((err) => {
      console.log('Clipboard API failed, using fallback:', err);
      copyToClipboardFallback(details);
    });
  } else {
    copyToClipboardFallback(details);
  }
}

function copyToClipboardFallback(details) {
  try {
    console.log('Using fallback copy method');
    const textArea = document.createElement('textarea');
    textArea.value = details;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    const successful = document.execCommand('copy');
    console.log('Fallback copy result:', successful);
    document.body.removeChild(textArea);
    
    if (successful) {
      addNotification('Admin details copied to clipboard!', 'success');
    } else {
      throw new Error('Copy failed');
    }
  } catch (err) {
    console.error('Copy failed:', err);
    // Last resort - show details in an alert
    alert('Please copy these details manually:\n\n' + details);
    addNotification('Please copy manually - details shown in alert', 'info');
  }
}

function closeAdminInviteSuccessModal() {
  const modal = document.getElementById('modal-admin-invite-success');
  modal.style.display = 'none';
  // Refresh the school selector to show the new school
  renderSchoolSelector();
}

// Delete school function
async function deleteSchool(schoolId, schoolName) {
  // Prevent event bubbling to avoid triggering school selection
  event.stopPropagation();
  
  // Check if user has permission to delete schools
  if (!hasActionPermission('delete_school')) {
    alert('You do not have permission to delete schools.');
    return;
  }
  
  // Confirm deletion
  const confirmed = confirm(`Are you sure you want to delete "${schoolName}"? This action cannot be undone and will remove all associated data including students, transactions, and records.`);
  
  if (!confirmed) return;
  
  try {
    // Delete school from Firebase
    await FirebaseService.deleteSchool(schoolId);
    
    // Remove from local array
    userSchools = userSchools.filter(school => school.id !== schoolId);
    
    // If this was the current school, reset currentSchoolId
    if (currentSchoolId === schoolId) {
      currentSchoolId = null;
      FirebaseService.setSchool(null);
    }
    
    // Show success notification
    addNotification(`School "${schoolName}" has been deleted successfully`, 'success');
    
    // Refresh the school selector
    renderSchoolSelector();
    
  } catch (error) {
    console.error('Error deleting school:', error);
    addNotification('Failed to delete school. Please try again.', 'error');
  }
}

async function removeOwnerAndAllData(ownerId = currentUser?.uid, ownerEmail = currentUser?.email) {
  if (!hasActionPermission('delete_school')) {
    alert('You do not have permission to remove owner data.');
    return;
  }

  const confirmed = confirm('Are you sure you want to remove this owner and delete all Firebase data under them? This cannot be undone.');
  if (!confirmed) return;

  try {
    const result = await FirebaseService.deleteOwnerData(ownerId, ownerEmail);
    userSchools = [];
    currentSchoolId = null;
    FirebaseService.setSchool(null);
    addNotification(`Owner removed. Deleted ${result.deletedSchools} school(s) and all mapped data.`, 'success');
    renderSchoolSelector();
  } catch (error) {
    console.error('Error removing owner data:', error);
    addNotification('Failed to remove owner data. Please try again.', 'error');
  }
}

async function createSchoolWithAdmin() {
  const schoolName = document.getElementById('new-school-name').value.trim();
  const schoolAddress = document.getElementById('new-school-address').value.trim();
  const schoolPhone = document.getElementById('new-school-phone').value.trim();
  const schoolLatitude = document.getElementById('school-latitude').value.trim();
  const schoolLongitude = document.getElementById('school-longitude').value.trim();
  const adminName = document.getElementById('cs-admin-name').value.trim();
  const adminEmail = document.getElementById('cs-admin-email').value.trim();
  const adminPassword = document.getElementById('cs-admin-password').value;
  const adminConfirmPassword = document.getElementById('cs-admin-confirm-password').value;
  const adminRole = document.getElementById('cs-admin-role').value;
  const adminPhone = document.getElementById('cs-admin-phone').value.trim();
  
  // Validation
  if (!schoolName || !schoolAddress || !schoolPhone) {
    addNotification('Please fill in all school details', 'error');
    return;
  }
  
  if (!schoolLatitude || !schoolLongitude) {
    addNotification('Please set school location coordinates', 'error');
    return;
  }
  
  if (!adminName || !adminEmail || !adminPassword || !adminConfirmPassword || !adminRole || !adminPhone) {
    addNotification('Please fill in all admin details', 'error');
    return;
  }
  
  if (!validateEmail(adminEmail)) {
    addNotification('Please enter a valid admin email', 'error');
    return;
  }
  
  if (adminPassword !== adminConfirmPassword) {
    addNotification('Passwords do not match', 'error');
    return;
  }
  
  if (adminPassword.length < 6) {
    addNotification('Password must be at least 6 characters long', 'error');
    return;
  }
  
  let secondaryAuthForAdmin = null;
  let secondaryAppForIndex = null;

  try {
    // Preserve original owner UID before creating admin
    const originalOwnerUid = currentUser.uid;
    
    // Create school
    const schoolData = {
      name: schoolName,
      address: schoolAddress,
      phone: schoolPhone,
      latitude: parseFloat(schoolLatitude),
      longitude: parseFloat(schoolLongitude),
      ownerId: originalOwnerUid,
      ownerEmail: currentUser.email,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active'
    };
    
    const school = await FirebaseService.createSchool(schoolData);
    
    // ── Create admin account using a SECONDARY Firebase app instance ──────────
    // This prevents Firebase from switching the active session away from the owner.
    // If we used FirebaseService.signUp() directly, Firebase would automatically
    // sign in the new admin, losing the owner's auth token and causing all
    // subsequent Firestore writes to fail with "Missing or insufficient permissions".
    let adminUid;
    try {
      // Reuse secondary app if it already exists (e.g. from a previous call),
      // otherwise initialise it with the same config as the primary app.
      const secondaryApp =
        firebase.apps.find(a => a.name === 'secondary') ||
        firebase.initializeApp(firebase.app().options, 'secondary');
      secondaryAppForIndex = secondaryApp;
      secondaryAuthForAdmin = secondaryApp.auth();

      const secondaryCredential = await secondaryAuthForAdmin
        .createUserWithEmailAndPassword(adminEmail, adminPassword);
      adminUid = secondaryCredential.user.uid;

      // Keep the secondary admin session alive until its userSchools index is written.
      console.log('Admin account created via secondary app, UID:', adminUid);

    } catch (signUpError) {
      if (signUpError.code === 'auth/email-already-in-use') {
        // Account already exists. We can't look up a UID client-side via email
        // (that requires the Admin SDK), so we store the email as a reference.
        // The admin can still log in — their UID will be resolved on first sign-in.
        console.log('Admin email already in use — linking existing account by email');
        adminUid = adminEmail; // placeholder; resolved on first admin login
        addNotification('Existing user account found and linked.', 'info');
      } else {
        throw signUpError;
      }
    }
    // Owner session is still intact — auth.currentUser is still the owner.
    // ──────────────────────────────────────────────────────────────────────────

    // Get permissions
    const permissions = {
      students: document.getElementById('perm-students').checked,
      transactions: document.getElementById('perm-transactions').checked,
      attendance: document.getElementById('perm-attendance').checked,
      reports: document.getElementById('perm-reports').checked
    };
    
    // Normalize role: must be 'office' or 'instructor' to match login role buttons
    const normalizedRole = (adminRole === 'admin' || adminRole === 'office') ? 'office' : 'instructor';

    // Create admin data with consistent role fields
    const adminData = {
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      role: normalizedRole,       // used by getUserMemberSchools for role lookup
      userRole: normalizedRole,   // kept for display/compatibility
      phone: adminPhone,
      status: 'active',
      addedOn: new Date().toISOString().split('T')[0],
      permissions: permissions,
      schoolId: school.id,
      ownerId: originalOwnerUid,
      ownerEmail: currentUser.email,
      userId: adminUid,
      firebaseId: adminUid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save admin user doc with their Firebase UID as the document ID.
    // This is CRITICAL — Firestore rules use:
    //   exists(/databases/.../schools/{schoolId}/users/{request.auth.uid})
    // so the doc ID must equal the admin's UID for isSchoolMember() to return true.
    if (adminUid && adminUid !== adminEmail) {
      // Normal case: we have the real UID from the secondary app
      await FirebaseService.schoolsRef
        .doc(school.id)
        .collection('users')
        .doc(adminUid)
        .set(adminData);

      // Also write a top-level /userSchools/{uid} index document.
      // getUserMemberSchools() reads this first — it needs NO index and NO
      // collection-listing permission, just a direct doc read by the user themselves.
      await writeUserSchoolsIndexAsCreatedUser(
        secondaryAppForIndex,
        adminUid,
        school.id,
        normalizedRole,
        currentUser.email
      );

    } else {
      // Fallback: email already existed, UID unknown client-side.
      // Save by email as a temporary placeholder — admin must contact owner
      // to have their UID-based doc created after first login.
      await FirebaseService.schoolsRef
        .doc(school.id)
        .collection('users')
        .doc(adminEmail.replace(/[.#$\/\[\]]/g, '_'))
        .set({ ...adminData, pendingUidResolution: true });
      addNotification('⚠️ Admin email already existed. Ask the admin to log in once and contact you — their access needs a one-time fix.', 'warning');
    }

    // Confirm owner session is current (should be unchanged, but defensive)
    currentUser = auth.currentUser;
    
    // Update user schools list
    await loadUserSchools();
    
    // Store admin details globally and show success modal
    lastAdminDetails = {
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      role: adminRole,
      phone: adminPhone,
      school: schoolName
    };
    
    document.getElementById('admin-login-email').textContent = adminEmail;
    document.getElementById('admin-login-password').textContent = adminPassword;
    document.getElementById('admin-school-name').textContent = schoolName;
    document.getElementById('modal-create-school-with-manager').style.display = 'none';
    document.getElementById('modal-admin-invite-success').style.display = 'flex';
    
    addNotification(`School "${schoolName}" created successfully! Admin account setup completed.`, 'success');
    
  } catch (error) {
    console.error('Error creating school with admin:', error);
    if (error.code === 'auth/email-already-in-use') {
      addNotification('Email already exists. Please use a different email.', 'error');
    } else {
      addNotification('Failed to create school. Please try again.', 'error');
    }
  } finally {
    if (secondaryAuthForAdmin) {
      try { await secondaryAuthForAdmin.signOut(); } catch (e) { console.warn('Secondary admin sign-out failed:', e.message); }
    }
  }
}

function generateTempPassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Gmail sending functionality has been removed
// Admin credentials are now displayed directly in the success modal

// Function to select a school for viewing
async function selectSchoolForView(schoolId, schoolName) {
  // Set the current school
  FirebaseService.setSchool(schoolId);
  currentSchoolId = schoolId;

  // Clear only this school's stale data before reloading (other schools kept intact)
  data.students     = (data.students||[]).filter(s => s.schoolId && s.schoolId !== schoolId);
  data.transactions = (data.transactions||[]).filter(t => t.schoolId && t.schoolId !== schoolId);
  data.dlTests      = (data.dlTests||[]).filter(t => t.schoolId && t.schoolId !== schoolId);
  data.fuel         = (data.fuel||[]).filter(t => t.schoolId && t.schoolId !== schoolId);
  data.staff        = [];
  data.otherServices = [];

  // Initialize Firebase data for the selected school
  try {
    if (currentRole === 'owner') {
      await FirebaseService.backfillOwnerMappingForSchool(schoolId);
    }
    await loadInitialData();
    setupRealtimeListeners();
    renderAllData();
  } catch (error) {
    console.error('Error loading school data:', error);
  }
  
  // Update navigation to show school-specific sections
  updateNavigationForSchool();
  
  // Show notification
  addNotification(`Switched to ${schoolName}`, 'success');
  
  // Navigate to the dashboard for the selected school
  navigateTo('dashboard');
}

// Update navigation to show school-specific sections instead of overall
function updateNavigationForSchool() {
  // Update the navigation config to show school-specific items
  if (currentRole === 'owner') {
    // Hide overall sections, show school-specific sections
    const overallNavItems = ['overall-dashboard', 'overall-students', 'overall-cashflow', 'overall-reports'];
    const schoolNavItems = ['dashboard', 'all-students', 'cashflow', 'reports'];
    
    // Hide overall navigation items
    overallNavItems.forEach(itemId => {
      const navItem = document.getElementById('nav-' + itemId);
      if (navItem) {
        navItem.style.display = 'none';
      }
    });
    
    // Show school-specific navigation items
    schoolNavItems.forEach(itemId => {
      const navItem = document.getElementById('nav-' + itemId);
      if (navItem) {
        navItem.style.display = 'block';
      }
    });
  }
}

// Switch back to overall view
function switchToOverallView() {
  // Clear current school
  currentSchoolId = null;
  FirebaseService.setSchool(null);
  
  // Show overall navigation items
  const overallNavItems = ['overall-dashboard', 'overall-students', 'overall-cashflow', 'overall-reports'];
  const schoolNavItems = ['dashboard', 'all-students', 'cashflow', 'reports'];
  
  // Show overall navigation items
  overallNavItems.forEach(itemId => {
    const navItem = document.getElementById('nav-' + itemId);
    if (navItem) {
      navItem.style.display = 'block';
    }
  });
  
  // Hide school-specific navigation items
  schoolNavItems.forEach(itemId => {
    const navItem = document.getElementById('nav-' + itemId);
    if (navItem) {
      navItem.style.display = 'none';
    }
  });
  
  // Navigate to overall dashboard
  navigateTo('overall-dashboard');
  addNotification('Switched to overall view', 'info');
}

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  // Auto-select school for admins/staff if not already set
  if (!currentSchoolId && userSchools.length > 0) {
    currentSchoolId = userSchools[0].id;
    FirebaseService.setSchool(currentSchoolId);
  }
  
  // Check if school is selected
  if (!currentSchoolId) {
    const statsGrid = document.getElementById('dashboard-stats-grid');
    if(statsGrid) statsGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text2);">Please select a school to view dashboard</div>';
    
    const recent = document.getElementById('recent-tx');
    if(recent) recent.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:40px;color:var(--text2);">No school selected</td></tr>';
    
    // Clear chart
    const ctx = document.getElementById('dash-chart');
    if(ctx) {
      const ctx2d = ctx.getContext('2d');
      ctx2d.clearRect(0,0,ctx.width,ctx.height);
    }
    return;
  }
  
  // Get current school info
  const currentSchool = userSchools.find(s => s.id === currentSchoolId);
  const schoolName = currentSchool ? currentSchool.name : 'Selected School';
  
  // School-specific data - filter by current school
  const today = new Date().toISOString().split('T')[0];
  const thisMonth = new Date().toISOString().slice(0,7);
  
  // Filter data by school
  const schoolStudents = data.students.filter(s => !currentSchoolId || s.schoolId === currentSchoolId);
  const schoolTransactions = data.transactions.filter(t => !currentSchoolId || t.schoolId === currentSchoolId);
  const schoolDLTests = data.dlTests.filter(t => !currentSchoolId || t.schoolId === currentSchoolId);
  const schoolSchedule = data.schedule[new Date().toLocaleDateString('en-US', {weekday: 'long'})]?.filter(s => !currentSchoolId || s.schoolId === currentSchoolId) || [];
  const schoolAttendance = data.attendance[today] || {};
  const schoolAttendanceRecords = Object.values(schoolAttendance).filter(a => a.schoolId === currentSchoolId);
  
  // Calculate school-specific stats
  const totalStudents = schoolStudents.length;
  const activeStudents = schoolStudents.filter(s => s.status === 'Active').length;
  const todayIncome = schoolTransactions.filter(t => t.type === 'income' && t.date === today).reduce((s, t) => s + t.amount, 0);
  const todayExpense = schoolTransactions.filter(t => t.type === 'expense' && t.date === today).reduce((s, t) => s + t.amount, 0);
  const monthIncome = schoolTransactions.filter(t => t.type === 'income' && t.date.startsWith(thisMonth)).reduce((s, t) => s + t.amount, 0);
  const monthExpense = schoolTransactions.filter(t => t.type === 'expense' && t.date.startsWith(thisMonth)).reduce((s, t) => s + t.amount, 0);
  const pendingDLTests = schoolDLTests.filter(t => t.date >= today).length;
  const todayClasses = schoolSchedule.length;
  const presentToday = schoolAttendanceRecords.filter(a => a.status === 'present').length;
  const totalInstructors = data.staff ? data.staff.filter(s => s.role === 'instructor').length : 0;
  
  // Chart with school data
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const currentYear = new Date().getFullYear();
  const incomes = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const expenses = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  
  // Calculate monthly income/expense for current year
  schoolTransactions.forEach(t => {
    const date = new Date(t.date);
    if (date.getFullYear() === currentYear) {
      const monthIndex = date.getMonth();
      if (t.type === 'income') {
        incomes[monthIndex] += t.amount;
      } else {
        expenses[monthIndex] += t.amount;
      }
    }
  });
  
  const ctx = document.getElementById('dash-chart');
  if(ctx && ctx.getContext) {
    ctx.width = ctx.offsetWidth;
    ctx.height = 180;
    const ctx2d = ctx.getContext('2d');
    if(ctx2d) {
      const w = ctx.width; const h = ctx.height;
      ctx2d.clearRect(0,0,w,h);
      const max = Math.max(...incomes,...expenses, 1);
      const xStep = w/(months.length-1);
      const yScale = (h-40)/max;
      // Draw grid
      ctx2d.strokeStyle='var(--border)'; ctx2d.lineWidth=1;
      for(let i=0;i<=5;i++){ const y=h-20-(i*(h-40)/5); ctx2d.beginPath(); ctx2d.moveTo(0,y); ctx2d.lineTo(w,y); ctx2d.stroke(); }
      // Draw income bars
      incomes.forEach((val,i)=>{ const x=i*xStep; const barW=xStep*0.6; const barH=val*yScale; ctx2d.fillStyle='var(--primary)'; ctx2d.fillRect(x-barW/2,h-20-barH,barW,barH); });
      // Draw expense bars
      expenses.forEach((val,i)=>{ const x=i*xStep; const barW=xStep*0.6; const barH=val*yScale; ctx2d.fillStyle='var(--danger)'; ctx2d.fillRect(x-barW/2,h-20-barH,barW,barH); });
      // Draw labels
      ctx2d.fillStyle='var(--text2)'; ctx2d.font='11px DM Sans';
      months.forEach((m,i)=>{ const x=i*xStep; ctx2d.fillText(m,x-15,h-2); });
    }
  }
  
  // School-specific stats
  const stats = [
    {label:'Total Students',value:totalStudents,sub:'Total enrolled', color:'var(--primary)', class:'accent'},
    {label:'Active Learners',value:activeStudents,sub:'Currently learning', color:'var(--accent2)', class:'blue'},
    {label:'Today\'s Income',value:'&#8377;'+todayIncome.toLocaleString(),sub:'Fees collected', color:'var(--success)', class:'green'},
    {label:'Today\'s Expense',value:'&#8377;'+todayExpense.toLocaleString(),sub:'Operational costs', color:'var(--danger)', class:'red'},
    {label:'DL Tests Scheduled',value:pendingDLTests,sub:'Upcoming tests', color:'', class:''},
    {label:'Instructors',value:totalInstructors,sub:'Total instructors', color:'', class:''}
  ];
  const statsGrid = document.getElementById('dashboard-stats-grid');
  if(statsGrid) statsGrid.innerHTML = stats.map(s=>`
    <div class="stat-card ${s.class}">
      <div class="sc-label">${s.label}</div>
      <div class="sc-value" style="color:${s.color}">${s.value}</div>
      <div class="sc-sub">${s.sub}</div>
    </div>
  `).join('');
  
  // Render income analytics
  setTimeout(renderIncomeAnalytics, 100);

  // Recent transactions for this school
  const recent = document.getElementById('recent-tx');
  if(recent) {
    if (schoolTransactions.length === 0) {
      recent.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:40px;color:var(--text2);">No transactions yet for ' + schoolName + '</td></tr>';
    } else {
      let html = '';
      schoolTransactions.slice(0,5).forEach(t => {
        html += '<tr>';
        html += '<td>' + t.desc + '</td>';
        html += '<td><span class="badge ' + (t.type === 'income' ? 'badge-green' : 'badge-red') + '">' + t.type + '</span></td>';
        html += '<td style="font-weight:600;color:' + (t.type === 'income' ? 'var(--success)' : 'var(--danger)') + ';">' + (t.type === 'income' ? '+' : '-') + '&#8377;' + t.amount.toLocaleString() + '</td>';
        html += '</tr>';
      });
      recent.innerHTML = html;
    }
  }
}

// ============================================================
// STUDENTS
// ============================================================
function renderStudentsTable(filter='', statusFilter='') {
  const tb = document.getElementById('students-table');
  if(!tb) return;
  
  // Check if school is selected
  if (!currentSchoolId) {
    tb.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2);">Please select a school to view students</div>';
    return;
  }
  
  // Get role-filtered data
  let rows = getFilteredData('students');
  if(filter) rows = rows.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()) || s.phone.includes(filter));
  if(statusFilter) rows = rows.filter(s => s.status===statusFilter);
  tb.innerHTML = rows.map(s => `
    <tr>
      <td><div style="display:flex;align-items:center;gap:10px;">
        <div class="avatar" style="background:${COLORS[(typeof s.id==='number'?s.id:(s.name||'').charCodeAt(0)||0)%COLORS.length]}22;color:${COLORS[(typeof s.id==='number'?s.id:(s.name||'').charCodeAt(0)||0)%COLORS.length]};">${s.name.split(' ').map(x=>x[0]).join('')}</div>
        <div><div style="font-weight:500">${s.name}</div><div style="font-size:11px;color:var(--text2)">${s.phone}</div></div>
      </div></td>
      <td>${s.phone}</td>
      <td><span class="badge badge-blue">${s.vehicle}</span></td>
      <td>${s.instructor}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:12px;">${s.classes}/${s.totalClasses||27}</span>
          <div class="progress-bar" style="width:60px;">
            <div class="progress-fill" style="width:${Math.min(100,Math.round(s.classes/(s.totalClasses||27)*100))}%;background:${s.classes>=(s.totalClasses||27)?'var(--success)':'var(--accent2)'}"></div>
          </div>
        </div>
      </td>
      <td><span class="badge ${s.status==='Active'?'badge-green':s.status==='Completed'?'badge-purple':'badge-amber'}">${s.status}</span></td>
      <td>
        <div style="display:flex;gap:5px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="viewStudent('${s.firebaseId||s.id}')">View</button>
          <button class="btn btn-primary btn-sm" onclick="editStudent('${s.firebaseId||s.id}')">Edit</button>
          ${hasActionPermission('delete_student') ? '<button class="btn btn-danger btn-sm" onclick="deleteStudentRecord(\'' + String(s.firebaseId||s.id).replace(/'/g,'\\\'') + '\')">Delete</button>' : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function filterStudents(val, status='') {
  renderStudentsTable(val, status);
}

function openAddStudentModal() {
  const populateInstructorDropdown = (selId) => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Select Instructor --</option>';
    // Prefer to show only instructors who are present today
    const today = new Date().toISOString().split('T')[0];
    const attendanceToday = (data.instructorAttendance && data.instructorAttendance[today]) || (data.adminAttendance && data.adminAttendance[today]) || {};
    // Gather all instructor users
    const instructors = (data.staff || []).filter(s => s.role === 'instructor');
    const adminInstructors = (data.admins || []).filter(a => a.role === 'instructor');
    const allInstructors = instructors.length > 0 ? instructors : adminInstructors;

    // Filter for present instructors
    const presentInstructors = allInstructors.filter(inst => {
      const key = inst.name || inst.email || inst.userId || inst.firebaseId;
      const rec = attendanceToday[key] || attendanceToday[inst.email] || attendanceToday[inst.name];
      return rec && rec.status === 'present';
    });

    const listToUse = presentInstructors.length > 0 ? presentInstructors : allInstructors;
    if (listToUse.length === 0) {
      sel.innerHTML += '<option value="" disabled>No instructors found</option>';
    } else {
      listToUse.forEach(inst => {
          const opt = document.createElement('option');
          opt.value = inst.email || inst.name || '';
          opt.textContent = inst.name + (inst.phone ? ' — ' + inst.phone : '');
          sel.appendChild(opt);
        });
    }
  };
  populateInstructorDropdown('qs-instructor');
  openModal('modal-add-student');
}

async function addStudentFromModal() {
  if (!hasActionPermission('add_student')) {
    alert('You do not have permission to add students.');
    return;
  }
  const name = document.getElementById('qs-name').value.trim();
  const phone = document.getElementById('qs-phone').value.trim();
  if(!name||!phone){alert('Name and phone required');return;}
  const amountPaid = parseInt(document.getElementById('qs-paid').value)||0;
  const paymentMode = document.getElementById('qs-paymode').value;
  const studentId = document.getElementById('qs-student-id').value.trim();
  const totalClasses = parseInt(document.getElementById('qs-total-classes') && document.getElementById('qs-total-classes').value) || 27;
  try {
    const qsInstEl = document.getElementById('qs-instructor');
    const qsInstValue = qsInstEl ? qsInstEl.value : '';
    const qsInstName = qsInstEl ? (qsInstEl.options[qsInstEl.selectedIndex] ? qsInstEl.options[qsInstEl.selectedIndex].text : qsInstValue) : '';
    const studentData = {
      name, phone,
      vehicle: document.getElementById('qs-vehicle').value,
      instructor: qsInstName || qsInstValue,
      instructorEmail: qsInstValue || '',
      instructorName: qsInstName || '',
      classTime: document.getElementById('qs-class-time') ? document.getElementById('qs-class-time').value : '',
      classes: 0,
      totalClasses,
      totalFee: parseInt(document.getElementById('qs-fee').value)||0,
      paid: amountPaid,
      installments: amountPaid > 0 ? [{ date: new Date().toISOString().split('T')[0], amount: amountPaid, mode: paymentMode, note: 'Initial payment' }] : [],
      status: document.getElementById('qs-status').value,
      enrolled: new Date().toISOString().split('T')[0],
      dob: document.getElementById('qs-dob').value || '',
      address: document.getElementById('qs-address').value || '',
      email: document.getElementById('qs-email').value || '',
      fcmToken: document.getElementById('qs-fcm-token').value.trim() || '',
      aadhaar: document.getElementById('qs-aadhaar').value || '',
      studentId: studentId || '',
      schoolId: currentSchoolId,
      ...FirebaseService.getOwnerScope()
    };
    
    await FirebaseService.addStudent(studentData);
    
    // Save class schedule if selected
    const selectedDays = Array.from(document.querySelectorAll('.qs-day-check:checked')).map(cb => cb.value);
    const scheduleStart = document.getElementById('qs-schedule-start')?.value;
    const sessionDuration = parseInt(document.getElementById('qs-session-duration')?.value || '60');
    const classTime = document.getElementById('qs-class-time')?.value;
    if (selectedDays.length > 0 && scheduleStart && currentSchoolId && typeof db !== 'undefined') {
      try {
        const scheduleEntry = {
          studentName: name,
          studentId: '',
          instructorEmail: qsInstValue,
          instructorName: qsInstName,
          days: selectedDays,
          startDate: scheduleStart,
          classTime: classTime || '',
          sessionDuration,
          schoolId: currentSchoolId,
          createdAt: new Date().toISOString()
        };
        await db.collection('schools').doc(currentSchoolId).collection('schedule').add(scheduleEntry);
      } catch(schedErr) { console.warn('Schedule save failed:', schedErr.message); }
    }

    if (studentData.fcmToken && studentData.email) {
      await saveUserFcmToken(studentData.email, studentData.fcmToken);
    }
    
    // Add cash flow entry if amount was paid
    if (amountPaid > 0) {
      const transactionData = {
        date: new Date().toISOString().split('T')[0],
        type: 'income',
        category: 'Student Fee',
        desc: `Student enrollment fee: ${name}`,
        amount: amountPaid,
        paymentMode: paymentMode,
        schoolId: currentSchoolId ? currentSchoolId : '',
        ...FirebaseService.getOwnerScope()
      };
      
      await FirebaseService.addTransaction(transactionData);
      addNotification(`Student enrolled and payment recorded: ₹${amountPaid}`,'success');
    } else {
      addNotification(`New student enrolled: ${name}`,'success');
    }
    
    closeModal('modal-add-student');
  } catch (error) {
    console.error('Error adding student:', error);
    alert('Error adding student. Please try again.');
  }
}

async function enrollStudent() {
  const name = document.getElementById('s-name').value.trim();
  const phone = document.getElementById('s-phone').value.trim();
  if(!name||!phone){
    document.getElementById('enroll-msg').innerHTML = '<div class="alert" style="background:#fee2e2;border:1px solid #fecaca;color:#b91c1c;">Please fill all required fields.</div>';
    return;
  }
  
  try {
    const paidAmt = parseInt(document.getElementById('s-paid').value)||0;
    const sInstEl = document.getElementById('s-instructor');
    const sInstValue = sInstEl ? sInstEl.value : '';
    const sInstName = sInstEl ? (sInstEl.options[sInstEl.selectedIndex] ? sInstEl.options[sInstEl.selectedIndex].text : sInstValue) : '';
    const studentData = {
      name, phone,
      email: document.getElementById('s-email').value,
      vehicle: document.getElementById('s-vehicle').value,
      instructor: sInstName || sInstValue,
      instructorEmail: sInstValue || '',
      instructorName: sInstName || '',
      classes: 0,
      totalClasses: parseInt(document.getElementById('s-total-classes') && document.getElementById('s-total-classes').value) || 27,
      totalFee: parseInt(document.getElementById('s-fee').value)||0,
      paid: paidAmt,
      fcmToken: document.getElementById('s-fcm-token') ? document.getElementById('s-fcm-token').value.trim() : '',
      installments: paidAmt > 0 ? [{ date: new Date().toISOString().split('T')[0], amount: paidAmt, mode: 'Cash', note: 'Initial payment' }] : [],
      status: 'Active',
      enrolled: document.getElementById('s-enroll').value || new Date().toISOString().split('T')[0],
      dob: document.getElementById('s-dob').value,
      address: document.getElementById('s-address').value,
      aadhaar: document.getElementById('s-aadhaar').value,
      schoolId: currentSchoolId,
      ...FirebaseService.getOwnerScope()
    };
    
    await FirebaseService.addStudent(studentData);
    if (studentData.fcmToken && studentData.email) {
      await saveUserFcmToken(studentData.email, studentData.fcmToken);
    }
    document.getElementById('enroll-msg').innerHTML = `<div class="alert alert-success">✓ ${name} enrolled successfully! Instructor: ${document.getElementById('s-instructor').value}</div>`;
    addNotification(`Student enrolled: ${name}`,'success');
    clearEnrollForm();
  } catch (error) {
    console.error('Error enrolling student:', error);
    document.getElementById('enroll-msg').innerHTML = '<div class="alert" style="background:#fee2e2;border:1px solid #fecaca;color:#b91c1c;">Error enrolling student. Please try again.</div>';
  }
}

function clearEnrollForm() {
  ['s-name','s-dob','s-phone','s-email','s-fcm-token','s-address','s-aadhaar','s-fee','s-paid','s-enroll','s-emergency'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value='';
  });
}

async function viewStudent(id) {
  // id can be local numeric id OR firebaseId string
  const studentId = String(id);
  let s = data.students.find(x => String(x.firebaseId) === studentId || String(x.id) === studentId);
  
  // If not found locally or we want fresh data, fetch from Firebase
  if (!s && currentSchoolId && typeof db !== 'undefined') {
    try {
      const doc = await db.collection('schools').doc(currentSchoolId).collection('students').doc(id).get();
      if (doc.exists) {
        s = { ...doc.data(), firebaseId: doc.id, id: doc.id };
      }
    } catch(e) {
      console.warn('Could not fetch student from Firebase:', e.message);
    }
  }
  
  if (!s) {
    showToast('⚠ Student not found'); return;
  }
  openStudentDetailModal(s);
}

function openStudentDetailModal(s) {
  // Remove old modal if exists
  const old = document.getElementById('modal-student-detail');
  if (old) old.remove();

  const totalFee = s.totalFee || 0;
  const paid = s.paid || 0;
  const balance = totalFee - paid;
  const pct = totalFee > 0 ? Math.round((paid/totalFee)*100) : 0;

  // Build installments HTML
  const installments = s.installments || [];
  const installHTML = installments.length > 0
    ? installments.map((inst,i) => `
        <tr>
          <td style="font-size:12px;color:var(--text2);">${inst.date}</td>
          <td style="font-weight:600;color:var(--success);">₹${(inst.amount||0).toLocaleString()}</td>
          <td style="font-size:12px;">${inst.mode || 'Cash'}</td>
          <td style="font-size:12px;color:var(--text2);">${inst.note || '—'}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--text2);">No installments recorded yet</td></tr>';

  const modal = document.createElement('div');
  modal.id = 'modal-student-detail';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
  <div class="modal" style="width:680px;max-width:96vw;max-height:90vh;overflow-y:auto;">
    <div class="modal-header">
      <h3>👤 ${s.name}</h3>
      <button class="modal-close" onclick="document.getElementById('modal-student-detail').remove()">✕</button>
    </div>

    <!-- Basic Info -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px;">
      <div style="background:var(--surface2);border-radius:10px;padding:14px 16px;">
        <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">📋 Personal</div>
        <div style="font-size:13px;line-height:2;">
          <span style="color:var(--text2);">Phone:</span> <strong>${s.phone}</strong><br>
          <span style="color:var(--text2);">Email:</span> <strong>${s.email || '—'}</strong><br>
          <span style="color:var(--text2);">DOB:</span> <strong>${s.dob || '—'}</strong><br>
          <span style="color:var(--text2);">Aadhaar:</span> <strong>${s.aadhaar || '—'}</strong><br>
          <span style="color:var(--text2);">Address:</span> <strong>${s.address || '—'}</strong>
        </div>
      </div>
      <div style="background:var(--surface2);border-radius:10px;padding:14px 16px;">
        <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">🚗 Course</div>
        <div style="font-size:13px;line-height:2;">
          <span style="color:var(--text2);">Vehicle:</span> <strong>${s.vehicle}</strong><br>
          <span style="color:var(--text2);">Instructor:</span> <strong>${s.instructor || '—'}</strong><br>
          <span style="color:var(--text2);">Class Time:</span> <strong>${s.classTime || '—'}</strong><br>
          <span style="color:var(--text2);">Enrolled:</span> <strong>${s.enrolled || '—'}</strong><br>
          <span style="color:var(--text2);">Status:</span> <span class="badge ${s.status==='Active'?'badge-green':s.status==='Completed'?'badge-purple':'badge-amber'}">${s.status}</span>
        </div>
      </div>
    </div>

    <!-- Classes Progress -->
    <div style="background:var(--surface2);border-radius:10px;padding:14px 16px;margin-bottom:18px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;">📚 Classes Progress</div>
        <strong style="font-size:15px;">${s.classes || 0} / ${s.totalClasses || 27}</strong>
      </div>
      <div class="progress-bar" style="height:10px;">
        <div class="progress-fill" style="width:${Math.min(100,Math.round(((s.classes||0)/(s.totalClasses||27))*100))}%;background:${(s.classes||0)>=(s.totalClasses||27)?'var(--success)':'var(--accent2)'}"></div>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-top:6px;">${Math.min(100,Math.round(((s.classes||0)/(s.totalClasses||27))*100))}% complete · ${Math.max(0,(s.totalClasses||27)-(s.classes||0))} classes remaining</div>
    </div>

    <!-- Fee Summary -->
    <div style="background:var(--surface2);border-radius:10px;padding:14px 16px;margin-bottom:18px;">
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px;">💰 Fee Details</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;">
        <div style="background:white;border-radius:8px;padding:12px;text-align:center;border:1px solid var(--border);">
          <div style="font-size:11px;color:var(--text2);">Total Fee</div>
          <div style="font-size:18px;font-weight:700;font-family:'Syne';">₹${totalFee.toLocaleString()}</div>
        </div>
        <div style="background:#f0fdf4;border-radius:8px;padding:12px;text-align:center;border:1px solid #bbf7d0;">
          <div style="font-size:11px;color:var(--text2);">Paid</div>
          <div style="font-size:18px;font-weight:700;font-family:'Syne';color:var(--success);">₹${paid.toLocaleString()}</div>
        </div>
        <div style="background:${balance>0?'#fef2f2':'#f0fdf4'};border-radius:8px;padding:12px;text-align:center;border:1px solid ${balance>0?'#fecaca':'#bbf7d0'};">
          <div style="font-size:11px;color:var(--text2);">Balance Due</div>
          <div style="font-size:18px;font-weight:700;font-family:'Syne';color:${balance>0?'var(--danger)':'var(--success)'};">₹${balance.toLocaleString()}</div>
        </div>
      </div>
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px;"><span>Payment Progress</span><span>${pct}%</span></div>
        <div class="progress-bar" style="height:8px;">
          <div class="progress-fill" style="width:${pct}%;background:${pct>=100?'var(--success)':pct>=50?'var(--accent2)':'var(--warning)'}"></div>
        </div>
      </div>
    </div>

    <!-- Notification / FCM Token -->
    <div style="background:var(--surface2);border-radius:10px;padding:14px 16px;margin-bottom:18px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-size:13px;font-weight:600;">🔔 Student Notifications</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr;gap:10px;">
        <div class="form-group full"><label>FCM Token</label><textarea id="student-fcm-token-${s.firebaseId || s.id}" style="min-height:70px;">${s.fcmToken || ''}</textarea></div>
        <div class="form-group"><label>Message Title</label><input type="text" id="student-msg-title-${s.firebaseId || s.id}" value="Class Schedule Update"></div>
        <div class="form-group"><label>Class Time</label><input type="time" id="student-msg-time-${s.firebaseId || s.id}" value="${s.classTime || ''}"></div>
        <div class="form-group full"><label>Optional Note</label><input type="text" id="student-msg-note-${s.firebaseId || s.id}" placeholder="Optional note or schedule detail"></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
        <button class="btn btn-accent btn-sm" onclick="saveStudentFcmToken(${JSON.stringify(s.firebaseId || s.id)})">Save Token</button>
        <button class="btn btn-primary btn-sm" onclick="sendStudentClassSchedule(${JSON.stringify(s.firebaseId || s.id)})">Send Schedule</button>
      </div>
      <div id="student-notification-feedback-${s.firebaseId || s.id}" style="font-size:12px;color:var(--text2);margin-top:8px;"></div>
    </div>

    <!-- Installment History -->
    <div style="margin-bottom:18px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-family:'Syne';font-size:14px;font-weight:600;">💳 Installment History</div>
        ${balance > 0 ? `<button class="btn btn-accent btn-sm" onclick="openAddInstallmentForm('${s.id}')">+ Add Installment</button>` : '<span class="badge badge-green">✓ Fully Paid</span>'}
      </div>
      <table class="data-table">
        <thead><tr><th>Date</th><th>Amount</th><th>Mode</th><th>Note</th></tr></thead>
        <tbody id="installment-list-${s.id}">${installHTML}</tbody>
      </table>
    </div>

    <!-- Add Installment Form (hidden by default) -->
    <div id="add-inst-form-${s.id}" style="display:none;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;margin-bottom:16px;">
      <div style="font-size:13px;font-weight:600;color:var(--primary);margin-bottom:12px;">Add New Installment</div>
      <div class="form-grid">
        <div class="form-group"><label>Date *</label><input type="date" id="inst-date-${s.id}" value="${new Date().toISOString().split('T')[0]}"></div>
        <div class="form-group"><label>Amount (₹) *</label><input type="number" id="inst-amount-${s.id}" placeholder="Enter amount" max="${balance}"></div>
        <div class="form-group"><label>Payment Mode</label>
          <select id="inst-mode-${s.id}"><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option></select>
        </div>
        <div class="form-group"><label>Note</label><input type="text" id="inst-note-${s.id}" placeholder="Optional note"></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:12px;">
        <button class="btn btn-success btn-sm" onclick="saveInstallment('${s.id}')">✓ Save</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('add-inst-form-${s.id}').style.display='none'">Cancel</button>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-top:8px;">Remaining balance: ₹${balance.toLocaleString()}</div>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;border-top:1px solid var(--border);padding-top:16px;">
      <button class="btn btn-outline" onclick="document.getElementById('modal-student-detail').remove()">Close</button>
    </div>
  </div>`;

  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  // Load attendance stats for this student
  loadStudentAttendanceStats(s.firebaseId || s.id);
}

async function saveStudentFcmToken(studentId) {
  const id = studentId || '';
  const fieldId = 'student-fcm-token-' + id;
  const tokenField = document.getElementById(fieldId);
  if (!tokenField) {
    alert('Could not find the FCM token field.');
    return;
  }

  const token = tokenField.value.trim();
  if (!token) {
    alert('Please enter the student FCM token before saving.');
    return;
  }

  let student = data.students.find(x => String(x.firebaseId) === String(id) || String(x.id) === String(id));
  if (!student && currentSchoolId && typeof db !== 'undefined') {
    try {
      const doc = await db.collection('schools').doc(currentSchoolId).collection('students').doc(id).get();
      if (doc.exists) student = { id: doc.id, ...doc.data() };
    } catch (error) {
      console.error('Failed to load student for token save:', error);
    }
  }

  if (!student) {
    alert('Student record not found.');
    return;
  }

  try {
    const docId = student.firebaseId || student.id;
    await FirebaseService.updateStudent(docId, { fcmToken: token });
    if (student.email) {
      await saveUserFcmToken(student.email, token);
    }
    student.fcmToken = token;
    showToast('FCM token saved successfully');
  } catch (error) {
    console.error('Failed to save student FCM token:', error);
    alert('Unable to save the student FCM token.');
  }
}

async function sendStudentClassSchedule(studentId) {
  const id = studentId || '';
  const tokenField = document.getElementById('student-fcm-token-' + id);
  const titleField = document.getElementById('student-msg-title-' + id);
  const timeField = document.getElementById('student-msg-time-' + id);
  const noteField = document.getElementById('student-msg-note-' + id);
  const feedback = document.getElementById('student-notification-feedback-' + id);

  if (!titleField || !timeField || !feedback) {
    alert('Notification form is not available.');
    return;
  }

  const classTitle = titleField.value.trim() || 'Class Schedule Update';
  const classTime = timeField.value.trim();
  const note = noteField ? noteField.value.trim() : '';
  const token = tokenField ? tokenField.value.trim() : '';

  if (!classTime) {
    alert('Please select a class time to send.');
    return;
  }

  let student = data.students.find(x => String(x.firebaseId) === String(id) || String(x.id) === String(id));
  if (!student && currentSchoolId && typeof db !== 'undefined') {
    try {
      const doc = await db.collection('schools').doc(currentSchoolId).collection('students').doc(id).get();
      if (doc.exists) student = { id: doc.id, ...doc.data() };
    } catch (error) {
      console.error('Failed to load student for sending notification:', error);
    }
  }

  if (!student) {
    alert('Student record not found.');
    return;
  }

  const payload = {
    token: token || undefined,
    email: (!token && student.email) ? student.email : undefined,
    classTime,
    classTitle,
    studentName: student.name || '',
    note,
    scheduleId: student.firebaseId || student.id || ''
  };

  if (!payload.token && !payload.email) {
    alert('Please save the student FCM token or ensure an email address exists.');
    return;
  }

  if (!firebaseFunctions) {
    alert('Firebase Functions is not initialized. Make sure the Firebase Functions SDK is loaded.');
    return;
  }

  try {
    feedback.textContent = 'Sending message…';
    const callable = firebaseFunctions.httpsCallable('sendClassSchedule');
    const result = await callable(payload);
    if (result && result.data && result.data.success) {
      feedback.textContent = 'Class schedule message sent successfully.' + (note ? ' Note: ' + note : '');
    } else {
      console.error('FCM send failed:', result);
      feedback.textContent = 'Failed to send class schedule.';
    }
  } catch (error) {
    console.error('Error sending class schedule:', error);
    const message = error && error.message ? error.message : 'Unable to send notification. Check server and token.';
    feedback.textContent = message;
  }
}

async function loadStudentAttendanceStats(firebaseId) {
  // Load student attendance history and update any stats panels in the modal
  if (!currentSchoolId || !firebaseId || typeof db === 'undefined') return;
  try {
    const snap = await db.collection('schools').doc(currentSchoolId)
      .collection('studentAttendance')
      .where('studentId', '==', String(firebaseId))
      .orderBy('date','desc').limit(30).get();
    const records = snap.docs.map(d => d.data());
    // Could inject into modal here if we add an attendance section — placeholder for future
  } catch(e) { /* non-fatal */ }
}

function openAddInstallmentForm(studentId) {
  const form = document.getElementById('add-inst-form-' + studentId);
  if (form) form.style.display = 'block';
}

async function saveInstallment(studentId) {
  const s = data.students.find(x => x.id == studentId || x.id === studentId);
  if (!s) return;

  const date = document.getElementById('inst-date-' + studentId)?.value;
  const amount = parseFloat(document.getElementById('inst-amount-' + studentId)?.value || '0');
  const mode = document.getElementById('inst-mode-' + studentId)?.value || 'Cash';
  const note = document.getElementById('inst-note-' + studentId)?.value || '';

  if (!date || amount <= 0) { alert('Please enter date and valid amount'); return; }

  const totalFee = s.totalFee || 0;
  const currentPaid = s.paid || 0;
  const balance = totalFee - currentPaid;

  if (amount > balance) { alert(`Amount cannot exceed remaining balance of ₹${balance.toLocaleString()}`); return; }

  // Update student installments
  if (!s.installments) s.installments = [];
  s.installments.push({ date, amount, mode, note });
  s.paid = currentPaid + amount;

  const firebaseDocId = s.firebaseId || (typeof studentId === 'string' && studentId.length > 10 ? studentId : null);
  try {
    // Save to Firebase
    if (currentSchoolId && firebaseDocId) {
      await db.collection('schools').doc(currentSchoolId).collection('students').doc(firebaseDocId).update({
        paid: s.paid,
        installments: s.installments
      });
    }

    // Add to cashflow — scoped to this school
    if (currentSchoolId) {
      await FirebaseService.addTransaction({
        date,
        type: 'income',
        category: 'Student Fee',
        desc: 'Installment from ' + s.name + ' (' + mode + ')',
        amount,
        paymentMode: mode,
        studentId: firebaseDocId || studentId,
        schoolId: currentSchoolId
      });
    }

    addNotification(`Installment of ₹${amount.toLocaleString()} saved for ${s.name}`, 'success');
    // Reopen modal with updated data
    document.getElementById('modal-student-detail')?.remove();
    openStudentDetailModal(s);
  } catch (err) {
    console.error('Error saving installment:', err);
    alert('Error saving installment. Please try again.');
  }
}

// Switch between student form tabs
function switchStudentTab(tabName, tabElement) {
  // Hide all tab content
  document.querySelectorAll('[id^="stab-"]').forEach(tab => {
    tab.style.display = 'none';
  });
  
  // Remove active class from all tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Show selected tab content
  const selectedTab = document.getElementById('stab-' + tabName);
  if (selectedTab) {
    selectedTab.style.display = 'block';
  }
  
  // Add active class to clicked tab
  if (tabElement) {
    tabElement.classList.add('active');
  }
}

// Toggle service selection
function toggleService(element, serviceName, fee) {
  const checkbox = element.querySelector('.svc-check');
  checkbox.checked = !checkbox.checked;
  
  if (checkbox.checked) {
    element.style.borderColor = 'var(--accent)';
    element.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
  } else {
    element.style.borderColor = 'var(--border)';
    element.style.backgroundColor = '';
  }
}

// ============================================================
// CASHFLOW
// ============================================================
async function renderCashflow() {
  try {
    // Check if school is selected
    if (!currentSchoolId) {
      const sum = document.getElementById('cf-summary');
      if(sum) sum.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2);">Please select a school to view cashflow</div>';
      
      const tb = document.getElementById('cf-table');
      if(tb) tb.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2);">No school selected</div>';
      return;
    }
    
    const monthFilter = document.getElementById('cf-month-filter')?.value || new Date().toISOString().slice(0,7);
    let transactions;
    
    if (monthFilter) {
      transactions = await FirebaseService.getTransactions(monthFilter);
    } else {
      transactions = data.transactions;
    }
    
    // Apply role-based filtering
    transactions = filterDataByRole('transactions', transactions);
    
    const income = transactions.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
    const expense = transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
    const profit = income - expense;

    const schoolStudents = (data.students||[]).filter(s => !currentSchoolId || s.schoolId === currentSchoolId);
    const pendingBal = schoolStudents.reduce((sum,s)=>{const b=(s.totalFee||0)-(s.paid||0);return sum+(b>0?b:0);},0);
    const sum = document.getElementById('cf-summary');
    if(sum) sum.innerHTML = `
      <div class="cf-box cf-income"><div class="cfl">Total Income</div><div class="cfv">₹${income.toLocaleString()}</div></div>
      <div class="cf-box cf-expense"><div class="cfl">Total Expense</div><div class="cfv">₹${expense.toLocaleString()}</div></div>
      <div class="cf-box cf-profit"><div class="cfl">Net Profit</div><div class="cfv">₹${profit.toLocaleString()}</div></div>
      <div class="cf-box" style="background:#fffbeb;border:1px solid #fde68a;"><div class="cfl">Pending from Students</div><div class="cfv" style="color:var(--warning);">₹${pendingBal.toLocaleString()}</div></div>
    `;

  const tb = document.getElementById('cf-table');
  if(tb) tb.innerHTML = transactions.map(t => `
    <tr>
      <td style="color:var(--text2);font-size:12px;">${t.date}</td>
      <td><span class="badge badge-gray">${t.category}</span></td>
      <td>${t.desc}</td>
      <td><span class="badge ${t.type==='income'?'badge-green':'badge-red'}">${t.type}</span></td>
      <td style="font-weight:600;color:${t.type==='income'?'var(--success)':'var(--danger)'}">
        ${t.type==='income'?'+':'-'}₹${t.amount.toLocaleString()}
      </td>
    </tr>
  `).join('');
  } catch (error) {
    console.error('Error rendering cashflow:', error);
  }
}

// ── OFFICE SELF-ATTENDANCE ───────────────────────────────────────────────────
let officeAttMarked = false;

function openOfficeAttModal() {
  if (officeAttMarked) { showToast('✅ Attendance already marked for today!'); return; }
  const now = new Date();
  openModal('modal-self-attendance'); // reuse the same modal
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const timeEl = document.getElementById('self-att-check-in');
  if (timeEl) timeEl.value = hh + ':' + mm;
  // Override the save button to call officeMarkPresent
  const modal = document.getElementById('modal-self-attendance');
  if (modal) {
    const btn = modal.querySelector('.btn-accent');
    if (btn) btn.onclick = officeMarkPresent;
  }
}

async function officeMarkPresent() {
  const status   = document.getElementById('self-att-status')?.value || 'present';
  const time     = document.getElementById('self-att-check-in')?.value || '';
  const location = document.getElementById('self-att-location')?.value || 'Office';
  const note     = document.getElementById('self-att-note')?.value || '';
  const today = new Date().toISOString().split('T')[0];
  const students = (data.students || []).filter(s => s.schoolId === currentSchoolId && (s.status === 'Active' || s.status === 'Pending' || !s.status));

  // Ensure we have today's schedule map early so we can include scheduled students
  const scheduleMap = getTodayScheduleMap();
  const availableInstructors = getAvailableInstructors();

  const assignedStudents = currentRole === 'instructor'
    ? (function() {
        const instructorName = getCurrentInstructorName();
        // students explicitly assigned to this instructor in their record
        const byRecord = students.filter(s => s.instructorEmail === (currentUser?.email || '') || s.instructor === (currentUser?.email || '') || s.instructor === instructorName);

        // students scheduled today for this instructor (even if their student record isn't assigned)
        const scheduledForMe = [];
        Object.values(scheduleMap).forEach(entry => {
          if (!entry) return;
          const instEmail = (entry.instructorEmail || '').toString();
          const instName = (entry.instructorName || entry.instructor || '').toString();
          if (instEmail === (currentUser?.email || '') || instName === instructorName) {
            const key = entry.studentId || entry.studentName || '';
            const stud = students.find(ss => getStudentKey(ss) === key || ss.firebaseId === key || ss.id === key || ss.studentId === key || ss.name === key);
            if (stud && !scheduledForMe.some(x => getStudentKey(x) === getStudentKey(stud))) scheduledForMe.push(stud);
          }
        });

        // union of record-assigned and schedule-assigned students
        const map = {};
        byRecord.concat(scheduledForMe).forEach(s => { map[getStudentKey(s)] = s; });
        return Object.values(map);
      })()
    : students;

  const instructorOptions = availableInstructors.map(inst => `<option value="${inst.email || inst.name}">${inst.name}${inst.email ? ' — ' + inst.email : ''}</option>`).join('');
  if (sub) sub.textContent = 'Checked in at ' + time;
  const tb = document.getElementById('office-att-time-block');
  if (tb) { tb.style.display = 'block'; document.getElementById('office-att-time').textContent = time; }
  const btn = document.getElementById('office-mark-btn');
  if (btn) { btn.textContent = '✅ Marked'; btn.disabled = true; }

  // Save to Firebase
  const entry = {
    date: today, time, status, location, note,
    type: 'Office',
    userName: currentUser ? (currentUser.displayName || currentUser.email) : 'Unknown',
    userEmail: currentUser ? currentUser.email : '',
    userId: currentUser ? currentUser.uid : '',
    schoolId: currentSchoolId || ''
  };
  try {
    if (typeof db !== 'undefined' && currentSchoolId) {
      await db.collection('schools').doc(currentSchoolId).collection('attendance')
        .doc(getAttendanceDocId(today, currentRole, currentUser))
        .set(entry);
      await syncSelfAttendanceToRoleCollection(today, {
        status,
        type: 'in',
        time,
        note,
        notes: note,
        location,
        markedBy: entry.userEmail,
        markedAt: new Date().toISOString(),
        userRole: currentRole
      });
    }
    renderOfficeAttHistory();
  } catch(e) { console.warn('Could not save office attendance:', e.message); }
  closeModal('modal-self-attendance');
  showToast('✅ Attendance marked!');
}

function updateOfficeAttendanceTodayState(todayRecord) {
  const banner = document.getElementById('office-att-banner');
  const msg = document.getElementById('office-att-msg');
  const sub = document.getElementById('office-att-sub');
  const timeBlock = document.getElementById('office-att-time-block');
  const timeEl = document.getElementById('office-att-time');
  const btn = document.getElementById('office-mark-btn');

  if (todayRecord && (todayRecord.status === 'present' || todayRecord.status === 'late' || todayRecord.status === 'checked_out')) {
    officeAttMarked = true;
    if (banner) banner.style.background = 'linear-gradient(135deg,#15803d,#16a34a)';
    if (msg) msg.textContent = todayRecord.status === 'late' ? 'Marked Late' : 'Attendance Marked Present';
    if (sub) sub.textContent = 'Checked in at ' + (todayRecord.time || 'marked');
    if (timeBlock) timeBlock.style.display = 'block';
    if (timeEl) timeEl.textContent = todayRecord.time || '-';
    if (btn) {
      btn.textContent = 'Marked';
      btn.disabled = true;
    }
    return;
  }

  officeAttMarked = false;
  if (banner) banner.style.background = '';
  if (msg) msg.textContent = 'Mark Your Attendance to Begin';
  if (sub) sub.textContent = "You haven't marked attendance for today yet.";
  if (timeBlock) timeBlock.style.display = 'none';
  if (timeEl) timeEl.textContent = '-';
  if (btn) {
    btn.textContent = 'Mark My Attendance';
    btn.disabled = false;
  }
}

async function renderOfficeAttHistory() {
  const today = new Date().toISOString().split('T')[0];
  try {
    let records = await loadSelfAttendanceRecords(30);
    updateOfficeAttendanceTodayState(records.find(r => r.date === today));
    let present=0, absent=0, late=0;
    records.forEach(r => {
      if(r.status==='present') present++;
      else if(r.status==='absent') absent++;
      else if(r.status==='late') late++;
    });
    const total = records.length;
    const rate = total > 0 ? Math.round(((present+late)/total)*100) : 0;
    const setEl = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
    setEl('office-stat-present', present);
    setEl('office-stat-absent', absent);
    setEl('office-stat-rate', rate+'%');
    setEl('office-stat-ontime', present);
    const tbody = document.getElementById('office-att-history');
    if (!tbody) return;
    tbody.innerHTML = records.length === 0
      ? '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text2);">No records yet.</td></tr>'
      : records.map(r => {
          const cls = r.status==='present'?'badge-green':r.status==='late'?'badge-amber':'badge-red';
          return '<tr><td>'+r.date+'</td><td>'+r.time+'</td><td><span class="badge '+cls+'">'+r.status+'</span></td><td>'+(r.note||'—')+'</td></tr>';
        }).join('');
  } catch(e) { console.warn('office att history error:', e.message); }
}

// Hook office-attendance page into refreshPage
const _origRefreshPage = typeof refreshPage === 'function' ? refreshPage : null;

async function addTransaction() {
  // Check if user has permission to add transactions
  if (!hasActionPermission('add_transaction')) {
    alert('You do not have permission to add transactions.');
    return;
  }
  if (!currentSchoolId) {
    alert('Please select a school first before adding a transaction.');
    return;
  }
  const amount = parseInt(document.getElementById('tx-amount').value);
  if(!amount){alert('Enter amount');return;}
  
  try {
    const transactionData = {
      date: document.getElementById('tx-date').value || new Date().toISOString().split('T')[0],
      type: document.getElementById('tx-type').value,
      category: document.getElementById('tx-cat').value,
      desc: document.getElementById('tx-desc').value || 'Entry',
      amount,
      schoolId: currentSchoolId
    };
    
    await FirebaseService.addTransaction(transactionData);
    closeModal('modal-add-tx');
    addNotification(`Transaction added: ${transactionData.desc}`,'success');
  } catch (error) {
    console.error('Error adding transaction:', error);
    alert('Error adding transaction. Please try again.');
  }
}

// ============================================================
// REPORTS
// ============================================================
function renderReport() {
  const period = document.getElementById('report-period')?.value || 'monthly';
  const rc = document.getElementById('report-content');
  if(!rc) return;

  // Scope to current school
  const schoolStudents = (data.students||[]).filter(s => !currentSchoolId || s.schoolId === currentSchoolId);
  const schoolTx = (data.transactions||[]).filter(t => !currentSchoolId || t.schoolId === currentSchoolId);

  if(period==='monthly') {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthData = [];
    const totalIncome = monthData.reduce((s,m)=>s+m.income,0);
    const totalExpense = monthData.reduce((s,m)=>s+m.expense,0);

    rc.innerHTML = `<div class="report-section">
      <div class="report-header">
        <h3>Monthly Financial Report — 2025</h3>
        <p>DrivePro Driving School | Generated ${new Date().toLocaleDateString('en-IN')}</p>
      </div>
      <div class="report-body">
        ${monthData.map((m,i) => `
          <div class="report-row">
            <span>${months[i]}</span>
            <div style="display:flex;gap:20px;font-size:13px;">
              <span style="color:var(--success);">Income: ₹${m.income.toLocaleString()}</span>
              <span style="color:var(--danger);">Expense: ₹${m.expense.toLocaleString()}</span>
              <span style="color:var(--accent2);font-weight:600;">Profit: ₹${(m.income-m.expense).toLocaleString()}</span>
            </div>
          </div>
        `).join('')}
        <div class="report-total">
          <span>Annual Total</span>
          <div style="display:flex;gap:20px;">
            <span style="color:var(--success);">₹${totalIncome.toLocaleString()}</span>
            <span style="color:var(--danger);">₹${totalExpense.toLocaleString()}</span>
            <span style="color:var(--accent2);">₹${(totalIncome-totalExpense).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>`;
  } else {
    const years = [];
    rc.innerHTML = `<div class="report-section">
      <div class="report-header">
        <h3>Yearly Financial Report</h3>
        <p>DrivePro Driving School | All Years</p>
      </div>
      <div class="report-body">
        ${years.map(y => `
          <div class="report-row">
            <span style="font-weight:600;">${y.year}</span>
            <div style="display:flex;gap:20px;font-size:13px;">
              <span style="color:var(--success);">Income: ₹${y.income.toLocaleString()}</span>
              <span style="color:var(--danger);">Expense: ₹${y.expense.toLocaleString()}</span>
              <span style="color:var(--accent2);font-weight:600;">Profit: ₹${(y.income-y.expense).toLocaleString()}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
  }
}

function switchCFChart(mode, el) {
  el.closest('.tabs').querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
}

function printReport() {
  window.print();
}

// ============================================================
// DL TESTS
// ============================================================
function renderDLTests() {
  const list = document.getElementById('dl-tests-list');
  if(list) list.innerHTML = data.dlTests.map(t => `
    <div class="dl-card">
      <h4>🪪 ${t.student}</h4>
      <div class="dl-row"><span>Test Date</span><span>${t.date}</span></div>
      <div class="dl-row"><span>Time</span><span>${t.time}</span></div>
      <div class="dl-row"><span>RTO</span><span>${t.rto}</span></div>
      <div class="dl-row"><span>Vehicle</span><span>${t.vehicle}</span></div>
      <div style="margin-top:10px;"><span class="badge badge-green">${t.status}</span></div>
    </div>
  `).join('') || '<p style="color:var(--text3)">No tests scheduled</p>';

  const eligible = data.students.filter(s => s.classes >= 22 && s.status !== 'Completed');
  const eList = document.getElementById('dl-eligible-list');
  if(eList) eList.innerHTML = eligible.map(s => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:var(--surface2);border-radius:8px;margin-bottom:8px;">
      <div>
        <div style="font-weight:500;">${s.name}</div>
        <div style="font-size:12px;color:var(--text2);">${s.classes} classes • ${s.vehicle}</div>
      </div>
      <button class="btn btn-accent btn-sm" onclick="quickSchedule('${s.name}')">Schedule</button>
    </div>
  `).join('') || '<p style="color:var(--text3);font-size:13px;">No eligible students yet</p>';
}

function openScheduleDLModal() {
  // Populate eligible students in DL dropdown
  const sel = document.getElementById('dl-student');
  if (sel) {
    sel.innerHTML = '<option value="">Select Student</option>';
    const eligible = data.students.filter(s => s.classes >= 22 && s.status !== 'Completed');
    if (eligible.length === 0) {
      sel.innerHTML += '<option value="" disabled>No eligible students (need 22+ classes)</option>';
    } else {
      eligible.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.textContent = s.name + ' — ' + s.classes + ' classes';
        sel.appendChild(opt);
      });
    }
  }
  openModal('modal-schedule-dl');
}

function scheduleDLTest() {
  const student = document.getElementById('dl-student').value;
  const date = document.getElementById('dl-date').value;
  const time = document.getElementById('dl-time').value;
  const rto = document.getElementById('dl-rto').value;
  if(!date||!rto){alert('Fill date and RTO');return;}
  data.dlTests.push({student,date,time:time||'09:00',rto,vehicle:document.getElementById('dl-vtype').value,status:'Scheduled'});
  addNotification(`DL Test scheduled for ${student} on ${date} at ${rto}`,'info');
  closeModal('modal-schedule-dl');
  renderDLTests();
}

function quickSchedule(name) {
  openScheduleDLModal();
  setTimeout(() => {
    const sel = document.getElementById('dl-student');
    if (sel) {
      // Find or add the option
      let found = false;
      for (let opt of sel.options) { if (opt.value === name) { opt.selected = true; found = true; break; } }
      if (!found) { const o = document.createElement('option'); o.value = name; o.textContent = name; o.selected = true; sel.appendChild(o); }
    }
  }, 50);
}

// ============================================================
// ATTENDANCE
// ============================================================
let gpsVerified = false;
let photoTaken = false;

async function checkGPS() {
  const status = document.getElementById('gps-status');
  const coords = document.getElementById('gps-coords');
  
  status.textContent = 'Getting location...';
  status.style.color = 'var(--text2)';
  
  try {
    const userLocation = await LocationService.getCurrentLocation();
    
    // Get current school data
    if (!currentSchoolId) {
      status.textContent = '❌ No school selected';
      status.style.color = 'var(--danger)';
      return;
    }
    
    const currentSchool = userSchools.find(school => school.id === currentSchoolId);
    if (!currentSchool || !currentSchool.latitude || !currentSchool.longitude) {
      status.textContent = '❌ School location not set';
      status.style.color = 'var(--danger)';
      return;
    }
    
    // Calculate distance
    const distance = LocationService.calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      currentSchool.latitude,
      currentSchool.longitude
    );
    
    coords.textContent = `${userLocation.latitude.toFixed(6)}°, ${userLocation.longitude.toFixed(6)}° (±${Math.round(userLocation.accuracy)}m)`;
    
    if (distance <= 100) {
      gpsVerified = true;
      status.textContent = `✓ Within ${Math.round(distance)}m — Location Verified`;
      status.style.color = 'var(--success)';
    } else {
      gpsVerified = false;
      status.textContent = `❌ ${Math.round(distance)}m away — Must be within 100m`;
      status.style.color = 'var(--danger)';
    }
  } catch (error) {
    status.textContent = '❌ ' + error.message;
    status.style.color = 'var(--danger)';
    gpsVerified = false;
  }
}

function simulatePhoto() {
  if(!gpsVerified){
    alert('Please verify GPS location first (must be within 100m)');
    return;
  }
  document.getElementById('photo-preview').textContent = '✅';
  document.getElementById('photo-status').textContent = 'Photo captured & verified!';
  document.getElementById('photo-status').style.color = 'var(--success)';
  photoTaken = true;
}

function renderAttendance() {
  if (currentRole === 'instructor') renderSelfAttHistory();
  // Show attendance overview with quick stats and navigation
  renderAttendanceOverview();
}

async function renderAttendanceOverview() {
  try {
    // Update today's date
    const today = new Date().toISOString().split('T')[0];
    const dateEl = document.getElementById('att-today-date');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    }

    // Calculate quick stats from current school data
    const todayAttendance = data.attendance[today] || {};
    const presentCount = Object.values(todayAttendance).filter(a => a.status === 'present').length;
    const totalCount = Object.keys(todayAttendance).length;
    const attendanceRate = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

    // Update quick stats
    document.getElementById('quick-att-today').textContent = presentCount;
    document.getElementById('quick-att-rate').textContent = attendanceRate + '%';

    // Calculate weekly average (simplified)
    const weekAverage = Math.round(presentCount * 0.8); // Rough estimate
    document.getElementById('quick-att-week').textContent = weekAverage;

    // Calculate monthly average (simplified)
    const monthAverage = Math.round(presentCount * 0.75); // Rough estimate
    document.getElementById('quick-att-month').textContent = monthAverage;

    // Render recent activity
    renderRecentActivity();

  } catch (error) {
    console.error('Error rendering attendance overview:', error);
    addNotification('Error loading attendance overview', 'error');
  }
}

function renderRecentActivity() {
  const activityDiv = document.getElementById('recent-activity');
  if (!activityDiv) return;

  try {
    // Get recent attendance from today and yesterday
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    
    const todayAttendance = data.attendance[today] || {};
    const yesterdayAttendance = data.attendance[yesterday] || {};

    // Combine and create activity items
    const recentActivities = [];
    
    // Today's activities
    Object.entries(todayAttendance).forEach(([name, data]) => {
      recentActivities.push({
        name,
        status: data.status,
        time: data.time,
        date: 'Today',
        type: 'student'
      });
    });

    // Yesterday's activities (limited)
    Object.entries(yesterdayAttendance).slice(0, 3).forEach(([name, data]) => {
      recentActivities.push({
        name,
        status: data.status,
        time: data.time,
        date: 'Yesterday',
        type: 'student'
      });
    });

    if (recentActivities.length === 0) {
      activityDiv.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text2);">
          <div style="font-size: 24px; margin-bottom: 8px;">📊</div>
          <div>No recent attendance activity</div>
        </div>
      `;
      return;
    }

    activityDiv.innerHTML = recentActivities.map(activity => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 8px; height: 8px; border-radius: 50%; background: ${activity.status === 'present' ? 'var(--success)' : 'var(--danger)'};"></div>
          <div>
            <div style="font-weight: 500; color: var(--text);">${activity.name}</div>
            <div style="font-size: 11px; color: var(--text2);">${activity.date} ${activity.time || ''}</div>
          </div>
        </div>
        <span class="badge ${activity.status === 'present' ? 'badge-green' : 'badge-red'}" style="font-size: 10px;">
          ${activity.status === 'present' ? 'Present' : 'Absent'}
        </span>
      </div>
    `).join('');

  } catch (error) {
    console.error('Error rendering recent activity:', error);
  }
}

function renderAttendanceByType(userType) {
  let grid, countEl, users, attendanceData, countPrefix;
  
  switch(userType) {
    case 'students':
      grid = document.getElementById('attendance-grid-students');
      countEl = document.getElementById('att-students-count');
      users = getFilteredData('students');
      attendanceData = data.attendance[new Date().toISOString().split('T')[0]] || {};
      countPrefix = 'Students';
      break;
    case 'instructors':
      grid = document.getElementById('attendance-grid-instructors');
      countEl = document.getElementById('att-instructors-count');
      users = data.admins.filter(admin => admin.role === 'instructor');
      attendanceData = data.instructorAttendance[new Date().toISOString().split('T')[0]] || {};
      users.forEach(user => {
        const key = getAttendanceUserKey(user);
        if (!attendanceData[user.name] && attendanceData[key]) attendanceData[user.name] = attendanceData[key];
        if (!attendanceData[user.email] && attendanceData[key]) attendanceData[user.email] = attendanceData[key];
      });
      countPrefix = 'Instructors';
      break;
    case 'staff':
      grid = document.getElementById('attendance-grid-staff');
      countEl = document.getElementById('att-staff-count');
      users = data.staff;
      attendanceData = data.staffAttendance[new Date().toISOString().split('T')[0]] || {};
      users.forEach(user => {
        const key = getAttendanceUserKey(user);
        if (!attendanceData[user.name] && attendanceData[key]) attendanceData[user.name] = attendanceData[key];
        if (!attendanceData[user.email] && attendanceData[key]) attendanceData[user.email] = attendanceData[key];
      });
      countPrefix = 'Staff';
      break;
    case 'admins':
      grid = document.getElementById('attendance-grid-admins');
      countEl = document.getElementById('att-admins-count');
      users = data.admins.filter(admin => admin.role !== 'instructor');
      attendanceData = data.adminAttendance[new Date().toISOString().split('T')[0]] || {};
      users.forEach(user => {
        const key = getAttendanceUserKey(user);
        if (!attendanceData[user.name] && attendanceData[key]) attendanceData[user.name] = attendanceData[key];
        if (!attendanceData[user.email] && attendanceData[key]) attendanceData[user.email] = attendanceData[key];
      });
      countPrefix = 'Admins';
      break;
    default:
      return;
  }
  
  if(!grid) return;
  
  const present = Object.values(attendanceData).filter(v=>v.status==='present').length;
  if(countEl) countEl.textContent = `${present}/${users.length} marked`;
  
  grid.innerHTML = users.map(user => {
    const userName = user.name || user.email;
    const rec = attendanceData[userName] || attendanceData[user.email] || attendanceData[user.userId] || attendanceData[user.firebaseId];
    const status = rec?.status || 'unmarked';
    const statusColor = status==='present'?'var(--success)':status==='absent'?'var(--danger)':'var(--text2)';
    const statusIcon = status==='present'?'✓':status==='absent'?'✗':'—';
    const userRole = user.role || '';
    const roleIcon = userRole === 'instructor' ? '👨‍🏫' : userRole === 'office' ? '👔' : userRole === 'owner' ? '👑' : '👥';
    
    return `
      <div class="att-card" onclick="toggleAttendanceByType('${userName}', '${userType}')">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:14px;">${roleIcon}</span>
          <div style="font-weight:500;color:var(--text);">${userName}</div>
        </div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:6px;">${user.phone || user.email || 'No contact'}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:12px;font-weight:600;color:${statusColor};">
            ${statusIcon} ${status==='present'?'Present':status==='absent'?'Absent':'Unmarked'}
          </span>
          ${rec&&rec.time?`<div style="font-size:10px;color:var(--text3);margin-top:2px;">${rec.time}</div>`:''}
        </div>
      </div>
    `;
  }).join('');
}

async function toggleAttendance(name) {
  // Check if user has permission to mark attendance
  if (!hasActionPermission('mark_attendance', { studentName: name, checkLocation: true })) {
    alert('You do not have permission to mark attendance.');
    return;
  }
  
  // Location check for ALL users
  const isWithinRadius = await checkLocationForAttendance();
  if (!isWithinRadius) {
    alert('You must be within 100 meters of the school to mark attendance.');
    return;
  }
  
  if(!gpsVerified) {
    alert('Please verify GPS location first');
    return;
  }
  
  try {
    const today = new Date().toISOString().split('T')[0];
    const currentData = await FirebaseService.getAttendance(today);
    const current = currentData[name]?.status;
    const now = new Date();
    const time = now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
    
    let attendanceData;
    if(current==='present') {
      attendanceData = {status:'absent',time:null};
    } else {
      attendanceData = {status:'present',time};
    }
    
    await FirebaseService.updateAttendance(today, name, attendanceData);
    addNotification(`Attendance marked for ${name}: ${attendanceData.status}`,'info');
  } catch (error) {
    console.error('Error updating attendance:', error);
    alert('Error updating attendance. Please try again.');
  }
}

async function toggleAttendanceByType(userName, userType) {
  // Check if user has permission to mark attendance
  if (!hasActionPermission('mark_attendance', { checkLocation: true })) {
    alert('You do not have permission to mark attendance.');
    return;
  }
  
  // Location check for ALL users
  const isWithinRadius = await checkLocationForAttendance();
  if (!isWithinRadius) {
    alert('You must be within 100 meters of school to mark attendance.');
    return;
  }
  
  if(!gpsVerified) {
    alert('Please verify GPS location first');
    return;
  }
  
  try {
    const today = new Date().toISOString().split('T')[0];
    let attendanceData, collectionName;
    
    switch(userType) {
      case 'students':
        attendanceData = data.attendance[today] || {};
        collectionName = 'attendance';
        break;
      case 'instructors':
        attendanceData = data.instructorAttendance[today] || {};
        collectionName = 'instructorAttendance';
        break;
      case 'staff':
        attendanceData = data.staffAttendance[today] || {};
        collectionName = 'staffAttendance';
        break;
      case 'admins':
        attendanceData = data.adminAttendance[today] || {};
        collectionName = 'adminAttendance';
        break;
    }
    
    const current = attendanceData[userName]?.status;
    const now = new Date();
    const time = now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
    
    let newAttendanceData;
    if(current==='present') {
      newAttendanceData = {status:'absent',time:null};
    } else {
      newAttendanceData = {status:'present',time};
    }
    
    // Update local data
    attendanceData[userName] = newAttendanceData;
    
    // Update Firebase (you'll need to add these methods to FirebaseService)
    await FirebaseService.updateAttendanceByType(today, userName, newAttendanceData, collectionName);
    
    addNotification(`Attendance marked for ${userName}: ${newAttendanceData.status}`,'info');
    
    // Re-render the current tab
    renderAttendanceByType(userType);
  } catch (error) {
    console.error('Error updating attendance:', error);
    alert('Error updating attendance. Please try again.');
  }
}

// Configure attendance tabs based on user role
function configureAttendanceTabs() {
  const adminTab = document.getElementById('att-tab-admins');
  const instructorTab = document.getElementById('att-tab-instructors');
  const staffTab = document.getElementById('att-tab-staff');
  
  // Hide all tabs initially
  if (adminTab) adminTab.style.display = 'none';
  if (instructorTab) instructorTab.style.display = 'none';
  if (staffTab) staffTab.style.display = 'none';
  
  // Show tabs based on role hierarchy
  switch(currentRole) {
    case 'owner':
      // Owner can see all tabs
      if (adminTab) adminTab.style.display = 'flex';
      if (instructorTab) instructorTab.style.display = 'flex';
      if (staffTab) staffTab.style.display = 'flex';
      break;
    case 'office':
      // Admin can see instructors and staff
      if (instructorTab) instructorTab.style.display = 'flex';
      if (staffTab) staffTab.style.display = 'flex';
      break;
    case 'instructor':
      // Instructors only see students
      break;
  }
}

// ============================================================
// OWNER ATTENDANCE MANAGEMENT
// ============================================================
async function renderOwnerAttendance() {
  try {
    // Populate school filter
    const schoolFilter = document.getElementById('owner-attendance-school-filter');
    if (schoolFilter && userSchools.length > 0) {
      const currentFilter = schoolFilter.value;
      schoolFilter.innerHTML = '<option value="">All Schools</option>' + 
        userSchools.map(school => `<option value="${school.id}" ${currentFilter === school.id ? 'selected' : ''}>${school.name}</option>`).join('');
    }

    // Get filters
    const selectedSchool = document.getElementById('owner-attendance-school-filter')?.value || '';
    const selectedDate = document.getElementById('owner-attendance-date-filter')?.value || '';
    const selectedType = document.getElementById('owner-attendance-type-filter')?.value || 'all';

    // Determine date to show
    const targetDate = selectedDate || new Date().toISOString().split('T')[0];

    // Collect all attendance data from all schools
    let allAttendanceData = [];
    let totalPresent = 0;
    let totalAbsent = 0;
    let studentsPresent = 0;
    let staffPresent = 0;

    // Process each school
    for (const school of userSchools) {
      if (selectedSchool && school.id !== selectedSchool) continue;

      // Temporarily set school context for Firebase calls
      const originalSchoolId = currentSchoolId;
      currentSchoolId = school.id;

      try {
        // Get attendance for each user type using direct Firebase calls
        const studentAttendanceRef = db.collection('schools').doc(school.id).collection('attendance');
        const staffAttendanceRef = db.collection('schools').doc(school.id).collection('staffAttendance');
        const adminAttendanceRef = db.collection('schools').doc(school.id).collection('adminAttendance');
        const instructorAttendanceRef = db.collection('schools').doc(school.id).collection('instructorAttendance');

        // Get attendance data for each type
        const studentAttendanceDoc = await studentAttendanceRef.doc(targetDate).get();
        const staffAttendanceDoc = await staffAttendanceRef.doc(targetDate).get();
        const adminAttendanceDoc = await adminAttendanceRef.doc(targetDate).get();
        const instructorAttendanceDoc = await instructorAttendanceRef.doc(targetDate).get();

        const studentAttendance = studentAttendanceDoc.exists ? studentAttendanceDoc.data() : {};
        const staffAttendance = staffAttendanceDoc.exists ? staffAttendanceDoc.data() : {};
        const adminAttendance = adminAttendanceDoc.exists ? adminAttendanceDoc.data() : {};
        const instructorAttendance = instructorAttendanceDoc.exists ? instructorAttendanceDoc.data() : {};

      // Skip students - only staff/instructors/admins mark attendance
        // Students no longer included in attendance management

        // Process staff
        Object.entries(staffAttendance).forEach(([name, data]) => {
          if (selectedType === 'all' || selectedType === 'staff') {
            allAttendanceData.push({
              name,
              type: 'Staff',
              school: school.name,
              status: data.status,
              time: data.time,
              date: targetDate
            });
            if (data.status === 'present') {
              totalPresent++;
              staffPresent++;
            } else if (data.status === 'absent') {
              totalAbsent++;
            }
          }
        });

        // Process instructors
        Object.entries(instructorAttendance).forEach(([name, data]) => {
          if (selectedType === 'all' || selectedType === 'instructors') {
            allAttendanceData.push({
              name,
              type: 'Instructor',
              school: school.name,
              status: data.status,
              time: data.time,
              date: targetDate
            });
            if (data.status === 'present') {
              totalPresent++;
              staffPresent++;
            } else if (data.status === 'absent') {
              totalAbsent++;
            }
          }
        });

        // Process admins (only visible to owners)
        if (currentRole === 'owner') {
          Object.entries(adminAttendance).forEach(([name, data]) => {
            if (selectedType === 'all' || selectedType === 'admins') {
              allAttendanceData.push({
                name,
                type: 'Admin',
                school: school.name,
                status: data.status,
                time: data.time,
                date: targetDate
              });
              if (data.status === 'present') {
                totalPresent++;
                staffPresent++;
              } else if (data.status === 'absent') {
                totalAbsent++;
              }
            }
          });
        }
      } catch (error) {
        console.error(`Error loading attendance for school ${school.name}:`, error);
      } finally {
        // Restore original school ID
        currentSchoolId = originalSchoolId;
      }
    }

    // Update stats
    document.getElementById('owner-total-present').textContent = totalPresent;
    document.getElementById('owner-total-absent').textContent = totalAbsent;
    document.getElementById('owner-students-present').textContent = studentsPresent;
    document.getElementById('owner-staff-present').textContent = staffPresent;

    // Render summary cards
    renderOwnerAttendanceSummary(allAttendanceData);

    // Render detailed table
    renderOwnerAttendanceTable(allAttendanceData);

  } catch (error) {
    console.error('Error rendering owner attendance:', error);
    addNotification('Error loading attendance data', 'error');
  }
}

function renderOwnerAttendanceSummary(attendanceData) {
  const instructorsDiv = document.getElementById('owner-instructors-attendance');
  const staffDiv = document.getElementById('owner-staff-attendance');

  if (instructorsDiv) {
    const instructors = attendanceData.filter(d => d.type === 'Instructor');
    const presentInstructors = instructors.filter(s => s.status === 'present').length;
    const totalInstructors = instructors.length;
    
    instructorsDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <span style="font-size: 14px; color: var(--text);">Present: ${presentInstructors}/${totalInstructors}</span>
        <span style="font-size: 12px; color: var(--text2);">${totalInstructors > 0 ? Math.round((presentInstructors/totalInstructors) * 100) : 0}%</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px;">
        ${instructors.slice(0, 6).map(instructor => `
          <div style="padding: 12px; background: ${instructor.status === 'present' ? '#f0fdf4' : '#fef2f2'}; border: 1px solid ${instructor.status === 'present' ? '#bbf7d0' : '#fecaca'}; border-radius: 8px;">
            <div style="font-size: 12px; font-weight: 500; color: var(--text);">${instructor.name}</div>
            <div style="font-size: 11px; color: var(--text2); margin-top: 2px;">${instructor.school}</div>
            <div style="font-size: 11px; color: ${instructor.status === 'present' ? 'var(--success)' : 'var(--danger)'}; margin-top: 4px;">
              ${instructor.status === 'present' ? '✓ Present' : '✗ Absent'}
            </div>
          </div>
        `).join('')}
        ${instructors.length > 6 ? `<div style="display: flex; align-items: center; justify-content: center; color: var(--text2); font-size: 12px;">+${instructors.length - 6} more</div>` : ''}
      </div>
    `;
  }

  if (staffDiv) {
    const staff = attendanceData.filter(d => d.type === 'Staff');
    const presentStaff = staff.filter(s => s.status === 'present').length;
    const totalStaff = staff.length;
    
    staffDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <span style="font-size: 14px; color: var(--text);">Present: ${presentStaff}/${totalStaff}</span>
        <span style="font-size: 12px; color: var(--text2);">${totalStaff > 0 ? Math.round((presentStaff/totalStaff) * 100) : 0}%</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px;">
        ${staff.slice(0, 6).map(member => `
          <div style="padding: 12px; background: ${member.status === 'present' ? '#f0fdf4' : '#fef2f2'}; border: 1px solid ${member.status === 'present' ? '#bbf7d0' : '#fecaca'}; border-radius: 8px;">
            <div style="font-size: 12px; font-weight: 500; color: var(--text);">${member.name}</div>
            <div style="font-size: 11px; color: var(--text2); margin-top: 2px;">${member.school}</div>
            <div style="font-size: 11px; color: ${member.status === 'present' ? 'var(--success)' : 'var(--danger)'}; margin-top: 4px;">
              ${member.status === 'present' ? '✓ Present' : '✗ Absent'}
            </div>
          </div>
        `).join('')}
        ${staff.length > 6 ? `<div style="display: flex; align-items: center; justify-content: center; color: var(--text2); font-size: 12px;">+${staff.length - 6} more</div>` : ''}
      </div>
    `;
  }
}

function renderOwnerAttendanceTable(attendanceData) {
  const tbody = document.getElementById('owner-attendance-tbody');
  if (!tbody) return;

  if (attendanceData.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px; color: var(--text2);">
          <div style="font-size: 24px; margin-bottom: 8px;">📊</div>
          No attendance records found for selected filters
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = attendanceData.map(record => {
    // No action buttons - users mark their own attendance
    const statusText = record.status === 'present' ? '✓ Present' : '✗ Absent';
    const statusColor = record.status === 'present' ? 'badge-green' : 'badge-red';
    
    return `
    <tr>
      <td>${record.name}</td>
      <td><span class="chip" style="background: ${record.type === 'Instructor' ? 'var(--success)' : record.type === 'Admin' ? 'var(--accent2)' : 'var(--warning)'}; color: white;">${record.type}</span></td>
      <td>${record.school}</td>
      <td>
        <span class="badge ${statusColor}" style="font-size: 11px;">
          ${statusText}
        </span>
      </td>
      <td>${record.time || '-'}</td>
      <td>${record.date}</td>
      <td>
        <span style="font-size: 11px; color: var(--text2);">Self-marked</span>
      </td>
    </tr>
  `;
}).join('');
}

function refreshOwnerAttendance() {
  renderOwnerAttendance();
  addNotification('Attendance data refreshed', 'success');
}

async function markOwnerAttendance(userName, userType, schoolName, date) {
  try {
    // Check if user has permission to mark attendance
    if (!hasActionPermission('mark_attendance', { checkLocation: true })) {
      alert('You do not have permission to mark attendance.');
      return;
    }
    
    // Location check for ALL users
    const isWithinRadius = await checkLocationForAttendance();
    if (!isWithinRadius) {
      alert('You must be within 100 meters of school to mark attendance.');
      return;
    }
    
    if (!gpsVerified) {
      alert('Please verify GPS location first');
      return;
    }
    
    // Find the school ID for the given school name
    const school = userSchools.find(s => s.name === schoolName);
    if (!school) {
      alert('School not found');
      return;
    }
    
    // Determine collection name based on user type
    let collectionName;
    switch(userType) {
      case 'Student':
        collectionName = 'attendance';
        break;
      case 'Instructor':
        collectionName = 'instructorAttendance';
        break;
      case 'Staff':
        collectionName = 'staffAttendance';
        break;
      case 'Admin':
        collectionName = 'adminAttendance';
        break;
      default:
        collectionName = 'attendance';
    }
    
    // Temporarily set school context
    const originalSchoolId = currentSchoolId;
    currentSchoolId = school.id;
    
    try {
      // Get current attendance data
      const collectionRef = db.collection('schools').doc(school.id).collection(collectionName);
      const docRef = collectionRef.doc(date);
      const doc = await docRef.get();
      const currentData = doc.exists ? doc.data() : {};
      
      const now = new Date();
      const time = now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
      
      // Update attendance data
      const attendanceData = {
        status: 'present',
        time: time
      };
      
      currentData[userName] = attendanceData;
      
      // Save to Firebase
      await docRef.set(currentData, { merge: true });
      
      addNotification(`Attendance marked for ${userName}: Present`, 'success');
      
      // Refresh the attendance display
      renderOwnerAttendance();
      
    } finally {
      // Restore original school ID
      currentSchoolId = originalSchoolId;
    }
    
  } catch (error) {
    console.error('Error marking attendance:', error);
    alert('Error marking attendance. Please try again.');
  }
}

// Switch between attendance tabs
function switchAttendanceTab(userType) {
  // Hide all sections
  document.querySelectorAll('.attendance-section').forEach(section => {
    section.style.display = 'none';
  });
  
  // Remove active class from all tabs
  document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Show selected section and activate tab
  document.getElementById(`attendance-${userType}`).style.display = 'block';
  document.getElementById(`att-tab-${userType}`).classList.add('active');
  
  // Render the appropriate attendance grid
  renderAttendanceByType(userType);
}

// ============================================================
// SELF ATTENDANCE FOR ALL USERS
// ============================================================
function openSelfAttendanceModal() {
  // Update modal title based on user role
  const modalTitle = document.querySelector('#modal-self-attendance .modal-header h3');
  modalTitle.textContent = `✅ Mark My Attendance (${currentRole.charAt(0).toUpperCase() + currentRole.slice(1)})`;
  
  // Set current date and time
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  document.getElementById('self-att-clock').textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('self-att-date').textContent = now.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('self-att-date-input').value = today;
  
  // Check location immediately
  checkLocationForSelfAttendance();
  
  // Open modal
  document.getElementById('modal-self-attendance').style.display = 'flex';
  
  // Update time every second
  if (window.selfAttInterval) clearInterval(window.selfAttInterval);
  window.selfAttInterval = setInterval(() => {
    const now = new Date();
    document.getElementById('self-att-clock').textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }, 1000);
}

async function checkLocationForSelfAttendance() {
  const locationDiv = document.getElementById('self-att-location');
  const coordsDiv = document.getElementById('self-att-coords');
  const iconDiv = document.getElementById('self-att-icon');
  
  locationDiv.textContent = 'Checking location...';
  coordsDiv.textContent = '';
  iconDiv.textContent = '📍';
  
  try {
    const userLocation = await LocationService.getCurrentLocation();
    coordsDiv.textContent = `Lat: ${userLocation.latitude.toFixed(6)}, Lng: ${userLocation.longitude.toFixed(6)}`;
    
    // Get school location
    const schoolDoc = await FirebaseService.schoolsRef.doc(currentSchoolId).get();
    if (!schoolDoc.exists) {
      locationDiv.textContent = 'School location not found';
      locationDiv.style.color = 'var(--error)';
      iconDiv.textContent = '❌';
      return false;
    }
    
    const schoolData = schoolDoc.data();
    if (!schoolData.latitude || !schoolData.longitude) {
      locationDiv.textContent = 'School coordinates not set';
      locationDiv.style.color = 'var(--error)';
      iconDiv.textContent = '❌';
      return false;
    }
    
    // Calculate distance
    const distance = LocationService.calculateDistance(
      userLocation.latitude, 
      userLocation.longitude, 
      schoolData.latitude, 
      schoolData.longitude
    );
    
    if (distance <= 100) {
      locationDiv.textContent = `✓ Within school premises (${Math.round(distance)}m)`;
      locationDiv.style.color = 'var(--success)';
      iconDiv.textContent = '✅';
      window.gpsVerified = true;
      return true;
    } else {
      locationDiv.textContent = `✗ Too far from school (${Math.round(distance)}m)`;
      locationDiv.style.color = 'var(--error)';
      iconDiv.textContent = '❌';
      window.gpsVerified = false;
      return false;
    }
    
  } catch (error) {
    locationDiv.textContent = '❌ Location error: ' + error.message;
    locationDiv.style.color = 'var(--error)';
    iconDiv.textContent = '❌';
    window.gpsVerified = false;
    return false;
  }
}

async function submitSelfAttendance() {
  try {
    // Check location first
    const isWithinRadius = await checkLocationForSelfAttendance();
    if (!isWithinRadius) {
      alert('You must be within 100 meters of the school to mark attendance.');
      return;
    }
    
    const today = new Date().toISOString().split('T')[0];
    const attendanceType = document.getElementById('self-att-type').value;
    const notes = document.getElementById('self-att-notes').value;
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    
    // Determine collection based on user role
    let collectionName;
    switch(currentRole) {
      case 'owner':
      case 'office':
        collectionName = 'adminAttendance';
        break;
      case 'instructor':
        collectionName = 'instructorAttendance';
        break;
      default:
        collectionName = 'staffAttendance';
    }
    
    // Prepare attendance data
    const attendanceData = {
      status: attendanceType === 'in' ? 'present' : 'checked_out',
      type: attendanceType,
      time: timeString,
      date: today,
      notes: notes,
      note: notes,
      location: 'verified',
      userName: getAttendanceUserKey(currentUser),
      userEmail: currentUser ? currentUser.email : '',
      userId: currentUser ? currentUser.uid : '',
      schoolId: currentSchoolId || '',
      markedBy: currentUser.email,
      markedAt: now.toISOString(),
      userRole: currentRole
    };
    
    // Save to Firebase
    await db.collection('schools').doc(currentSchoolId).collection('attendance')
      .doc(getAttendanceDocId(today, currentRole, currentUser))
      .set(attendanceData, { merge: true });
    await FirebaseService.updateAttendanceByType(today, getAttendanceUserKey(currentUser), attendanceData, collectionName);
    
    // Show success message
    showNotification(`✅ Submitted attendance successfully: ${attendanceType === 'in' ? 'Check In' : 'Check Out'} at ${timeString}`, 'success');
    
    // Close modal immediately
    document.getElementById('modal-self-attendance').style.display = 'none';
    
    // Refresh attendance data if on attendance page
    if (currentPage === 'owner-attendance') {
      renderOwnerAttendance();
    } else if (currentPage === 'office-attendance') {
      renderOfficeAttHistory();
    }
    
  } catch (error) {
    console.error('Error marking self attendance:', error);
    alert('Error marking attendance. Please try again.');
  }
}

// Simple notification function for immediate feedback
function showNotification(message, type = 'success') {
  // Create notification element
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? 'var(--success)' : 'var(--error)'};
    color: white;
    padding: 15px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    font-weight: 500;
    max-width: 300px;
    animation: slideIn 0.3s ease-out;
  `;
  notification.textContent = message;
  
  // Add to page
  document.body.appendChild(notification);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

// Add CSS animations if not already present
if (!document.getElementById('notification-animations')) {
  const style = document.createElement('style');
  style.id = 'notification-animations';
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

// ============================================================
// SCHEDULE
// ============================================================
function getTodayScheduleMap() {
  const today = new Date().toISOString().split('T')[0];
  const scheduleDocs = data.dailySchedule || {};
  const map = {};
  Object.values(scheduleDocs).forEach(entry => {
    if (!entry || entry.date !== today) return;
    if (entry.studentId) map[entry.studentId] = entry;
    if (entry.studentName && !map[entry.studentName]) map[entry.studentName] = entry;
  });
  return map;
}

function normalizeInstructorValue(value) {
  return (value || '').toString().trim().toLowerCase();
}

function getInstructorSelectValue(instructorString, instructors) {
  const normalized = normalizeInstructorValue(instructorString);
  if (!normalized) return '';
  const byEmail = instructors.find(inst => normalizeInstructorValue(inst.email) === normalized);
  if (byEmail) return byEmail.email || byEmail.name || '';
  const byName = instructors.find(inst => normalizeInstructorValue(inst.name) === normalized);
  if (byName) return byName.email || byName.name || '';
  return instructorString;
}

function getAvailableInstructors() {
  const today = new Date().toISOString().split('T')[0];
  const attendanceToday = (data.instructorAttendance && data.instructorAttendance[today]) || (data.adminAttendance && data.adminAttendance[today]) || {};
  const instructors = (data.staff || []).filter(st => st.role === 'instructor');
  const adminInst = (data.admins || []).filter(a => a.role === 'instructor');
  const allInst = instructors.length > 0 ? instructors : adminInst;
  const present = allInst.filter(inst => {
    const key = inst.name || inst.email || inst.userId || inst.firebaseId;
    const rec = attendanceToday[key] || attendanceToday[inst.email] || attendanceToday[inst.name];
    return rec && rec.status === 'present';
  });
  const list = present.length > 0 ? present : allInst;
  return list;
}

function getCurrentInstructorName() {
  if (!currentUser || !currentUser.email) return (currentUser && currentUser.displayName) ? currentUser.displayName : '';
  const email = (currentUser.email || '').toString();
  const display = (currentUser.displayName || '').toString();
  const username = email.split('@')[0] || '';
  const instructors = (data.staff || []).filter(st => st.role === 'instructor');
  const adminInst = (data.admins || []).filter(a => a.role === 'instructor');
  const allInst = instructors.concat(adminInst);
  let matched = allInst.find(inst => inst.email && inst.email.toLowerCase() === email.toLowerCase());
  if (!matched && display) matched = allInst.find(inst => inst.name && inst.name.toLowerCase() === display.toLowerCase());
  if (!matched && username) matched = allInst.find(inst => inst.name && inst.name.toLowerCase() === username.toLowerCase());
  if (!matched) matched = allInst.find(inst => inst.name && email.toLowerCase().includes(inst.name.toLowerCase()));
  if (matched) return matched.name || (display || username);
  return display || username;
}

function hasSelfAttendance() {
  const today = new Date().toISOString().split('T')[0];
  if (!currentUser) return false;
  const key = getAttendanceUserKey(currentUser);
  if (currentRole === 'instructor') {
    return Boolean(
      (data.instructorAttendance && data.instructorAttendance[today] && data.instructorAttendance[today][key]) ||
      (data.adminAttendance && data.adminAttendance[today] && data.adminAttendance[today][key])
    );
  }
  return Boolean((data.adminAttendance && data.adminAttendance[today] && data.adminAttendance[today][key]));
}

function renderSchedule() {
  const list = document.getElementById('schedule-list');
  const badge = document.getElementById('schedule-count-badge');
  const dateDisplay = document.getElementById('schedule-date-display');
  if (dateDisplay) {
    dateDisplay.textContent = new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  }
  if (!list) return;
  if (!hasSelfAttendance()) {
    if (badge) badge.textContent = '0 Total';
    list.innerHTML = `
      <div style="text-align:center;padding:36px;color:var(--text2);">
        <div style="font-size:32px;margin-bottom:12px;">🕒</div>
        <div><strong>Please mark your attendance first.</strong></div>
        <div style="margin-top:10px;">Your schedule will appear here once your admin/instructor attendance is recorded for today.</div>
        <button class="btn btn-accent" style="margin-top:16px;" onclick="navigateTo('attendance')">Go to Attendance</button>
      </div>
    `;
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const students = (data.students || []).filter(s => s.schoolId === currentSchoolId && (s.status === 'Active' || s.status === 'Pending' || !s.status));
  const assignedStudents = currentRole === 'instructor'
    ? (function() {
        const instructorName = getCurrentInstructorName();
        return students.filter(s => s.instructorEmail === currentUser.email || s.instructor === currentUser.email || s.instructor === instructorName);
      })()
    : students;

  const scheduleMap = getTodayScheduleMap();
  const availableInstructors = getAvailableInstructors();

  const total = assignedStudents.length;
  const scheduledCount = assignedStudents.filter(s => {
    const studentId = getStudentKey(s);
    return Boolean(scheduleMap[studentId] || scheduleMap[s.studentId] || scheduleMap[s.firebaseId] || scheduleMap[s.name]);
  }).length;
  if (badge) badge.textContent = `${scheduledCount}/${total} Scheduled`;

  if (assignedStudents.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text2);">
        <div style="font-size:32px;margin-bottom:12px;">📭</div>
        <div>No active students are assigned to your schedule yet.</div>
      </div>
    `;
    return;
  }

  list.innerHTML = assignedStudents.map(student => {
    const studentId = getStudentKey(student);
    const schedule = scheduleMap[studentId] || scheduleMap[student.studentId] || scheduleMap[student.firebaseId] || scheduleMap[student.name] || null;
    const status = schedule ? 'Scheduled' : 'Not Scheduled';
    const statusClass = schedule ? 'badge-green' : 'badge-red';
    const presetTime = schedule ? schedule.time : (student.classTime || '');
    const presetInstructor = schedule
      ? (schedule.instructorEmail || schedule.instructorName || schedule.instructor || '')
      : (student.instructorEmail || student.instructor || '');
    const selectedInstructor = getInstructorSelectValue(presetInstructor, availableInstructors);
    const safeId = studentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeStudentId = studentId.replace(/'/g, "\\'");
    const classStartedAt = schedule && schedule.classStartTime ? schedule.classStartTime : '';
    const classEndedAt = schedule && schedule.classEndTime ? schedule.classEndTime : '';
    const classDurationMinutes = schedule && schedule.classDurationMinutes ? schedule.classDurationMinutes : null;
    const instructorOptions = availableInstructors.map(inst => {
      const value = inst.email || inst.name || '';
      const label = `${inst.name}${inst.email ? ' — ' + inst.email : ''}`;
      const selected = value === selectedInstructor ? 'selected' : '';
      return `<option value="${value}" ${selected}>${label}</option>`;
    }).join('');
    return `
      <div class="schedule-row" style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--border);">
        <div style="flex:1;min-width:200px;">
          <div style="font-weight:600;">${student.name}</div>
          <div style="font-size:12px;color:var(--text2);">${student.vehicle || 'Vehicle not set'} · ${student.phone || 'No phone'}</div>
        </div>
        <div style="width:150px;">
          <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px;">Time</label>
          <input id="sched-time-${safeId}" type="time" value="${presetTime || ''}" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;">
          <div style="font-size:11px;color:var(--text2);margin-top:6px;">Registered: <strong>${student.classTime || '—'}</strong></div>
        </div>
        <div style="width:190px;font-size:12px;color:var(--text2);">
          <div style="font-weight:600;margin-bottom:4px;">Class timing</div>
          <div>Start: ${classStartedAt || '—'}</div>
          <div>End: ${classEndedAt || '—'}</div>
          <div style="margin-top:4px;color:${classDurationMinutes ? 'var(--text)' : 'var(--text2)'};">${classDurationMinutes ? classDurationMinutes + ' min' : (classStartedAt ? 'In progress' : 'Not started')}</div>
        </div>
        ${ currentRole !== 'instructor' ? `
        <div style="width:240px;">
          <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px;">Instructor</label>
          <select id="sched-inst-${safeId}" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;">
            <option value="">(Unassigned)</option>
            ${instructorOptions}
          </select>
        </div>
        ` : ''}
        <div style="width:120px;text-align:center;">
          <div class="badge ${statusClass}" style="padding:6px 10px;font-size:12px;">${status}</div>
        </div>
        <div style="width:260px;text-align:right;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;">
          ${ (currentRole === 'instructor')
            ? (schedule ? `<button class="btn btn-outline" onclick="acceptScheduledClass('${safeStudentId}')">${(schedule.status==='accepted')? 'Accepted' : 'Accept'}</button><button class="btn btn-secondary" onclick="openRescheduleModal('${(student.name||'').replace(/'/g,"\\'")}', '${safeStudentId}')">Reschedule</button>` : `<button class="btn btn-gray" disabled>Not Scheduled</button>`)
            : `<button class="btn btn-accent" onclick="scheduleTodayStudent('${safeStudentId}')">${schedule ? 'Update' : 'Schedule'}</button>`
          }
          ${ currentRole === 'instructor' && schedule ? (classEndedAt ? `<button class="btn btn-gray" disabled>Completed</button>` : (classStartedAt ? `<button class="btn btn-success" onclick="endClassForStudent('${safeStudentId}')">End Class</button>` : `<button class="btn btn-primary" onclick="startClassForStudent('${safeStudentId}')">Start Class</button>`)) : '' }
        </div>
      </div>
    `;
  }).join('');
}

async function scheduleTodayStudent(studentKey) {
  const students = data.students || [];
  const student = students.find(s => getStudentKey(s) === studentKey);
  if (!student) {
    addNotification('Student not found', 'danger');
    return;
  }
  const safeId = studentKey.replace(/[^a-zA-Z0-9_-]/g,'_');
  const timeEl = document.getElementById('sched-time-' + safeId);
  const instEl = document.getElementById('sched-inst-' + safeId);
  const time = timeEl ? timeEl.value : (student.classTime || '');
  const selectedInstructorValue = instEl ? instEl.value : (student.instructorEmail || student.instructor || '');
  const availableInstructors = getAvailableInstructors();
  const matchedInstructor = availableInstructors.find(inst => (inst.email || inst.name) === selectedInstructorValue || inst.name === selectedInstructorValue);
  const instructorEmail = matchedInstructor ? (matchedInstructor.email || matchedInstructor.name || '') : selectedInstructorValue;
  const instructorName = matchedInstructor ? matchedInstructor.name : (student.instructor || '');
  const today = new Date().toISOString().split('T')[0];
  const docId = today + '_' + studentKey;
  const entry = {
    date: today,
    time: time || '',
    studentId: student.firebaseId || student.id || student.studentId || studentKey,
    studentName: student.name,
    instructor: instructorName || instructorEmail || '',
    instructorEmail: instructorEmail || '',
    instructorName: instructorName || '',
    createdBy: currentUser ? (currentUser.email || currentUser.uid) : 'system',
    schoolId: currentSchoolId || '',
    updatedAt: new Date().toISOString()
  };
  try {
    await FirebaseService.scheduleRef.doc(docId).set(entry, { merge: true });
    data.dailySchedule[docId] = entry;
    addNotification(`${student.name} scheduled for ${time || 'no time'}`, 'success');
    renderSchedule();
  } catch (e) {
    console.error('Schedule save failed:', e.message);
    addNotification('Could not save schedule', 'danger');
  }
}

async function acceptScheduledClass(studentKey) {
  const today = new Date().toISOString().split('T')[0];
  const docId = today + '_' + studentKey;
  const schedule = (data.dailySchedule && data.dailySchedule[docId]) || {};
  schedule.status = 'accepted';
  schedule.acceptedBy = currentUser ? (currentUser.email || currentUser.uid || '') : 'unknown';
  schedule.acceptedAt = new Date().toISOString();
  try {
    if (typeof FirebaseService !== 'undefined' && FirebaseService.scheduleRef) {
      await FirebaseService.scheduleRef.doc(docId).set(schedule, { merge: true });
    }
    data.dailySchedule = data.dailySchedule || {};
    data.dailySchedule[docId] = schedule;
    addNotification('Class accepted — admin notified', 'success');
    renderSchedule();
  } catch (e) {
    console.error('Could not accept schedule:', e.message);
    addNotification('Could not accept class. Try again.', 'danger');
  }
}

async function startClassForStudent(studentKey) {
  const today = new Date().toISOString().split('T')[0];
  const docId = today + '_' + studentKey;
  const schedule = (data.dailySchedule && data.dailySchedule[docId]) || {};
  const now = new Date();
  const startTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  schedule.classStartTime = startTime;
  schedule.classEndTime = schedule.classEndTime || '';
  schedule.classDurationMinutes = schedule.classDurationMinutes || null;
  schedule.timingReportedBy = currentUser ? (currentUser.email || currentUser.uid || '') : 'unknown';
  schedule.timingStatus = 'started';
  schedule.timingUpdatedAt = new Date().toISOString();
  try {
    if (typeof FirebaseService !== 'undefined' && FirebaseService.scheduleRef) {
      await FirebaseService.scheduleRef.doc(docId).set(schedule, { merge: true });
    }
    data.dailySchedule = data.dailySchedule || {};
    data.dailySchedule[docId] = schedule;
    addNotification(`Started class for ${schedule.studentName || studentKey} at ${startTime}`, 'info');
    renderSchedule();
  } catch (e) {
    console.error('Could not start class timing:', e.message);
    addNotification('Could not record class start time. Try again.', 'danger');
  }
}

async function endClassForStudent(studentKey) {
  const today = new Date().toISOString().split('T')[0];
  const docId = today + '_' + studentKey;
  const schedule = (data.dailySchedule && data.dailySchedule[docId]) || {};
  if (!schedule.classStartTime) {
    addNotification('Class has not been started yet.', 'warning');
    return;
  }
  const now = new Date();
  const endTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  schedule.classEndTime = endTime;
  schedule.classDurationMinutes = Math.max(0, Math.round((new Date(`${today}T${endTime}:00`) - new Date(`${today}T${schedule.classStartTime}:00`)) / 60000));
  schedule.timingReportedAt = new Date().toISOString();
  schedule.timingReportedBy = currentUser ? (currentUser.email || currentUser.uid || '') : 'unknown';
  schedule.timingStatus = 'completed';
  try {
    if (typeof FirebaseService !== 'undefined' && FirebaseService.scheduleRef) {
      await FirebaseService.scheduleRef.doc(docId).set(schedule, { merge: true });
    }
    data.dailySchedule = data.dailySchedule || {};
    data.dailySchedule[docId] = schedule;
    await addNotification(`📊 Class timing recorded for ${schedule.studentName || studentKey}: ${schedule.classDurationMinutes} min (Start: ${schedule.classStartTime}, End: ${schedule.classEndTime})`, 'info');
    renderSchedule();
  } catch (e) {
    console.error('Could not record class end time:', e.message);
    addNotification('Could not save class end time. Try again.', 'danger');
  }
}

// ============================================================
// BULK SCHEDULING (Admin)
// ============================================================
function getStudentKey(student) {
  return student.firebaseId || student.id || student.studentId || (student.name || '').replace(/\s+/g,'_');
}

function renderBulkScheduleList() {
  const container = document.getElementById('bulk-sched-list');
  const countEl = document.getElementById('bulk-sched-count');
  if (!container) return;
  const students = (data.students || []).filter(s => s.schoolId === currentSchoolId && (s.status === 'Active' || s.status === 'Pending' || !s.status));
  const today = new Date().toISOString().split('T')[0];
  const attendanceToday = (data.instructorAttendance && data.instructorAttendance[today]) || (data.adminAttendance && data.adminAttendance[today]) || {};
  const todaySchedule = getTodayScheduleMap();

  container.innerHTML = students.map(s => {
    const key = getStudentKey(s);
    const schedule = todaySchedule[s.firebaseId] || todaySchedule[s.id] || todaySchedule[s.studentId] || todaySchedule[s.name] || todaySchedule[key] || null;
    const presetTime = schedule ? schedule.time : (s.classTime || '');
    const presetInstructor = schedule ? (schedule.instructorEmail || schedule.instructorName || schedule.instructor || s.instructorEmail || s.instructor || '') : (s.instructorEmail || s.instructor || '');
    const scheduled = Boolean(schedule);
    const statusLabel = scheduled ? 'Scheduled' : 'Not Scheduled';
    const statusClass = scheduled ? 'badge-green' : 'badge-red';
    const timeId = 'bs-time-' + key;
    const instId = 'bs-inst-' + key;
    return `
      <div class="bs-row" style="display:flex;gap:8px;align-items:center;padding:8px;border-bottom:1px solid var(--border);">
        <div style="flex:1;">
          <div style="font-weight:600;">${s.name}</div>
          <div style="font-size:12px;color:var(--text2);">${s.phone||''} · ${s.vehicle||''}</div>
        </div>
        <div style="width:150px;">
          <label style="font-size:11px;color:var(--text2)">Time</label>
          <input id="${timeId}" type="time" value="${presetTime}" style="width:100%">
        </div>
        <div style="width:260px;">
          <label style="font-size:11px;color:var(--text2)">Instructor</label>
          <select id="${instId}" style="width:100%"></select>
        </div>
        <div style="width:120px;text-align:center;">
          <span class="badge ${statusClass}" style="padding:6px 10px;font-size:12px;">${statusLabel}</span>
        </div>
        <div style="width:120px;text-align:right;">
          <button class="btn btn-accent" onclick="scheduleStudent('${key}')">Schedule</button>
        </div>
      </div>
    `;
  }).join('');

  // populate instructor selects
  const instOptions = (() => {
    const today = new Date().toISOString().split('T')[0];
    const attendanceToday = (data.instructorAttendance && data.instructorAttendance[today]) || (data.adminAttendance && data.adminAttendance[today]) || {};
    const instructors = (data.staff || []).filter(st => st.role === 'instructor');
    const adminInst = (data.admins || []).filter(a => a.role === 'instructor');
    const allInst = instructors.length > 0 ? instructors : adminInst;
    const present = allInst.filter(inst => {
      const key = inst.name || inst.email || inst.userId || inst.firebaseId;
      const rec = attendanceToday[key] || attendanceToday[inst.email] || attendanceToday[inst.name];
      return rec && rec.status === 'present';
    });
    const list = present.length > 0 ? present : allInst;
    return list.map(inst => ({ value: inst.email || inst.name, label: inst.name + (inst.email ? ' — ' + inst.email : '') }));
  })();

  students.forEach(s => {
    const key = getStudentKey(s);
    const instSelect = document.getElementById('bs-inst-' + key);
    if (!instSelect) return;
    const selectedValue = getInstructorSelectValue(s.instructorEmail || s.instructor || '', data.staff.concat(data.admins || []).filter(inst => inst.role === 'instructor'));
    instSelect.innerHTML = '<option value="">(Unassigned)</option>' + instOptions.map(o => `<option value="${o.value}" ${o.value=== selectedValue ? 'selected' : ''}>${o.label}</option>`).join('');
  });

  if (countEl) countEl.textContent = students.length;
}

async function scheduleStudent(studentKey) {
  // find student by key
  const students = data.students || [];
  const student = students.find(s => getStudentKey(s) === studentKey);
  if (!student) { addNotification('Student not found','danger'); return; }
  const timeEl = document.getElementById('bs-time-' + studentKey);
  const instEl = document.getElementById('bs-inst-' + studentKey);
  const time = timeEl ? timeEl.value : (student.classTime || '');
  const selectedInstructorValue = instEl ? instEl.value : (student.instructorEmail || student.instructor || '');
  const availableInstructors = getAvailableInstructors();
  const matchedInstructor = availableInstructors.find(inst => (inst.email || inst.name) === selectedInstructorValue || inst.name === selectedInstructorValue);
  const instructorEmail = matchedInstructor ? (matchedInstructor.email || matchedInstructor.name || '') : selectedInstructorValue;
  const instructorName = matchedInstructor ? matchedInstructor.name : (student.instructor || '');
  const today = new Date().toISOString().split('T')[0];

  const docId = today + '_' + (student.firebaseId || student.id || student.studentId || studentKey);
  const entry = {
    date: today,
    time: time || '',
    studentId: student.firebaseId || student.id || student.studentId || '',
    studentName: student.name,
    instructor: instructorName || instructorEmail || '',
    instructorEmail: instructorEmail || '',
    instructorName: instructorName || '',
    createdBy: currentUser ? (currentUser.email || currentUser.uid) : 'system',
    schoolId: currentSchoolId || '',
    createdAt: new Date().toISOString()
  };

  try {
    await FirebaseService.scheduleRef.doc(docId).set(entry);
    data.dailySchedule[docId] = entry;
    addNotification(`Scheduled ${student.name} at ${time || '—'}`,'success');
    if (currentPage === 'class-schedule') renderSchedule();
  } catch (e) {
    console.error('Schedule save failed:', e.message);
    addNotification('Could not save schedule','danger');
  }
}

async function scheduleAllStudentsToday() {
  const students = (data.students || []).filter(s => s.schoolId === currentSchoolId && (s.status === 'Active' || s.status === 'Pending' || !s.status));
  for (const s of students) {
    const key = getStudentKey(s);
    await scheduleStudent(key);
  }
  renderBulkScheduleList();
}

function addClassSlot() {
  const day = document.getElementById('cls-day').value;
  const time = document.getElementById('cls-time').value;
  const student = document.getElementById('cls-student').value.trim();
  if(!time||!student){alert('Fill all fields');return;}
  if(!data.schedule[day]) data.schedule[day] = [];
  data.schedule[day].push({time,student});
  data.schedule[day].sort((a,b)=>a.time.localeCompare(b.time));
  closeModal('modal-add-class');
  renderSchedule();
}

// ============================================================
// FUEL — OWNER DASHBOARD
// ============================================================

async function renderOwnerFuelDashboard() {
  if (!currentSchoolId) {
    const container = document.getElementById('owner-fuel-table');
    if (container) container.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text2);">Please select a school first.</td></tr>';
    return;
  }

  const monthFilter = document.getElementById('owner-fuel-month-filter')?.value || new Date().toISOString().slice(0, 7);
  const driverFilter = document.getElementById('owner-fuel-driver-filter')?.value || '';
  const vehicleFilter = document.getElementById('owner-fuel-vehicle-filter')?.value || '';

  let allFuel = [];
  try {
    let query = FirebaseService.fuelRef.orderBy('date', 'desc');
    if (monthFilter) {
      query = query.where('date', '>=', monthFilter + '-01').where('date', '<=', monthFilter + '-31');
    }
    const snapshot = await query.get().catch(() => null);
    if (snapshot) {
      allFuel = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } else {
      allFuel = data.fuel;
    }
  } catch (e) {
    console.warn('Owner fuel dashboard fallback:', e);
    allFuel = data.fuel;
  }

  // Update driver & vehicle filter dropdowns
  const drivers = [...new Set(allFuel.map(f => f.instructorName || f.instructorEmail || 'Unknown').filter(Boolean))];
  const vehicles = [...new Set(allFuel.map(f => f.vehicle).filter(Boolean))];

  const driverSelect = document.getElementById('owner-fuel-driver-filter');
  const vehicleSelect = document.getElementById('owner-fuel-vehicle-filter');
  const prevDriver = driverSelect?.value;
  const prevVehicle = vehicleSelect?.value;
  if (driverSelect) {
    driverSelect.innerHTML = '<option value="">All Drivers</option>' + drivers.map(d => `<option value="${d}" ${prevDriver === d ? 'selected' : ''}>${d}</option>`).join('');
  }
  if (vehicleSelect) {
    vehicleSelect.innerHTML = '<option value="">All Vehicles</option>' + vehicles.map(v => `<option value="${v}" ${prevVehicle === v ? 'selected' : ''}>${v}</option>`).join('');
  }

  // Apply filters
  let filtered = allFuel;
  if (driverFilter) filtered = filtered.filter(f => (f.instructorName || f.instructorEmail || '') === driverFilter);
  if (vehicleFilter) filtered = filtered.filter(f => f.vehicle === vehicleFilter);

  // Stats
  const totalCost = filtered.reduce((s, f) => s + (f.cost || 0), 0);
  const totalLitres = filtered.reduce((s, f) => s + (f.litres || 0), 0);
  const uniqueVehicles = new Set(filtered.map(f => f.vehicle)).size;

  const costEl = document.getElementById('owner-fuel-total');
  const litresEl = document.getElementById('owner-fuel-litres');
  const entriesEl = document.getElementById('owner-fuel-entries');
  const vehiclesEl = document.getElementById('owner-fuel-vehicles');
  if (costEl) costEl.textContent = `₹${totalCost.toLocaleString()}`;
  if (litresEl) litresEl.textContent = `${totalLitres.toFixed(1)}L`;
  if (entriesEl) entriesEl.textContent = filtered.length;
  if (vehiclesEl) vehiclesEl.textContent = uniqueVehicles;

  // Fuel levels by vehicle
  const levelsDiv = document.getElementById('owner-fuel-levels');
  if (levelsDiv) {
    const vehicleData = data.vehicles;
    if (vehicleData.length === 0) {
      levelsDiv.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text2);font-size:13px;">No vehicles in fleet yet.</div>';
    } else {
      levelsDiv.innerHTML = vehicleData.map(v => `
      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <div>
            <div style="font-size:13.5px;font-weight:500;">${v.name}</div>
            <div style="font-size:11px;color:var(--text2);">${v.reg}</div>
          </div>
          <span style="font-size:13px;font-weight:600;color:${(v.fuelLevel||50)<30?'var(--danger)':(v.fuelLevel||50)<50?'var(--warning)':'var(--success)'};">${v.fuelLevel||50}%</span>
        </div>
        <div class="fuel-bar-wrap">
          <div class="fuel-fill" style="width:${v.fuelLevel||50}%;background:${(v.fuelLevel||50)<30?'linear-gradient(to right,#dc2626,#f87171)':(v.fuelLevel||50)<50?'linear-gradient(to right,#d97706,#fbbf24)':'linear-gradient(to right,#16a34a,#4ade80)'}">
            <span>${v.fuelLevel||50}%</span>
          </div>
        </div>
      </div>
    `).join('');
    }
  }

  // Per-driver summary
  const driverSummaryDiv = document.getElementById('owner-fuel-by-driver');
  if (driverSummaryDiv) {
    const driverMap = {};
    allFuel.forEach(f => {
      const name = f.instructorName || f.instructorEmail || 'Unknown';
      if (!driverMap[name]) driverMap[name] = { cost: 0, litres: 0, fills: 0 };
      driverMap[name].cost += f.cost || 0;
      driverMap[name].litres += f.litres || 0;
      driverMap[name].fills++;
    });

    const driverEntries = Object.entries(driverMap);
    if (driverEntries.length === 0) {
      driverSummaryDiv.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text2);">No driver fuel data for this period.</div>';
    } else {
      driverSummaryDiv.innerHTML = driverEntries.sort((a,b) => b[1].cost - a[1].cost).map(([name, stats], i) => `
        <div class="driver-fuel-card">
          <div class="avatar" style="background:${COLORS[i%COLORS.length]}22;color:${COLORS[i%COLORS.length]};width:40px;height:40px;font-size:14px;flex-shrink:0;">
            ${name.split(' ').map(x=>x[0]||'').join('').substring(0,2).toUpperCase()}
          </div>
          <div style="flex:1;">
            <div style="font-weight:600;font-size:13.5px;">${name}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px;">${stats.fills} fills · ${stats.litres.toFixed(1)}L total</div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:700;color:var(--danger);">₹${stats.cost.toLocaleString()}</div>
            <div style="font-size:11px;color:var(--text2);">₹${stats.fills > 0 ? (stats.cost/stats.fills).toFixed(0) : 0}/fill avg</div>
          </div>
        </div>
      `).join('');
    }
  }

  // Main table
  const tb = document.getElementById('owner-fuel-table');
  if (!tb) return;

  if (filtered.length === 0) {
    tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text2);">No fuel entries found for the selected filters.</td></tr>';
    return;
  }

  tb.innerHTML = filtered.map(f => `
    <tr>
      <td style="color:var(--text2);font-size:12px;">${f.date}</td>
      <td>
        <div style="font-weight:500;font-size:13px;">${f.instructorName || 'Unknown'}</div>
        <div style="font-size:11px;color:var(--text2);">${f.instructorEmail || ''}</div>
      </td>
      <td style="font-size:12px;font-weight:500;">${f.vehicle || '—'}</td>
      <td><strong>${(f.litres||0)}L</strong></td>
      <td style="font-weight:600;color:var(--danger);">₹${(f.cost||0).toLocaleString()}</td>
      <td style="color:var(--text2);font-size:12px;">${f.km ? f.km.toLocaleString() + ' km' : '—'}</td>
      <td style="font-size:12px;color:var(--text2);">${f.notes || '—'}</td>
      <td><span class="badge ${f.status === 'submitted' ? 'badge-green' : 'badge-gray'}">${f.status || 'submitted'}</span></td>
    </tr>
  `).join('');
}

// Legacy fuel log render (kept for backward compatibility)
function renderFuelLog() {
  if (currentRole === 'instructor') {
    renderDriverFuelPage();
  } else if (currentRole === 'owner') {
    renderOwnerFuelDashboard();
  }
}

function addFuelEntry() {
  // Legacy: route to new driver function
  addDriverFuelEntry();
}

// ============================================================
// VEHICLES
// ============================================================
function renderVehicles() {
  const container = document.getElementById('vehicles-container');
  if (!container) return;

  // Update stats
  updateVehicleStats();

  // Populate school filter
  populateVehicleSchoolFilter();

  // Get filter value
  const schoolFilter = document.getElementById('vehicle-school-filter')?.value || '';

  // Filter vehicles
  const filteredVehicles = schoolFilter 
    ? data.vehicles.filter(v => v.school === schoolFilter)
    : data.vehicles;

  // Render vehicles
  if (filteredVehicles.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 60px 40px; color: var(--text2);">
        <div style="font-size: 56px; margin-bottom: 16px;">🚗</div>
        <div style="font-size: 16px; font-weight: 600; color: var(--text); margin-bottom: 8px;">No vehicles added yet</div>
        <div style="font-size: 13px;">${schoolFilter ? `No vehicles found for <strong>${schoolFilter}</strong>` : 'Add vehicles to your school fleet to track them here.'}</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="three-col" style="gap: 16px;">
      ${filteredVehicles.map(vehicle => `
        <div class="card" style="margin: 0; border-left: 4px solid ${vehicle.status === 'active' ? 'var(--success)' : vehicle.status === 'maintenance' ? 'var(--warning)' : 'var(--danger)'};">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
            <div>
              <div style="font-size: 16px; font-weight: 600; color: var(--text); margin-bottom: 4px;">${vehicle.name}</div>
              <div style="font-size: 12px; color: var(--text2);">${vehicle.reg}</div>
            </div>
            <span class="badge ${vehicle.status === 'active' ? 'badge-green' : vehicle.status === 'maintenance' ? 'badge-amber' : 'badge-red'}" style="font-size: 10px;">
              ${vehicle.status}
            </span>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; font-size: 12px;">
            <div>
              <div style="color: var(--text2); margin-bottom: 2px;">Type</div>
              <div style="font-weight: 500;">${vehicle.type}</div>
            </div>
            <div>
              <div style="color: var(--text2); margin-bottom: 2px;">School</div>
              <div style="font-weight: 500;">${vehicle.school}</div>
            </div>
            <div>
              <div style="color: var(--text2); margin-bottom: 2px;">Instructor</div>
              <div style="font-weight: 500;">${vehicle.instructor}</div>
            </div>
            <div>
              <div style="color: var(--text2); margin-bottom: 2px;">Last Service</div>
              <div style="font-weight: 500;">${new Date(vehicle.lastMaintenance).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</div>
            </div>
          </div>
          
          <div style="margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 12px; color: var(--text2);">Fuel Level</span>
              <span style="font-size: 12px; font-weight: 600; color: ${vehicle.fuelLevel < 30 ? 'var(--danger)' : vehicle.fuelLevel < 50 ? 'var(--warning)' : 'var(--success)'};">
                ${vehicle.fuelLevel}%
              </span>
            </div>
            <div class="fuel-bar-wrap" style="height: 8px;">
              <div class="fuel-fill" style="width: ${vehicle.fuelLevel}%; background: ${vehicle.fuelLevel < 30 ? 'linear-gradient(to right,#dc2626,#f87171)' : vehicle.fuelLevel < 50 ? 'linear-gradient(to right,#d97706,#fbbf24)' : 'linear-gradient(to right,#16a34a,#4ade80)'};">
              </div>
            </div>
          </div>
          
          <div style="display: flex; gap: 8px; justify-content: space-between;">
            <button class="btn btn-sm btn-outline" onclick="viewVehicleDetails(${vehicle.id})" style="flex: 1;">
              📋 Details
            </button>
            <button class="btn btn-sm btn-primary" onclick="scheduleMaintenance(${vehicle.id})" style="flex: 1;">
              🔧 Service
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function updateVehicleStats() {
  const totalVehicles = data.vehicles.length;
  const activeVehicles = data.vehicles.filter(v => v.status === 'active').length;
  const maintenanceDue = data.vehicles.filter(v => {
    const lastMaintenance = new Date(v.lastMaintenance);
    const today = new Date();
    const daysSinceMaintenance = Math.floor((today - lastMaintenance) / (1000 * 60 * 60 * 24));
    return daysSinceMaintenance > 30; // Due for maintenance if more than 30 days
  }).length;
  const schoolsWithVehicles = [...new Set(data.vehicles.map(v => v.school))].length;

  // Update stat cards
  const elements = {
    'total-vehicles': totalVehicles,
    'active-vehicles': activeVehicles,
    'maintenance-due': maintenanceDue,
    'schools-with-vehicles': schoolsWithVehicles
  };

  Object.keys(elements).forEach(id => {
    const element = document.getElementById(id);
    if (element) element.textContent = elements[id];
  });
}

function populateVehicleSchoolFilter() {
  const filter = document.getElementById('vehicle-school-filter');
  if (!filter) return;

  const schools = [...new Set(data.vehicles.map(v => v.school))];
  const currentValue = filter.value;
  
  filter.innerHTML = '<option value="">All Schools</option>' + 
    schools.map(school => `<option value="${school}" ${currentValue === school ? 'selected' : ''}>${school}</option>`).join('');
}

function filterVehiclesBySchool() {
  renderVehicles();
}

function refreshVehicles() {
  renderVehicles();
  addNotification('Vehicle data refreshed', 'success');
}

function openAddVehicleModal() {
  // Populate school dropdown
  const schoolSel = document.getElementById('veh-school');
  if (schoolSel) {
    schoolSel.innerHTML = '<option value="">-- Select School --</option>';
    (userSchools || []).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.name || s.id;
      opt.textContent = s.name || s.id;
      if (s.id === currentSchoolId) opt.selected = true;
      schoolSel.appendChild(opt);
    });
  }
  // Populate instructor dropdown
  const instSel = document.getElementById('veh-instructor');
  if (instSel) {
    instSel.innerHTML = '<option value="">-- Select Instructor --</option>';
    const instructors = (data.staff || []).filter(s => s.role === 'instructor');
    const adminInstructors = (data.admins || []).filter(a => a.role === 'instructor');
    const allInst = instructors.length > 0 ? instructors : adminInstructors;
    allInst.forEach(inst => {
      const opt = document.createElement('option');
      opt.value = inst.name;
      opt.textContent = inst.name;
      instSel.appendChild(opt);
    });
  }
  // Set today as default maintenance date
  const maintEl = document.getElementById('veh-maintenance');
  if (maintEl && !maintEl.value) maintEl.value = new Date().toISOString().split('T')[0];
  openModal('modal-add-vehicle');
}

async function saveNewVehicle() {
  const name = document.getElementById('veh-name').value.trim();
  const reg = document.getElementById('veh-reg').value.trim().toUpperCase();
  if (!name || !reg) { alert('Vehicle name and registration are required'); return; }

  const vehicleData = {
    name, reg,
    type: document.getElementById('veh-type').value,
    status: document.getElementById('veh-status').value,
    school: document.getElementById('veh-school').value || (userSchools[0] ? userSchools[0].name : ''),
    instructor: document.getElementById('veh-instructor').value || 'Unassigned',
    fuelLevel: parseInt(document.getElementById('veh-fuel').value) || 80,
    lastMaintenance: document.getElementById('veh-maintenance').value || new Date().toISOString().split('T')[0],
    chassis: document.getElementById('veh-chassis').value || '',
    engine: document.getElementById('veh-engine').value || '',
    insuranceExpiry: document.getElementById('veh-insurance-expiry').value || '',
    fcExpiry: document.getElementById('veh-fc-expiry').value || '',
    schoolId: currentSchoolId || '',
    createdAt: new Date().toISOString()
  };

  try {
    if (currentSchoolId && db) {
      const docRef = await db.collection('schools').doc(currentSchoolId).collection('vehicles').add({
        ...vehicleData,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      vehicleData.id = data.vehicles.length + 1;
      vehicleData.firebaseId = docRef.id;
    } else {
      vehicleData.id = data.vehicles.length + 1;
    }
    data.vehicles.push(vehicleData);
    closeModal('modal-add-vehicle');
    renderVehicles();
    // Also refresh vehicle dropdown in fuel modals
    const fvSel = document.getElementById('fuel-vehicle-new');
    if (fvSel) { const opt = document.createElement('option'); opt.value = vehicleData.name + ' (' + vehicleData.reg + ')'; opt.textContent = vehicleData.name + ' — ' + vehicleData.reg; fvSel.appendChild(opt); }
    addNotification('Vehicle ' + name + ' (' + reg + ') added successfully', 'success');
  } catch (err) {
    console.error('Error adding vehicle:', err);
    alert('Error saving vehicle. Please try again.');
  }
}

function viewVehicleDetails(vehicleId) {
  const vehicle = data.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return;

  alert(`Vehicle Details:\n\nName: ${vehicle.name}\nRegistration: ${vehicle.reg}\nType: ${vehicle.type}\nSchool: ${vehicle.school}\nStatus: ${vehicle.status}\nInstructor: ${vehicle.instructor}\nLast Maintenance: ${new Date(vehicle.lastMaintenance).toLocaleDateString('en-IN')}\nFuel Level: ${vehicle.fuelLevel}%`);
}

function scheduleMaintenance(vehicleId) {
  const vehicle = data.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return;

  const confirmed = confirm(`Schedule maintenance for ${vehicle.name} (${vehicle.reg})?`);
  if (confirmed) {
    // In a real app, this would open a modal or form
    const newDate = new Date();
    newDate.setDate(newDate.getDate() + 7); // Schedule for next week
    vehicle.lastMaintenance = newDate.toISOString().split('T')[0];
    vehicle.status = 'maintenance';
    
    renderVehicles();
    addNotification(`Maintenance scheduled for ${vehicle.name}`, 'success');
  }
}

// ============================================================
// NOTIFICATIONS
// ============================================================
function renderNotifications() {
  const list = document.getElementById('notif-list');
  if(!list) return;
  
  // Initialize notifications array if it doesn't exist
  if (!data.notifications || !Array.isArray(data.notifications)) {
    data.notifications = [];
  }
  
  list.innerHTML = data.notifications.map(n => `
    <div style="padding:16px 20px;background:${n.read?'var(--surface)':'#eff6ff'};border-radius:var(--radius);border:1px solid ${n.read?'var(--border)':'#bfdbfe'};margin-bottom:10px;display:flex;align-items:flex-start;gap:12px;">
      <span style="font-size:20px;">${n.type==='success'?'✅':n.type==='warning'?'⚠️':n.type==='alert'?'🔔':'ℹ️'}</span>
      <div style="flex:1;">
        <div style="font-size:13.5px;font-weight:${n.read?400:500};color:var(--text);">${n.msg}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px;">${n.time}</div>
      </div>
      ${!n.read?`<span class="badge badge-blue" style="font-size:10px;">New</span>`:''}
    </div>
  `).join('');
}

async function addNotification(msg, type='info') {
  try {
    const notificationData = {
      type,
      msg,
      time: 'Just now',
      read: false,
      id: Date.now().toString()
    };
    
    // Initialize notifications array if it doesn't exist
    if (!data.notifications) {
      data.notifications = [];
    }
    
    // Only save to Firebase if a school is selected
    if (currentSchoolId) {
      await FirebaseService.addDocument(FirebaseService.notificationsRef, notificationData);
    } else {
      // For overall view, just add to local data
      data.notifications.unshift(notificationData);
      renderNotifications();
    }
  } catch (error) {
    console.error('Error adding notification:', error);
    // Fallback: add to local data even if Firebase fails
    const notificationData = {
      type,
      msg,
      time: 'Just now',
      read: false,
      id: Date.now().toString()
    };
    
    // Initialize notifications array if it doesn't exist
    if (!data.notifications) {
      data.notifications = [];
    }
    
    data.notifications.unshift(notificationData);
    renderNotifications();
  }
}

function markAllRead() {
  if (data.notifications && Array.isArray(data.notifications)) {
    data.notifications.forEach(n=>n.read=true);
    renderNotifications();
  }
}

// ============================================================
// INCOME ANALYTICS
// ============================================================
let currentIncomeView = 'weekly';

function switchIncomeView(view, btn) {
  currentIncomeView = view;
  document.querySelectorAll('[id^="income-btn-"]').forEach(b => {
    b.className = b === btn ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
  });
  renderIncomeAnalytics();
}

function renderIncomeAnalytics() {
  const container = document.getElementById('income-analytics-content');
  if (!container) return;

  const transactions = (data.transactions || []).filter(t => !currentSchoolId || t.schoolId === currentSchoolId);
  const students = (data.students || []).filter(s => !currentSchoolId || s.schoolId === currentSchoolId);
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Calculate total pending balance from students
  const totalPending = students.reduce((sum, s) => {
    const balance = (s.totalFee || 0) - (s.paid || 0);
    return sum + (balance > 0 ? balance : 0);
  }, 0);

  let periods = [];
  let labels = [];
  let incomeData = [];
  let expenseData = [];

  if (currentIncomeView === 'daily') {
    // Last 7 days
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const label = i === 0 ? 'Today' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
      labels.push(label);
      const dayIncome = transactions.filter(t => t.type === 'income' && t.date === dateStr).reduce((s, t) => s + (t.amount || 0), 0);
      const dayExpense = transactions.filter(t => t.type === 'expense' && t.date === dateStr).reduce((s, t) => s + (t.amount || 0), 0);
      incomeData.push(dayIncome);
      expenseData.push(dayExpense);
    }
  } else if (currentIncomeView === 'weekly') {
    // Last 6 weeks
    for (let i = 5; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - (weekStart.getDay() || 7) + 1 - i * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const wsStr = weekStart.toISOString().split('T')[0];
      const weStr = weekEnd.toISOString().split('T')[0];
      labels.push('W' + (6 - i) + ' ' + weekStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
      const wIncome = transactions.filter(t => t.type === 'income' && t.date >= wsStr && t.date <= weStr).reduce((s, t) => s + (t.amount || 0), 0);
      const wExpense = transactions.filter(t => t.type === 'expense' && t.date >= wsStr && t.date <= weStr).reduce((s, t) => s + (t.amount || 0), 0);
      incomeData.push(wIncome);
      expenseData.push(wExpense);
    }
  } else if (currentIncomeView === 'monthly') {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    for (let i = 0; i < 12; i++) {
      const mm = (i + 1).toString().padStart(2, '0');
      const prefix = now.getFullYear() + '-' + mm;
      labels.push(months[i]);
      const mIncome = transactions.filter(t => t.type === 'income' && t.date && t.date.startsWith(prefix)).reduce((s, t) => s + (t.amount || 0), 0);
      const mExpense = transactions.filter(t => t.type === 'expense' && t.date && t.date.startsWith(prefix)).reduce((s, t) => s + (t.amount || 0), 0);
      incomeData.push(mIncome);
      expenseData.push(mExpense);
    }
  } else if (currentIncomeView === 'yearly') {
    const currentYear = now.getFullYear();
    for (let y = currentYear - 3; y <= currentYear; y++) {
      labels.push(y.toString());
      const yIncome = transactions.filter(t => t.type === 'income' && t.date && t.date.startsWith(y.toString())).reduce((s, t) => s + (t.amount || 0), 0);
      const yExpense = transactions.filter(t => t.type === 'expense' && t.date && t.date.startsWith(y.toString())).reduce((s, t) => s + (t.amount || 0), 0);
      incomeData.push(yIncome);
      expenseData.push(yExpense);
    }
  }

  const totalIncome = incomeData.reduce((a, b) => a + b, 0);
  const totalExpense = expenseData.reduce((a, b) => a + b, 0);
  const maxVal = Math.max(...incomeData, ...expenseData, 1);

  // Build bar chart + summary
  const barsHtml = labels.map((label, i) => {
    const ih = Math.round((incomeData[i] / maxVal) * 100);
    const eh = Math.round((expenseData[i] / maxVal) * 100);
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0;">
      <div style="width:100%;display:flex;gap:2px;align-items:flex-end;height:100px;">
        <div style="flex:1;background:linear-gradient(to top,#16a34a,#4ade80);height:${ih}%;border-radius:3px 3px 0 0;min-height:2px;" title="Income: ₹${incomeData[i].toLocaleString()}"></div>
        <div style="flex:1;background:linear-gradient(to top,#dc2626,#f87171);height:${eh}%;border-radius:3px 3px 0 0;min-height:2px;" title="Expense: ₹${expenseData[i].toLocaleString()}"></div>
      </div>
      <div style="font-size:9px;color:var(--text2);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;">${label}</div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
      <div style="background:#f0fdf4;border-radius:8px;padding:12px;text-align:center;border:1px solid #bbf7d0;">
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;margin-bottom:4px;">Total Income</div>
        <div style="font-size:18px;font-weight:700;font-family:'Syne';color:var(--success);">₹${totalIncome.toLocaleString()}</div>
        <div style="font-size:10px;color:var(--text2);">this period</div>
      </div>
      <div style="background:#fef2f2;border-radius:8px;padding:12px;text-align:center;border:1px solid #fecaca;">
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;margin-bottom:4px;">Total Expense</div>
        <div style="font-size:18px;font-weight:700;font-family:'Syne';color:var(--danger);">₹${totalExpense.toLocaleString()}</div>
        <div style="font-size:10px;color:var(--text2);">this period</div>
      </div>
      <div style="background:#eff6ff;border-radius:8px;padding:12px;text-align:center;border:1px solid #bfdbfe;">
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;margin-bottom:4px;">Net Profit</div>
        <div style="font-size:18px;font-weight:700;font-family:'Syne';color:var(--accent2);">₹${(totalIncome-totalExpense).toLocaleString()}</div>
        <div style="font-size:10px;color:var(--text2);">this period</div>
      </div>
      <div style="background:#fffbeb;border-radius:8px;padding:12px;text-align:center;border:1px solid #fde68a;">
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;margin-bottom:4px;">Pending Balance</div>
        <div style="font-size:18px;font-weight:700;font-family:'Syne';color:var(--warning);">₹${totalPending.toLocaleString()}</div>
        <div style="font-size:10px;color:var(--text2);">from ${students.filter(s=>(s.totalFee||0)>(s.paid||0)).length} students</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:8px;">
      <span style="display:flex;align-items:center;gap:4px;font-size:11px;"><span style="width:12px;height:12px;background:var(--success);border-radius:2px;display:inline-block;"></span> Income</span>
      <span style="display:flex;align-items:center;gap:4px;font-size:11px;"><span style="width:12px;height:12px;background:var(--danger);border-radius:2px;display:inline-block;"></span> Expense</span>
    </div>
    <div style="display:flex;gap:4px;align-items:flex-end;">${barsHtml}</div>
  `;
}

// ============================================================
// MODALS
// ============================================================
function openModal(id) {
  document.getElementById(id).classList.add('open');
  // Set default date
  const dateInputs = document.querySelectorAll(`#${id} input[type=date]`);
  dateInputs.forEach(i => { if(!i.value) i.value = new Date().toISOString().split('T')[0]; });
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if(e.target===m) m.classList.remove('open'); });
});

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('dash-date').textContent = new Date().toLocaleDateString('en-IN',{weekday:'short',year:'numeric',month:'short',day:'numeric'});
});

// ============================================================
// EDIT STUDENT
// ============================================================
async function editStudent(id) {
  const studentId = String(id);
  let s = data.students.find(x => String(x.firebaseId) === studentId || String(x.id) === studentId);
  if (!s && currentSchoolId && typeof db !== 'undefined') {
    try {
      const doc = await db.collection('schools').doc(currentSchoolId).collection('students').doc(id).get();
      if (doc.exists) s = { ...doc.data(), firebaseId: doc.id, id: doc.id };
    } catch(e) { console.warn('Could not fetch student:', e.message); }
  }
  if (!s) { showToast('⚠ Student not found'); return; }
  openEditStudentModal(s);
}

function openEditStudentModal(s) {
  const old = document.getElementById('modal-edit-student');
  if (old) old.remove();
  const modal = document.createElement('div');
  modal.id = 'modal-edit-student';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
  <div class="modal" style="width:680px;max-width:96vw;max-height:90vh;overflow-y:auto;">
    <div class="modal-header">
      <h3>✏️ Edit Student — ${s.name}</h3>
      <button class="modal-close" onclick="document.getElementById('modal-edit-student').remove()">✕</button>
    </div>
    <div class="tabs" style="margin-bottom:18px;">
      <div class="tab active" onclick="switchStudentTab('edit-personal',this)">Personal Info</div>
      <div class="tab" onclick="switchStudentTab('edit-course',this)">Course & Fee</div>
    </div>
    <div id="stab-edit-personal">
      <div class="form-grid">
        <div class="form-group"><label>Full Name *</label><input type="text" id="edit-s-name" value="${s.name||''}"></div>
        <div class="form-group"><label>Phone *</label><input type="tel" id="edit-s-phone" value="${s.phone||''}"></div>
        <div class="form-group"><label>Date of Birth</label><input type="date" id="edit-s-dob" value="${s.dob||''}"></div>
        <div class="form-group"><label>Email</label><input type="email" id="edit-s-email" value="${s.email||''}"></div>
        <div class="form-group full"><label>Address</label><textarea id="edit-s-address" style="min-height:60px;">${s.address||''}</textarea></div>
        <div class="form-group"><label>Aadhaar</label><input type="text" id="edit-s-aadhaar" value="${s.aadhaar||''}"></div>
        <div class="form-group"><label>Emergency Contact</label><input type="tel" id="edit-s-emergency" value="${s.emergencyContact||''}"></div>
        <div class="form-group"><label>Blood Group</label>
          <select id="edit-s-blood">
            ${['','A+','A-','B+','B-','AB+','AB-','O+','O-'].map(b=>`<option ${s.blood===b?'selected':''}>${b}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Gender</label>
          <select id="edit-s-gender">
            ${['','Male','Female','Other'].map(g=>`<option ${s.gender===g?'selected':''}>${g}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <div id="stab-edit-course" style="display:none;">
      <div class="form-grid">
        <div class="form-group"><label>Vehicle Type</label>
          <select id="edit-s-vehicle">
            ${['2-Wheeler (Gear)','2-Wheeler (Gearless)','4-Wheeler (LMV)','Both 2W + 4W'].map(v=>`<option ${s.vehicle===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Instructor</label>
          <select id="edit-s-instructor">
            <option value="">-- No Instructor --</option>
            ${(data.staff||[]).filter(x=>x.role==='instructor').concat((data.admins||[]).filter(x=>x.role==='instructor')).map(i=>`<option value="${i.email||i.name}" ${(s.instructorEmail===i.email||s.instructor===i.name)?'selected':''}>${i.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Class Time</label><input type="time" id="edit-s-classtime" value="${s.classTime||''}"></div>
        <div class="form-group"><label>Total Classes</label><input type="number" id="edit-s-total-classes" value="${s.totalClasses||27}"></div>
        <div class="form-group"><label>Classes Done</label><input type="number" id="edit-s-classes" value="${s.classes||0}"></div>
        <div class="form-group"><label>Total Fee (₹)</label><input type="number" id="edit-s-fee" value="${s.totalFee||0}"></div>
        <div class="form-group"><label>Amount Paid (₹)</label><input type="number" id="edit-s-paid" value="${s.paid||0}"></div>
        <div class="form-group"><label>Status</label>
          <select id="edit-s-status">
            ${['Active','Pending','Completed','Dropped'].map(st=>`<option ${s.status===st?'selected':''}>${st}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Enrollment Date</label><input type="date" id="edit-s-enrolled" value="${s.enrolled||''}"></div>
        <div class="form-group full"><label>Notes</label><textarea id="edit-s-notes" style="min-height:60px;">${s.notes||''}</textarea></div>
      </div>
    </div>
    <div style="margin-top:20px;display:flex;gap:10px;border-top:1px solid var(--border);padding-top:16px;">
      <button class="btn btn-accent" onclick="saveEditStudent('${s.firebaseId||s.id}')" style="flex:1;">✓ Save Changes</button>
      <button class="btn btn-outline" onclick="document.getElementById('modal-edit-student').remove()">Cancel</button>
    </div>
  </div>`;
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
  document.body.appendChild(modal);
}

async function saveEditStudent(studentId) {
  const name = document.getElementById('edit-s-name')?.value.trim();
  const phone = document.getElementById('edit-s-phone')?.value.trim();
  if (!name || !phone) { alert('Name and phone are required'); return; }
  const instSel = document.getElementById('edit-s-instructor');
  const instEmail = instSel?.value || '';
  const instName = instSel ? (instSel.options[instSel.selectedIndex]?.text || '') : '';
  const updates = {
    name, phone,
    dob: document.getElementById('edit-s-dob')?.value||'',
    email: document.getElementById('edit-s-email')?.value||'',
    address: document.getElementById('edit-s-address')?.value||'',
    aadhaar: document.getElementById('edit-s-aadhaar')?.value||'',
    blood: document.getElementById('edit-s-blood')?.value||'',
    gender: document.getElementById('edit-s-gender')?.value||'',
    vehicle: document.getElementById('edit-s-vehicle')?.value||'',
    instructorEmail: instEmail,
    instructor: instName,
    classTime: document.getElementById('edit-s-classtime')?.value||'',
    totalClasses: parseInt(document.getElementById('edit-s-total-classes')?.value)||27,
    classes: parseInt(document.getElementById('edit-s-classes')?.value)||0,
    totalFee: parseInt(document.getElementById('edit-s-fee')?.value)||0,
    paid: parseInt(document.getElementById('edit-s-paid')?.value)||0,
    status: document.getElementById('edit-s-status')?.value||'Active',
    enrolled: document.getElementById('edit-s-enrolled')?.value||'',
    notes: document.getElementById('edit-s-notes')?.value||''
  };
  try {
    if (currentSchoolId && typeof db !== 'undefined') {
      await db.collection('schools').doc(currentSchoolId).collection('students').doc(String(studentId)).update(updates);
    }
    const local = data.students.find(x => String(x.firebaseId)===String(studentId)||String(x.id)===String(studentId));
    if (local) Object.assign(local, updates);
    document.getElementById('modal-edit-student').remove();
    renderStudentsTable();
    showToast('✅ Student updated!');
  } catch(e) {
    console.error('Edit student error:', e);
    alert('Error saving. Please try again.');
  }
}

async function deleteStudentRecord(studentId) {
  if (!hasActionPermission('delete_student')) {
    alert('You do not have permission to delete students.');
    return;
  }
  const id = String(studentId);
  const student = data.students.find(x => String(x.firebaseId) === id || String(x.id) === id);
  const studentName = student ? student.name : id;
  if (!confirm(`Are you sure you want to delete student "${studentName}"? This action cannot be undone.`)) {
    return;
  }
  try {
    if (!currentSchoolId || typeof db === 'undefined') {
      alert('Please select a school before deleting a student.');
      return;
    }
    await FirebaseService.deleteStudent(id);
    data.students = (data.students || []).filter(x => String(x.firebaseId) !== id && String(x.id) !== id);
    renderStudentsTable();
    showToast('✅ Student deleted successfully.');
  } catch (error) {
    console.error('Delete student error:', error);
    alert('Error deleting student. Please try again.');
  }
}

// ============================================================
// INVOICE GENERATION
// ============================================================
function generateStudentInvoice(id) {
  const studentId = String(id);
  const s = data.students.find(function(x){ return String(x.firebaseId)===studentId||String(x.id)===studentId; });
  if (!s) { showToast('Student not found'); return; }
  const totalFee = s.totalFee||0;
  const paid = s.paid||0;
  const balance = totalFee - paid;
  const installments = s.installments||[];
  const invoiceNo = 'INV-' + (s.firebaseId||s.id||'').toString().slice(-6).toUpperCase() + '-' + Date.now().toString().slice(-4);
  const today = new Date().toLocaleDateString('en-IN',{year:'numeric',month:'long',day:'numeric'});
  const schoolName = (userSchools.find(function(sc){return sc.id===currentSchoolId;})||{}).name || 'DrivePro School';

  // Build installments table rows
  let instRows = '';
  if (installments.length > 0) {
    installments.forEach(function(inst, idx) {
      const bg = idx%2===0 ? 'white' : 'var(--surface2)';
      instRows += '<tr style="border-bottom:1px solid var(--border);background:' + bg + '">' +
        '<td style="padding:8px 12px;">' + inst.date + '</td>' +
        '<td style="padding:8px 12px;color:var(--success);font-weight:600;">\u20b9' + (inst.amount||0).toLocaleString() + '</td>' +
        '<td style="padding:8px 12px;">' + (inst.mode||'Cash') + '</td>' +
        '<td style="padding:8px 12px;color:var(--text2);">' + (inst.note||'\u2014') + '</td></tr>';
    });
  }
  const instSection = installments.length > 0
    ? '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:var(--surface2);"><th style="padding:8px 12px;text-align:left;">Date</th><th style="padding:8px 12px;text-align:left;">Amount</th><th style="padding:8px 12px;text-align:left;">Mode</th><th style="padding:8px 12px;text-align:left;">Note</th></tr></thead><tbody>' + instRows + '</tbody></table>'
    : '<div style="text-align:center;padding:16px;color:var(--text2);background:var(--surface2);border-radius:8px;">No installments recorded yet</div>';

  const balColor = balance>0 ? 'var(--danger)' : 'var(--success)';
  const balLabel = balance>0 ? 'Balance Due (Pending)' : 'Fully Paid \u2713';
  const emailRow = s.email ? '<div style="font-size:13px;color:var(--text2);">\u2709\ufe0f ' + s.email + '</div>' : '';
  const addrRow = s.address ? '<div style="font-size:12px;color:var(--text2);margin-top:4px;">' + s.address + '</div>' : '';

  let pendingBox = '';
  if (balance > 0) {
    const nextInfo = installments.length > 0 ? 'Next installment due after ' + installments[installments.length-1].date + '.' : 'Please arrange payment at the earliest.';
    pendingBox = '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-bottom:16px;">' +
      '<div style="font-weight:600;color:#92400e;margin-bottom:6px;">\u26a0\ufe0f Pending Balance</div>' +
      '<div style="font-size:13px;color:#92400e;">Remaining amount of <strong>\u20b9' + balance.toLocaleString() + '</strong> is due. ' + nextInfo + '</div></div>';
  }

  const invoiceHTML =
    '<div style="background:white;padding:30px;border:1px solid var(--border);border-radius:12px;" id="invoice-content">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;border-bottom:2px solid var(--primary);padding-bottom:20px;">' +
        '<div><div style="font-family:\'Syne\';font-size:22px;font-weight:700;color:var(--primary);">' + schoolName + '</div><div style="font-size:12px;color:var(--text2);">Driving School Management</div></div>' +
        '<div style="text-align:right;"><div style="font-family:\'Syne\';font-size:18px;font-weight:700;color:var(--accent);">INVOICE</div><div style="font-size:12px;color:var(--text2);">' + invoiceNo + '</div><div style="font-size:12px;color:var(--text2);">Date: ' + today + '</div></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">' +
        '<div style="background:var(--surface2);border-radius:8px;padding:14px;">' +
          '<div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Bill To</div>' +
          '<div style="font-weight:600;font-size:15px;color:var(--text);">' + s.name + '</div>' +
          '<div style="font-size:13px;color:var(--text2);">\ud83d\udcde ' + s.phone + '</div>' + emailRow + addrRow +
        '</div>' +
        '<div style="background:var(--surface2);border-radius:8px;padding:14px;">' +
          '<div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Course Details</div>' +
          '<div style="font-size:13px;line-height:1.9;">' +
            '<span style="color:var(--text2);">Vehicle:</span> <strong>' + (s.vehicle||'\u2014') + '</strong><br>' +
            '<span style="color:var(--text2);">Instructor:</span> <strong>' + (s.instructor||'\u2014') + '</strong><br>' +
            '<span style="color:var(--text2);">Enrolled:</span> <strong>' + (s.enrolled||'\u2014') + '</strong><br>' +
            '<span style="color:var(--text2);">Classes:</span> <strong>' + (s.classes||0) + '/' + (s.totalClasses||27) + '</strong>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">' +
        '<thead><tr style="background:var(--primary);color:white;"><th style="padding:10px 14px;text-align:left;font-size:12px;">Description</th><th style="padding:10px 14px;text-align:right;font-size:12px;">Amount (\u20b9)</th></tr></thead>' +
        '<tbody><tr style="border-bottom:1px solid var(--border);">' +
          '<td style="padding:10px 14px;font-size:13px;">Driving Course Fee \u2014 ' + (s.vehicle||'') + '</td>' +
          '<td style="padding:10px 14px;text-align:right;font-weight:600;">\u20b9' + totalFee.toLocaleString() + '</td>' +
        '</tr></tbody>' +
        '<tfoot>' +
          '<tr style="background:#f0fdf4;"><td style="padding:10px 14px;font-size:13px;color:var(--success);">Total Paid</td><td style="padding:10px 14px;text-align:right;font-weight:700;color:var(--success);">\u20b9' + paid.toLocaleString() + '</td></tr>' +
          '<tr style="background:' + (balance>0?'#fef2f2':'#f0fdf4') + ';"><td style="padding:10px 14px;font-size:13px;font-weight:600;color:' + balColor + ';">' + balLabel + '</td><td style="padding:10px 14px;text-align:right;font-weight:700;font-size:16px;color:' + balColor + ';">\u20b9' + Math.abs(balance).toLocaleString() + '</td></tr>' +
        '</tfoot>' +
      '</table>' +
      '<div style="margin-bottom:20px;">' +
        '<div style="font-family:\'Syne\';font-size:14px;font-weight:600;margin-bottom:10px;">\ud83d\udcb3 Payment History (Installments)</div>' +
        instSection +
      '</div>' +
      pendingBox +
      '<div style="border-top:1px solid var(--border);padding-top:16px;text-align:center;font-size:11px;color:var(--text2);">Generated by DrivePro \u2022 ' + today + ' \u2022 This is a computer-generated invoice.</div>' +
    '</div>';

  const modalHTML =
    '<div class="modal" style="width:700px;max-width:96vw;max-height:90vh;overflow-y:auto;">' +
      '<div class="modal-header">' +
        '<h3>\ud83e\uddfe Fee Invoice</h3>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="btn btn-primary btn-sm" onclick="printInvoice()">\ud83d\uddb8 Print</button>' +
          '<button class="modal-close" onclick="document.getElementById(\'modal-invoice\').remove()">\u2715</button>' +
        '</div>' +
      '</div>' +
      invoiceHTML +
      '<div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end;">' +
        '<button class="btn btn-outline" onclick="document.getElementById(\'modal-invoice\').remove()">Close</button>' +
        '<button class="btn btn-primary" onclick="printInvoice()">\ud83d\uddb8 Print Invoice</button>' +
      '</div>' +
    '</div>';

  const old = document.getElementById('modal-invoice');
  if (old) old.remove();
  const modal = document.createElement('div');
  modal.id = 'modal-invoice';
  modal.className = 'modal-overlay open';
  modal.innerHTML = modalHTML;
  modal.addEventListener('click', function(e) { if(e.target===modal) modal.remove(); });
  document.body.appendChild(modal);
}

function printInvoice() {
  const content = document.getElementById('invoice-content');
  if (!content) return;
  const win = window.open('','_blank','width=800,height=900');
  const html = '<html><head><title>Invoice</title><style>' +
    'body{font-family:\'DM Sans\',sans-serif;color:#1e293b;margin:0;padding:20px;}' +
    'table{width:100%;border-collapse:collapse;}' +
    '@page{margin:15mm;}' +
    '@media print{button{display:none!important;}}' +
    '</style></head><body>' + content.innerHTML +
    '<script>window.onload=function(){window.print();window.close();}' + '<\/script>' +
    '</body></html>';
  win.document.write(html);
  win.document.close();
}

// Add invoice button to viewStudent modal
// Patch openStudentDetailModal to add Invoice and Edit buttons
const _origOpenStudentDetailModal = window._origOpenStudentDetailModal || null;
function openStudentDetailModalWithButtons(s) {
  openStudentDetailModal(s);
  setTimeout(function() {
    const modal = document.getElementById('modal-student-detail');
    if (!modal) return;
    const footer = modal.querySelector('[style*="justify-content:flex-end"]');
    if (footer && !footer.querySelector('.invoice-btn')) {
      const sid = (s.firebaseId || s.id || '').toString();
      footer.insertAdjacentHTML('afterbegin',
        '<button class="btn btn-success invoice-btn" onclick="generateStudentInvoice(\'' + sid + '\')">&#x1F9FE; Invoice</button>' +
        '<button class="btn btn-primary invoice-btn" onclick="editStudent(\'' + sid + '\');document.getElementById(\'modal-student-detail\').remove()">&#x270F;&#xFE0F; Edit</button>'
      );
    }
  }, 50);
}

// ============================================================
// OTHER SERVICES PAGE
// ============================================================
function renderOtherServices() {
  const page = document.getElementById('page-other-services');
  if (!page) return;
  const services = (data.otherServices||[]).filter(function(s){ return !currentSchoolId || s.schoolId === currentSchoolId; });
  const totalCollected = services.reduce(function(a,s){ return a+(s.amountPaid||0); },0);
  const totalPending = services.reduce(function(a,s){ return a+Math.max(0,(s.totalAmount||0)-(s.amountPaid||0)); },0);
  const activeInst = services.filter(function(s){ return (s.installments||[]).length>0 && s.amountPaid < s.totalAmount; }).length;

  let tableHtml;
  if (services.length === 0) {
    tableHtml = '<div style="text-align:center;padding:40px;color:var(--text2);">No services added yet. Click + Add Service to start.</div>';
  } else {
    const rows = services.map(function(svc) {
      const bal = (svc.totalAmount||0)-(svc.amountPaid||0);
      const balColor = bal>0 ? 'var(--danger)' : 'var(--success)';
      const badgeCls = bal<=0 ? 'badge-green' : 'badge-amber';
      const badgeLabel = bal<=0 ? 'Paid' : 'Pending';
      return '<tr>' +
        '<td><div style="font-weight:500">' + (svc.clientName||'—') + '</div><div style="font-size:11px;color:var(--text2)">' + (svc.clientPhone||'') + '</div></td>' +
        '<td style="font-size:12px;color:var(--text2);max-width:150px;">' + (svc.clientAddress||'—') + '</td>' +
        '<td style="font-size:12px;">' + (svc.serviceType||'—') + '</td>' +
        '<td style="font-weight:600;">\u20b9' + (svc.totalAmount||0).toLocaleString() + '</td>' +
        '<td style="color:var(--success);font-weight:600;">\u20b9' + (svc.amountPaid||0).toLocaleString() + '</td>' +
        '<td style="color:' + balColor + ';font-weight:600;">\u20b9' + Math.abs(bal).toLocaleString() + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + badgeLabel + '</span></td>' +
        '<td><div style="display:flex;gap:4px;">' +
          '<button class="btn btn-outline btn-sm" onclick="viewOtherService(\'' + svc.id + '\')">View</button>' +
          '<button class="btn btn-primary btn-sm" onclick="generateServiceInvoice(\'' + svc.id + '\')">\ud83e\uddfe</button>' +
        '</div></td></tr>';
    }).join('');
    tableHtml = '<table class="data-table"><thead><tr><th>Client Name</th><th>Address</th><th>Service</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  page.innerHTML =
    '<div class="page-header">' +
      '<div><h2>\ud83d\udd27 Other Services</h2><p>Non-student service clients and payments</p></div>' +
      '<button class="btn btn-accent" onclick="openAddOtherServiceModal()">+ Add Service</button>' +
    '</div>' +
    '<div class="stats-grid">' +
      '<div class="stat-card accent"><div class="sc-label">Total Clients</div><div class="sc-value" style="color:var(--primary)">' + services.length + '</div><div class="sc-sub">Service clients</div></div>' +
      '<div class="stat-card green"><div class="sc-label">Total Collected</div><div class="sc-value" style="color:var(--success)">\u20b9' + totalCollected.toLocaleString() + '</div><div class="sc-sub">Paid</div></div>' +
      '<div class="stat-card red"><div class="sc-label">Pending</div><div class="sc-value" style="color:var(--danger)">\u20b9' + totalPending.toLocaleString() + '</div><div class="sc-sub">Balance due</div></div>' +
      '<div class="stat-card blue"><div class="sc-label">Active Installments</div><div class="sc-value" style="color:var(--accent2)">' + activeInst + '</div><div class="sc-sub">Ongoing</div></div>' +
    '</div>' +
    '<div class="card" style="padding:0;overflow:hidden">' +
      '<div style="padding:16px 20px;border-bottom:1px solid var(--border);">' +
        '<input type="text" placeholder="\ud83d\udd0d Search clients..." style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;width:300px;font-family:\'DM Sans\';font-size:13px;" oninput="filterOtherServices(this.value)">' +
      '</div>' +
      '<div id="other-services-list">' + tableHtml + '</div>' +
    '</div>';
}

function filterOtherServices(query) {
  const services = (data.otherServices||[]).filter(s => (!currentSchoolId||s.schoolId===currentSchoolId) && s.clientName && s.clientName.toLowerCase().includes(query.toLowerCase()));
  // re-render list only
  renderOtherServices();
}

function openAddOtherServiceModal() {
  const old = document.getElementById('modal-add-other-service');
  if (old) old.remove();
  const modal = document.createElement('div');
  modal.id = 'modal-add-other-service';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
  <div class="modal" style="width:640px;max-width:96vw;max-height:90vh;overflow-y:auto;">
    <div class="modal-header">
      <h3>🔧 Add Other Service Client</h3>
      <button class="modal-close" onclick="document.getElementById('modal-add-other-service').remove()">✕</button>
    </div>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#1d4ed8;">
      ℹ️ Add a non-student service client with payment and installment tracking.
    </div>
    <div class="form-grid">
      <div class="form-group"><label>Client Name *</label><input type="text" id="os-client-name" placeholder="Full name"></div>
      <div class="form-group"><label>Phone *</label><input type="tel" id="os-client-phone" placeholder="Phone number"></div>
      <div class="form-group full"><label>Client Address *</label><textarea id="os-client-address" style="min-height:60px;" placeholder="Full address"></textarea></div>
      <div class="form-group"><label>Service Type *</label>
        <select id="os-service-type">
          <option>Vehicle Registration</option>
          <option>DL Renewal</option>
          <option>RC Transfer</option>
          <option>Insurance</option>
          <option>Hypothecation</option>
          <option>NOC</option>
          <option>Fitness Certificate</option>
          <option>Other</option>
        </select>
      </div>
      <div class="form-group"><label>Service Description</label><input type="text" id="os-description" placeholder="Details of service"></div>
      <div class="form-group"><label>Total Amount Discussed (₹) *</label><input type="number" id="os-total-amount" placeholder="Total agreed amount" oninput="calcOsBalance()"></div>
      <div class="form-group"><label>Initial Payment (₹) *</label><input type="number" id="os-initial-payment" placeholder="Amount paid now" oninput="calcOsBalance()"></div>
      <div class="form-group"><label>Payment Mode</label>
        <select id="os-payment-mode"><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option></select>
      </div>
      <div class="form-group"><label>Service Date</label><input type="date" id="os-date" value="${new Date().toISOString().split('T')[0]}"></div>
      <div class="form-group"><label>Expected Completion</label><input type="date" id="os-expected-date"></div>
    </div>
    <div id="os-balance-display" style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;margin-top:10px;display:none;">
      <div style="display:flex;justify-content:space-between;font-size:13px;">
        <span>Remaining Balance:</span>
        <strong id="os-balance-value" style="color:var(--danger);">₹0</strong>
      </div>
    </div>
    <!-- Installment Toggle -->
    <div style="margin-top:16px;padding:14px;background:var(--surface2);border-radius:10px;border:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <input type="checkbox" id="os-has-installments" onchange="toggleOsInstallments()">
        <label for="os-has-installments" style="font-weight:500;cursor:pointer;">Enable Installment Plan</label>
      </div>
      <div id="os-installments-section" style="display:none;">
        <div class="form-grid">
          <div class="form-group"><label>No. of Installments</label><input type="number" id="os-num-inst" placeholder="e.g. 3" min="1" max="12"></div>
          <div class="form-group"><label>Installment Frequency</label>
            <select id="os-inst-freq"><option>Weekly</option><option>Monthly</option><option>Custom</option></select>
          </div>
        </div>
      </div>
    </div>
    <div style="margin-top:20px;display:flex;gap:10px;">
      <button class="btn btn-accent" onclick="saveOtherService()" style="flex:1;">✓ Add Service</button>
      <button class="btn btn-outline" onclick="document.getElementById('modal-add-other-service').remove()">Cancel</button>
    </div>
  </div>`;
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
  document.body.appendChild(modal);
}

function calcOsBalance() {
  const total = parseFloat(document.getElementById('os-total-amount')?.value||'0');
  const paid = parseFloat(document.getElementById('os-initial-payment')?.value||'0');
  const bal = total - paid;
  const display = document.getElementById('os-balance-display');
  const valEl = document.getElementById('os-balance-value');
  if (display && valEl) {
    display.style.display = total > 0 ? 'block' : 'none';
    valEl.textContent = '₹' + Math.max(0,bal).toLocaleString();
  }
}

function toggleOsInstallments() {
  const sec = document.getElementById('os-installments-section');
  if (sec) sec.style.display = document.getElementById('os-has-installments')?.checked ? 'block' : 'none';
}

async function saveOtherService() {
  const clientName = document.getElementById('os-client-name')?.value.trim();
  const clientPhone = document.getElementById('os-client-phone')?.value.trim();
  const clientAddress = document.getElementById('os-client-address')?.value.trim();
  const totalAmount = parseFloat(document.getElementById('os-total-amount')?.value||'0');
  const initialPayment = parseFloat(document.getElementById('os-initial-payment')?.value||'0');
  if (!clientName||!clientPhone||!clientAddress||!totalAmount) { alert('Please fill all required fields'); return; }
  const serviceData = {
    clientName, clientPhone, clientAddress,
    serviceType: document.getElementById('os-service-type')?.value||'',
    description: document.getElementById('os-description')?.value||'',
    totalAmount, amountPaid: initialPayment,
    paymentMode: document.getElementById('os-payment-mode')?.value||'Cash',
    date: document.getElementById('os-date')?.value||new Date().toISOString().split('T')[0],
    expectedDate: document.getElementById('os-expected-date')?.value||'',
    hasInstallments: document.getElementById('os-has-installments')?.checked||false,
    numInstallments: parseInt(document.getElementById('os-num-inst')?.value||'0'),
    installmentFreq: document.getElementById('os-inst-freq')?.value||'Monthly',
    installments: initialPayment>0?[{date:document.getElementById('os-date')?.value||new Date().toISOString().split('T')[0],amount:initialPayment,mode:document.getElementById('os-payment-mode')?.value||'Cash',note:'Initial payment'}]:[],
    schoolId: currentSchoolId,
    createdAt: new Date().toISOString()
  };
  try {
    if (currentSchoolId && typeof db !== 'undefined') {
      const ref = await db.collection('schools').doc(currentSchoolId).collection('otherServices').add(serviceData);
      serviceData.id = ref.id;
      serviceData.firebaseId = ref.id;
    } else {
      serviceData.id = 'local-' + Date.now();
    }
    if (!data.otherServices) data.otherServices = [];
    data.otherServices.push(serviceData);
    // Add to cashflow
    if (initialPayment > 0 && currentSchoolId) {
      await FirebaseService.addTransaction({ date: serviceData.date, type: 'income', category: 'Other Service Fee', desc: `Service: ${clientName} — ${serviceData.serviceType}`, amount: initialPayment, schoolId: currentSchoolId });
    }
    document.getElementById('modal-add-other-service').remove();
    renderOtherServices();
    addNotification(`Other service added: ${clientName}`, 'success');
  } catch(e) { console.error(e); alert('Error saving service: ' + e.message); }
}

function viewOtherService(id) {
  const svc = (data.otherServices||[]).find(s=>s.id===id||s.firebaseId===id);
  if (!svc) { showToast('Service not found'); return; }
  const bal = (svc.totalAmount||0)-(svc.amountPaid||0);
  const old = document.getElementById('modal-view-other-service');
  if (old) old.remove();
  const modal = document.createElement('div');
  modal.id = 'modal-view-other-service';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
  <div class="modal" style="width:680px;max-width:96vw;max-height:90vh;overflow-y:auto;">
    <div class="modal-header">
      <h3>🔧 ${svc.clientName}</h3>
      <button class="modal-close" onclick="document.getElementById('modal-view-other-service').remove()">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px;">
      <div style="background:var(--surface2);border-radius:10px;padding:14px 16px;">
        <div style="font-size:11px;color:var(--text2);margin-bottom:8px;">CLIENT INFO</div>
        <div style="font-size:13px;line-height:2;">
          <span style="color:var(--text2);">Phone:</span> <strong>${svc.clientPhone||'—'}</strong><br>
          <span style="color:var(--text2);">Address:</span> <strong>${svc.clientAddress||'—'}</strong>
        </div>
      </div>
      <div style="background:var(--surface2);border-radius:10px;padding:14px 16px;">
        <div style="font-size:11px;color:var(--text2);margin-bottom:8px;">SERVICE INFO</div>
        <div style="font-size:13px;line-height:2;">
          <span style="color:var(--text2);">Type:</span> <strong>${svc.serviceType||'—'}</strong><br>
          <span style="color:var(--text2);">Date:</span> <strong>${svc.date||'—'}</strong><br>
          <span style="color:var(--text2);">Expected:</span> <strong>${svc.expectedDate||'—'}</strong>
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px;">
      <div style="background:var(--surface2);border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:11px;color:var(--text2);">Total Amount</div>
        <div style="font-size:18px;font-weight:700;font-family:'Syne';">₹${(svc.totalAmount||0).toLocaleString()}</div>
      </div>
      <div style="background:#f0fdf4;border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:11px;color:var(--text2);">Paid</div>
        <div style="font-size:18px;font-weight:700;font-family:'Syne';color:var(--success);">₹${(svc.amountPaid||0).toLocaleString()}</div>
      </div>
      <div style="background:${bal>0?'#fef2f2':'#f0fdf4'};border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:11px;color:var(--text2);">Balance</div>
        <div style="font-size:18px;font-weight:700;font-family:'Syne';color:${bal>0?'var(--danger)':'var(--success)'};">₹${Math.abs(bal).toLocaleString()}</div>
      </div>
    </div>
    <!-- Installments -->
    <div style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-family:'Syne';font-size:14px;font-weight:600;">💳 Payment History</div>
        ${bal>0?`<button class="btn btn-accent btn-sm" onclick="openAddServiceInstallment('${svc.id||svc.firebaseId}')">+ Add Payment</button>`:'<span class="badge badge-green">✓ Fully Paid</span>'}
      </div>
      <table class="data-table">
        <thead><tr><th>Date</th><th>Amount</th><th>Mode</th><th>Note</th></tr></thead>
        <tbody>
        ${(svc.installments||[]).length>0
          ? (svc.installments||[]).map(inst=>`<tr><td>${inst.date}</td><td style="color:var(--success);font-weight:600;">₹${(inst.amount||0).toLocaleString()}</td><td>${inst.mode||'Cash'}</td><td style="color:var(--text2);">${inst.note||'—'}</td></tr>`).join('')
          : '<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--text2);">No payments recorded</td></tr>'}
        </tbody>
      </table>
    </div>
    <div id="service-install-form-${svc.id}" style="display:none;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px;margin-bottom:14px;">
      <div style="font-weight:600;margin-bottom:10px;">Add Payment</div>
      <div class="form-grid">
        <div class="form-group"><label>Date</label><input type="date" id="si-date-${svc.id}" value="${new Date().toISOString().split('T')[0]}"></div>
        <div class="form-group"><label>Amount (₹)</label><input type="number" id="si-amount-${svc.id}" placeholder="Enter amount" max="${bal}"></div>
        <div class="form-group"><label>Mode</label><select id="si-mode-${svc.id}"><option>Cash</option><option>UPI</option><option>Bank Transfer</option></select></div>
        <div class="form-group"><label>Note</label><input type="text" id="si-note-${svc.id}" placeholder="Optional"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn btn-success btn-sm" onclick="saveServiceInstallment('${svc.id}')">Save</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('service-install-form-${svc.id}').style.display='none'">Cancel</button>
      </div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;border-top:1px solid var(--border);padding-top:14px;">
      <button class="btn btn-primary" onclick="generateServiceInvoice('${svc.id}')">🧾 Invoice</button>
      <button class="btn btn-outline" onclick="document.getElementById('modal-view-other-service').remove()">Close</button>
    </div>
  </div>`;
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
  document.body.appendChild(modal);
}

function openAddServiceInstallment(id) {
  const form = document.getElementById('service-install-form-' + id);
  if (form) form.style.display = 'block';
}

async function saveServiceInstallment(id) {
  const svc = (data.otherServices||[]).find(s=>s.id===id||s.firebaseId===id);
  if (!svc) return;
  const date = document.getElementById('si-date-'+id)?.value;
  const amount = parseFloat(document.getElementById('si-amount-'+id)?.value||'0');
  const mode = document.getElementById('si-mode-'+id)?.value||'Cash';
  const note = document.getElementById('si-note-'+id)?.value||'';
  if (!date||amount<=0) { alert('Please enter date and amount'); return; }
  if (!svc.installments) svc.installments = [];
  svc.installments.push({ date, amount, mode, note });
  svc.amountPaid = (svc.amountPaid||0) + amount;
  try {
    if (currentSchoolId && typeof db !== 'undefined') {
      await db.collection('schools').doc(currentSchoolId).collection('otherServices').doc(String(id)).update({ installments: svc.installments, amountPaid: svc.amountPaid });
      await FirebaseService.addTransaction({ date, type: 'income', category: 'Other Service Fee', desc: `Payment: ${svc.clientName}`, amount, schoolId: currentSchoolId });
    }
    document.getElementById('modal-view-other-service')?.remove();
    viewOtherService(id);
    renderOtherServices();
  } catch(e) { alert('Error: ' + e.message); }
}

function generateServiceInvoice(id) {
  const svc = (data.otherServices||[]).find(s=>s.id===id||s.firebaseId===id);
  if (!svc) return;
  const bal = (svc.totalAmount||0)-(svc.amountPaid||0);
  const invoiceNo = 'SINV-' + (id||'').toString().slice(-6).toUpperCase();
  const today = new Date().toLocaleDateString('en-IN',{year:'numeric',month:'long',day:'numeric'});
  const schoolName = (userSchools.find(sc=>sc.id===currentSchoolId)||{}).name||'DrivePro School';
  const old = document.getElementById('modal-service-invoice');
  if (old) old.remove();
  const modal = document.createElement('div');
  modal.id = 'modal-service-invoice';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
  <div class="modal" style="width:700px;max-width:96vw;max-height:90vh;overflow-y:auto;">
    <div class="modal-header">
      <h3>🧾 Service Invoice</h3>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" onclick="printInvoice()">🖨 Print</button>
        <button class="modal-close" onclick="document.getElementById('modal-service-invoice').remove()">✕</button>
      </div>
    </div>
    <div id="invoice-content" style="background:white;padding:30px;border:1px solid var(--border);border-radius:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;border-bottom:2px solid var(--primary);padding-bottom:20px;">
        <div><div style="font-family:'Syne';font-size:22px;font-weight:700;color:var(--primary);">${schoolName}</div><div style="font-size:12px;color:var(--text2);">Service Invoice</div></div>
        <div style="text-align:right;"><div style="font-family:'Syne';font-size:18px;font-weight:700;color:var(--accent);">INVOICE</div><div style="font-size:12px;color:var(--text2);">${invoiceNo}</div><div style="font-size:12px;color:var(--text2);">${today}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
        <div style="background:var(--surface2);border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:var(--text2);margin-bottom:8px;">BILL TO</div>
          <div style="font-weight:600;font-size:15px;">${svc.clientName}</div>
          <div style="font-size:13px;color:var(--text2);">📞 ${svc.clientPhone}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:4px;">${svc.clientAddress}</div>
        </div>
        <div style="background:var(--surface2);border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:var(--text2);margin-bottom:8px;">SERVICE DETAILS</div>
          <div style="font-size:13px;line-height:1.9;">
            <span style="color:var(--text2);">Type:</span> <strong>${svc.serviceType||'—'}</strong><br>
            <span style="color:var(--text2);">Date:</span> <strong>${svc.date||'—'}</strong><br>
            <span style="color:var(--text2);">Description:</span> <strong>${svc.description||'—'}</strong>
          </div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <thead><tr style="background:var(--primary);color:white;"><th style="padding:10px 14px;text-align:left;">Service</th><th style="padding:10px 14px;text-align:right;">Amount</th></tr></thead>
        <tbody><tr style="border-bottom:1px solid var(--border);">
          <td style="padding:10px 14px;">${svc.serviceType} — ${svc.description||svc.clientName}</td>
          <td style="padding:10px 14px;text-align:right;font-weight:600;">₹${(svc.totalAmount||0).toLocaleString()}</td>
        </tr></tbody>
        <tfoot>
          <tr style="background:#f0fdf4;"><td style="padding:10px 14px;color:var(--success);">Total Paid</td><td style="padding:10px 14px;text-align:right;font-weight:700;color:var(--success);">₹${(svc.amountPaid||0).toLocaleString()}</td></tr>
          <tr style="background:${bal>0?'#fef2f2':'#f0fdf4'};"><td style="padding:10px 14px;font-weight:600;color:${bal>0?'var(--danger)':'var(--success)'};">${bal>0?'Balance Due':'Fully Paid ✓'}</td><td style="padding:10px 14px;text-align:right;font-weight:700;font-size:16px;color:${bal>0?'var(--danger)':'var(--success)'};">₹${Math.abs(bal).toLocaleString()}</td></tr>
        </tfoot>
      </table>
      ${(svc.installments||[]).length>0?`<div style="margin-bottom:16px;"><div style="font-family:'Syne';font-size:14px;font-weight:600;margin-bottom:8px;">Payment History</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:var(--surface2);"><th style="padding:8px 12px;text-align:left;">Date</th><th style="padding:8px 12px;text-align:left;">Amount</th><th style="padding:8px 12px;text-align:left;">Mode</th></tr></thead><tbody>
      ${(svc.installments||[]).map(i=>`<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px 12px;">${i.date}</td><td style="padding:8px 12px;color:var(--success);font-weight:600;">₹${(i.amount||0).toLocaleString()}</td><td style="padding:8px 12px;">${i.mode||'Cash'}</td></tr>`).join('')}
      </tbody></table></div>`:''}
      <div style="border-top:1px solid var(--border);padding-top:14px;text-align:center;font-size:11px;color:var(--text2);">Generated by DrivePro • ${today}</div>
    </div>
  </div>`;
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
  document.body.appendChild(modal);
}

// ============================================================
// STUDENT TRACKING (OWNER VIEW)
// ============================================================
function renderStudentTracking() {
  const page = document.getElementById('page-student-tracking');
  if (!page) return;
  const students = (data.students||[]).filter(s => !currentSchoolId || s.schoolId === currentSchoolId);
  const today = new Date().toISOString().split('T')[0];
  page.innerHTML = `
    <div class="page-header">
      <div><h2>📍 Student Tracking</h2><p>Track attendance, progress, and activity for all students</p></div>
      <div style="display:flex;gap:8px;">
        <select id="tracking-filter" onchange="applyTrackingFilter()" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-family:'DM Sans';font-size:13px;">
          <option value="all">All Students</option>
          <option value="active">Active Only</option>
          <option value="absent-today">Absent Today</option>
          <option value="overdue">Overdue Payment</option>
          <option value="dl-eligible">DL Eligible</option>
        </select>
        <input type="date" id="tracking-date" value="${today}" onchange="renderStudentTrackingTable()" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-family:'DM Sans';font-size:13px;">
      </div>
    </div>
    <div class="stats-grid">
      <div class="stat-card accent"><div class="sc-label">Total Students</div><div class="sc-value" style="color:var(--primary)">${students.length}</div></div>
      <div class="stat-card green"><div class="sc-label">Active</div><div class="sc-value" style="color:var(--success)">${students.filter(s=>s.status==='Active').length}</div></div>
      <div class="stat-card blue"><div class="sc-label">DL Eligible</div><div class="sc-value" style="color:var(--accent2)">${students.filter(s=>(s.classes||0)>=(s.totalClasses||27)).length}</div></div>
      <div class="stat-card red"><div class="sc-label">Pending Payment</div><div class="sc-value" style="color:var(--danger)">${students.filter(s=>(s.totalFee||0)>(s.paid||0)).length}</div></div>
    </div>
    <div class="card" style="padding:0;overflow:hidden;">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);font-family:'Syne';font-size:14px;font-weight:600;">Student Progress Tracker</div>
      <div id="tracking-table-container">
        <table class="data-table">
          <thead><tr><th>Student</th><th>Instructor</th><th>Classes</th><th>Progress</th><th>Fee Status</th><th>Today's Attendance</th><th>Last Active</th><th>Action</th></tr></thead>
          <tbody id="tracking-tbody">${buildTrackingRows(students, today)}</tbody>
        </table>
      </div>
    </div>`;
}

function buildTrackingRows(students, date) {
  if (students.length === 0) return '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text2);">No students found</td></tr>';
  return students.map(s => {
    const totalFee = s.totalFee||0;
    const paid = s.paid||0;
    const bal = totalFee - paid;
    const pct = Math.min(100, Math.round((s.classes||0)/(s.totalClasses||27)*100));
    const dlEligible = (s.classes||0) >= (s.totalClasses||27);
    // Check today's attendance from studentAttendance data
    const todayAtt = (data.studentAttendanceRecords||[]).find(a => a.date===date && (a.studentId===s.firebaseId||a.studentName===s.name));
    const attStatus = todayAtt ? todayAtt.status : 'not-marked';
    const attBadge = attStatus==='present'?'badge-green':attStatus==='late'?'badge-amber':attStatus==='absent'?'badge-red':'badge-gray';
    const attLabel = attStatus==='not-marked'?'Not Marked':attStatus.charAt(0).toUpperCase()+attStatus.slice(1);
    return `<tr>
      <td><div style="font-weight:500;">${s.name}</div><div style="font-size:11px;color:var(--text2);">${s.phone}</div></td>
      <td style="font-size:12px;">${s.instructor||'—'}</td>
      <td style="font-weight:600;">${s.classes||0}/${s.totalClasses||27}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <div class="progress-bar" style="width:80px;height:6px;"><div class="progress-fill" style="width:${pct}%;background:${pct>=100?'var(--success)':'var(--accent2)'}"></div></div>
          <span style="font-size:12px;color:var(--text2);">${pct}%</span>
          ${dlEligible?'<span class="badge badge-green" style="font-size:10px;">DL Ready</span>':''}
        </div>
      </td>
      <td><span class="badge ${bal<=0?'badge-green':'badge-amber'}">${bal<=0?'Paid':'₹'+bal.toLocaleString()+' due'}</span></td>
      <td><span class="badge ${attBadge}">${attLabel}</span></td>
      <td style="font-size:12px;color:var(--text2);">${s.enrolled||'—'}</td>
      <td>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-outline btn-sm" onclick="viewStudent('${s.firebaseId||s.id}')">View</button>
          <button class="btn btn-primary btn-sm" onclick="generateStudentInvoice('${s.firebaseId||s.id}')">🧾</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function applyTrackingFilter() {
  renderStudentTrackingTable();
}

function renderStudentTrackingTable() {
  const filter = document.getElementById('tracking-filter')?.value||'all';
  const date = document.getElementById('tracking-date')?.value || new Date().toISOString().split('T')[0];
  let students = (data.students||[]).filter(s => !currentSchoolId||s.schoolId===currentSchoolId);
  if (filter==='active') students = students.filter(s=>s.status==='Active');
  else if (filter==='overdue') students = students.filter(s=>(s.totalFee||0)>(s.paid||0));
  else if (filter==='dl-eligible') students = students.filter(s=>(s.classes||0)>=(s.totalClasses||27));
  const tbody = document.getElementById('tracking-tbody');
  if (tbody) tbody.innerHTML = buildTrackingRows(students, date);
}

// Load today's student attendance records for tracking
async function loadStudentAttendanceForTracking(date) {
  if (!currentSchoolId || typeof db === 'undefined') return;
  try {
    const snap = await db.collection('schools').doc(currentSchoolId).collection('studentAttendance').where('date','==',date).get();
    data.studentAttendanceRecords = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e) { console.warn('Could not load tracking attendance:', e.message); }
}

// ============================================================
// DAILY INCOME/EXPENSE NOTIFICATION
// ============================================================
function scheduleDailyNotification() {
  const now = new Date();
  // Schedule at 9 PM (21:00) each day
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0);
  if (now >= target) {
    // If already past 9 PM, schedule for next day
    target.setDate(target.getDate() + 1);
  }
  const delay = target.getTime() - now.getTime();
  setTimeout(() => {
    sendDailyIncomeExpenseSummary();
    // Re-schedule for next day
    setInterval(sendDailyIncomeExpenseSummary, 24 * 60 * 60 * 1000);
  }, delay);
}

function sendDailyIncomeExpenseSummary() {
  if (currentRole !== 'owner') return;
  const today = new Date().toISOString().split('T')[0];
  const todayTx = (data.transactions||[]).filter(t => t.date===today && (!currentSchoolId||t.schoolId===currentSchoolId));
  const totalIncome = todayTx.filter(t=>t.type==='income').reduce((a,t)=>a+(t.amount||0),0);
  const totalExpense = todayTx.filter(t=>t.type==='expense').reduce((a,t)=>a+(t.amount||0),0);
  const profit = totalIncome - totalExpense;
  const msg = `📊 Daily Summary (${today}): Income ₹${totalIncome.toLocaleString()} | Expense ₹${totalExpense.toLocaleString()} | Net ${profit>=0?'+':''}₹${profit.toLocaleString()}`;
  addNotification(msg, profit >= 0 ? 'success' : 'warning');
  // Show toast
  showToast(msg.substring(0, 80));
  // Also try browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('DrivePro Daily Summary', {
      body: `Income: ₹${totalIncome.toLocaleString()} | Expense: ₹${totalExpense.toLocaleString()} | Net: ₹${profit.toLocaleString()}`,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">🚗</text></svg>'
    });
  }
}

// Call daily summary on demand (owner can trigger manually)
function showDailySummaryNow() {
  sendDailyIncomeExpenseSummary();
}

// ============================================================
// SCHOOL QUICK-SWITCH FOR OWNER (no re-login)
// ============================================================
function renderSchoolSwitcher() {
  const switcher = document.getElementById('owner-school-switcher');
  if (!switcher || currentRole !== 'owner') return;
  const schools = userSchools || [];
  if (schools.length <= 1) { switcher.style.display = 'none'; return; }
  switcher.style.display = 'flex';
  switcher.innerHTML = `
    <span style="font-size:12px;color:rgba(255,255,255,0.5);margin-right:4px;">🏫</span>
    <select onchange="quickSwitchSchool(this.value)" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:white;padding:5px 8px;border-radius:6px;font-size:12px;cursor:pointer;max-width:160px;">
      ${schools.map(sc => `<option value="${sc.id}" ${sc.id===currentSchoolId?'selected':''}>${sc.name}</option>`).join('')}
    </select>`;
}

async function quickSwitchSchool(schoolId) {
  if (!schoolId || schoolId === currentSchoolId) return;
  const school = (userSchools||[]).find(s=>s.id===schoolId);
  if (!school) return;
  // Switch without re-login
  await selectSchoolForView(schoolId, school.name);
  renderSchoolSwitcher();
}

// ============================================================
// LOAD OTHER SERVICES ON STARTUP
// ============================================================
async function loadOtherServices() {
  if (!currentSchoolId || typeof db === 'undefined') return;
  try {
    const snap = await db.collection('schools').doc(currentSchoolId).collection('otherServices').orderBy('createdAt','desc').get();
    data.otherServices = snap.docs.map(d=>({id:d.id,firebaseId:d.id,...d.data()}));
  } catch(e) { data.otherServices = []; console.warn('Could not load other services:', e.message); }
}

// ============================================================
// INIT PATCHES
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('dash-date').textContent = new Date().toLocaleDateString('en-IN',{weekday:'short',year:'numeric',month:'short',day:'numeric'});
  // Schedule daily notification for owner
  if (currentRole === 'owner') {
    scheduleDailyNotification();
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }
});
