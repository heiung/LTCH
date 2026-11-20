const user={email:'qa@example.test',uid:'qa-admin',providerData:[{providerId:'google.com'}],getIdToken:async()=> 'qa-firebase'};
const auth={currentUser:null,authStateReady:async()=>{}};export const initializeApp=()=>({});export const getAuth=()=>auth;export const inMemoryPersistence={};export const browserSessionPersistence={};export const browserLocalPersistence={};export const onAuthStateChanged=()=>()=>{};export const setPersistence=async()=>{};export class GoogleAuthProvider{setCustomParameters(){}};export const signInWithPopup=async()=>{auth.currentUser=user;};export const signInWithEmailAndPassword=signInWithPopup;export const createUserWithEmailAndPassword=signInWithPopup;export const signOut=async()=>{auth.currentUser=null;};export const sendPasswordResetEmail=async()=>{};export const reauthenticateWithPopup=async()=>{};export const reauthenticateWithCredential=async()=>{};export const EmailAuthProvider={credential:()=>({})};export const linkWithCredential=async()=>{};export const updatePassword=async()=>{};

export const signInWithRedirect=signInWithPopup; export const getRedirectResult=async()=>null;

// Included only in the loopback UI fixture bundle.
if (typeof location !== 'undefined' && location.origin === 'http://127.0.0.1:5181') {
  const uid = sessionStorage.getItem('ltch.test.roleAuditUid');
  if (/^audit-(admin|teacher|assistant|student|parent)$/.test(uid || '')) {
    auth.currentUser = {...user, uid};
  }
}
