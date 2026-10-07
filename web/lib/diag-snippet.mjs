// A tiny recorder inlined at the top of <head> on the site and in the web app's index.html. It changes nothing
// on the page; it only keeps a list of script errors, console errors, failed resource loads, failed fetches and
// failed font loads in window.__mirrorDiag, so the post-deploy check (scripts/postdeploy-check.mjs) can read
// them in browsers whose automation exposes no console or network events (Safari through safaridriver).
export const DIAG_SNIPPET = `(function(){if(window.__mirrorDiag)return;var d=window.__mirrorDiag={errors:[],failed:[]};
function s(x){try{return String(x&&x.message||x).slice(0,300)}catch(_){return"?"}}
addEventListener("error",function(e){var t=e.target;if(t&&t!==window&&(t.src||t.href)){d.failed.push({url:t.src||t.href,kind:t.tagName})}else{d.errors.push(s(e.error||e.message))}},true);
addEventListener("unhandledrejection",function(e){d.errors.push("unhandledrejection: "+s(e.reason))});
var ce=console.error;console.error=function(){try{d.errors.push(Array.prototype.map.call(arguments,s).join(" "))}catch(_){}return ce.apply(console,arguments)};
if(window.fetch){var f=window.fetch;window.fetch=function(i){var u=typeof i==="string"?i:(i&&i.url)||String(i);return f.apply(this,arguments).then(function(r){if(!r.ok)d.failed.push({url:r.url||u,status:r.status,kind:"fetch"});return r},function(err){d.failed.push({url:u,kind:"fetch",error:s(err)});throw err})}}
if(document.fonts&&document.fonts.addEventListener)document.fonts.addEventListener("loadingerror",function(e){(e.fontfaces||[]).forEach(function(ff){d.failed.push({url:ff.family,kind:"font"})})});})();`;
