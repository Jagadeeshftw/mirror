// Prints a fresh VAPID key pair for Web Push as env lines. Put them in the engine's secret env (Railway variables or
// a local .env, which is gitignored); never commit VAPID_PRIVATE_KEY. Rotating the keys invalidates every browser
// subscription: browsers re-subscribe the next time the app opens with alerts on.
//   pnpm gen:vapid
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=https://mirror.0xo.in');
