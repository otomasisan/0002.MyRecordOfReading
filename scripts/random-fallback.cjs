// Windowsの一部の環境では、Node.jsの crypto.getRandomValues() が
// "entropy source strength too weak" で失敗することがある。
// esbuild（WebAssembly版）は起動時に乱数を使うため、そのままだとビルドが止まる。
// ここで使う乱数は内部のハッシュ用で安全性には関わらないので、失敗したときだけ
// Math.random() で代用する。
'use strict';

const target = globalThis.crypto;
if (target && typeof target.getRandomValues === 'function' && !target.__randomFallback) {
  const original = target.getRandomValues.bind(target);
  Object.defineProperty(target, 'getRandomValues', {
    configurable: true,
    writable: true,
    value(array) {
      try {
        return original(array);
      } catch {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
        return array;
      }
    },
  });
  Object.defineProperty(target, '__randomFallback', { value: true });
}
