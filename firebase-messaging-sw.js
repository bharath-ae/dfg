importScripts('https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.1/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyDTjBL6tbQ1cbX-0Fvn8i6D5cEuf-Tr1w8",
  authDomain: "driving-scoolmanagement.firebaseapp.com",
  projectId: "driving-scoolmanagement",
  storageBucket: "driving-scoolmanagement.firebasestorage.app",
  messagingSenderId: "741852892786",
  appId: "1:741852892786:web:7a419b6efcba83be7d7ceb",
  measurementId: "G-HG1WLCY5W0"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification?.title || 'DrivePro Notification';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.message || 'You have a new message.',
    icon: '/favicon.ico'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
