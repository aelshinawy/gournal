// Plain CommonJS. Use with `node -r`. It fakes an old Node and a Node build without node:sqlite.
if (process.env.FAKE_NODE_VERSION) {
  Object.defineProperty(process.versions, 'node', { value: process.env.FAKE_NODE_VERSION });
}
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'node:sqlite') {
    const err = new Error('No such built-in module: node:sqlite');
    err.code = 'ERR_UNKNOWN_BUILTIN_MODULE';
    throw err;
  }
  return originalLoad.call(this, request, ...rest);
};
