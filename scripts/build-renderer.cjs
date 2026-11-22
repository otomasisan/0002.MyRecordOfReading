// vite build を実行する。esbuild が別プロセスで動くので、そちらにも
// random-fallback.cjs が読み込まれるよう NODE_OPTIONS に追加してから起動する。
'use strict';

const path = require('node:path');

const fallback = path.join(__dirname, 'random-fallback.cjs');
require(fallback);
const option = `--require ${JSON.stringify(fallback)}`;
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, option].filter(Boolean).join(' ');

import('vite')
  .then(({ build }) => build())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
