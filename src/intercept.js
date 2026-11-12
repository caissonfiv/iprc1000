'use strict';
const path = require('path');
const { Worker } = require('worker_threads');
const ffi = require('./interception-ffi');
const { createController } = require('./intercept-controller');
module.exports = createController({
  dllExists: ffi.dllExists,
  createWorker: workerData => new Worker(path.join(__dirname, 'intercept-worker.js'), { workerData }),
});
