/** Stores the OpenClaw runtime reference for the Aicoo plugin */

let _runtime: any = null;

export function setAicooRuntime(runtime: any) {
  _runtime = runtime;
}

export function getAicooRuntime() {
  if (!_runtime) {
    throw new Error("Aicoo plugin runtime not initialized");
  }
  return _runtime;
}
