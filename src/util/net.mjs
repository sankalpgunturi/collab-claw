// net.mjs — figure out the LAN IP we should advertise as the relay URL.
//
// Picks the first non-internal IPv4 address. Falls back to 127.0.0.1.

import os from 'node:os';

export function lanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const addr of (ifaces[name] || [])) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '127.0.0.1';
}

export function isReachable(host, port, timeoutMs = 1500) {
  return new Promise(resolve => {
    import('node:net').then(({ default: net }) => {
      const sock = new net.Socket();
      let done = false;
      const finish = ok => { if (done) return; done = true; sock.destroy(); resolve(ok); };
      sock.setTimeout(timeoutMs);
      sock.once('connect', () => finish(true));
      sock.once('timeout', () => finish(false));
      sock.once('error', () => finish(false));
      try { sock.connect(port, host); } catch { finish(false); }
    });
  });
}
