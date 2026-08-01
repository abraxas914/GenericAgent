;(function(){ if (/streamlit/i.test(document.title)) return;

// Remove meta CSP tags
document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(e => e.remove());

// Indicator badge at bottom-right (userscript style)
(function(){
  if(window.self!==window.top)return;
  const d=document.createElement('div');
  d.id='ljq-ind';
  d.innerText='ljq_driver: 已连接';
  d.style.cssText='position:fixed;bottom:8px;right:8px;background:#4CAF50;color:white;padding:4px 7px;border-radius:4px;font-size:11px;font-weight:bold;z-index:99999;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2);opacity:0.5;';
  d.addEventListener('click',()=>alert('会话活跃\nURL: '+location.href));
  (document.body||document.documentElement).appendChild(d);
})();

})();