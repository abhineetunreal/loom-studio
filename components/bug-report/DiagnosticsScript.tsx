// DiagnosticsScript — an inline script that starts recording client diagnostics
// as early as the page parses, so a later bug report carries the console errors
// and failed requests that led up to it.
//
// Privacy: it records error messages/stacks, and failed request URLs + status
// only — never request/response bodies, headers, cookies, or form values.
// Everything is kept in a small in-memory ring buffer (window.__loomDiag) that
// never leaves the tab until the user chooses to submit a report.

const SNIPPET = `(function(){
  if (window.__loomDiag) return;
  var D = window.__loomDiag = { errors: [], net: [], started: Date.now() };
  function cap(a, x, m){ try { a.push(x); if (a.length > m) a.shift(); } catch(e){} }
  try {
    var oe = console.error.bind(console);
    console.error = function(){
      cap(D.errors, { t: Date.now(), type: 'console.error', msg: Array.prototype.map.call(arguments, String).join(' ').slice(0, 1000) }, 40);
      return oe.apply(null, arguments);
    };
  } catch(e){}
  window.addEventListener('error', function(e){
    cap(D.errors, { t: Date.now(), type: 'error', msg: String((e && e.message) || '').slice(0, 500), src: ((e && e.filename) || '') + ':' + ((e && e.lineno) || 0) + ':' + ((e && e.colno) || 0), stack: (e && e.error && e.error.stack ? String(e.error.stack) : '').slice(0, 2000) }, 40);
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e && e.reason;
    cap(D.errors, { t: Date.now(), type: 'unhandledrejection', msg: (r && r.message ? String(r.message) : String(r)).slice(0, 500), stack: (r && r.stack ? String(r.stack) : '').slice(0, 2000) }, 40);
  });
  try {
    var of = window.fetch;
    if (of) {
      window.fetch = function(){
        var args = arguments, url = '', method = 'GET';
        try { url = (typeof args[0] === 'string') ? args[0] : (args[0] && args[0].url) || ''; } catch(_){}
        try { method = (args[1] && args[1].method) || (args[0] && args[0].method) || 'GET'; } catch(_){}
        var t0 = Date.now();
        return of.apply(this, args).then(function(res){
          try { if (res && !res.ok) cap(D.net, { t: t0, url: String(url).slice(0, 300), method: method, status: res.status }, 25); } catch(_){}
          return res;
        }).catch(function(err){
          try { cap(D.net, { t: t0, url: String(url).slice(0, 300), method: method, status: 0, error: String((err && err.message) || err).slice(0, 300) }, 25); } catch(_){}
          throw err;
        });
      };
    }
  } catch(e){}
})();`;

export default function DiagnosticsScript() {
  // eslint-disable-next-line @next/next/no-danger
  return <script dangerouslySetInnerHTML={{ __html: SNIPPET }} />;
}
