// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyA7qDhpWxGQKgRGMK7MGjT2MBZF1EAGfLI",
  authDomain: "netlify-a7bd7.firebaseapp.com",
  projectId: "netlify-a7bd7",
  storageBucket: "netlify-a7bd7.firebasestorage.app",
  messagingSenderId: "241532446970",
  appId: "1:241532446970:web:f5698380d476fdd8044143",
  measurementId: "G-CCL8SEG1Q3"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Get Authentication and Firestore instances
const auth = firebase.auth();
const db = firebase.firestore();