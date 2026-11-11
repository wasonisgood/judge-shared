// 網頁版登入（自行實作，不跳轉到 MCP 的授權頁）：Firebase Auth 的 Google 登入。
// 驗證方式與 judge-remote-mcp 相同：送出的是 Firebase ID Token，雲端以 verifyIdToken 驗證。
// 打包成 dist/app/js/auth.js，並掛到 window.JRAuth。
import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence,
} from 'firebase/auth';
import config from '../firebase-config.json';

const app = initializeApp(config);
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => { /* 無法保存登入狀態時仍可在本次開啟中使用 */ });

const toUser = (u) => (u ? { email: u.email || '', displayName: u.displayName || '' } : null);

window.JRAuth = {
  /** 等待 Firebase 完成啟動時的狀態檢查，回傳目前使用者（未登入為 null）。 */
  waitReady() {
    return new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(toUser(u)); });
    });
  },
  onChange(cb) {
    return onAuthStateChanged(auth, (u) => cb(toUser(u)));
  },
  async getIdToken() {
    // 頁面剛載入時登入狀態尚未初始化，必須先等它完成，否則會拿到空值。
    await auth.authStateReady();
    const u = auth.currentUser;
    // 每次都取新的 ID Token（權杖約一小時到期；強制更新可避免拿到過期的權杖）。
    return u ? u.getIdToken(true) : null;
  },
  signInGoogle() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return signInWithPopup(auth, provider).then((cred) => toUser(cred.user));
  },
  signOut() {
    return signOut(auth);
  },
};
