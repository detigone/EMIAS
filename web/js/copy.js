'use strict';
(function(){
  function copyText(text, btn){
    if(!text) return;
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ flash(btn); }).catch(function(){ fallback(text, btn); });
    } else {
      fallback(text, btn);
    }
  }
  function fallback(text, btn){
    var ta=document.createElement('textarea');
    ta.value=text;
    ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand('copy'); flash(btn); }catch(e){}
    document.body.removeChild(ta);
  }
  function flash(btn){
    if(!btn) return;
    var orig=btn.textContent;
    btn.textContent='Скопировано';
    btn.classList.add('copied');
    setTimeout(function(){ btn.textContent=orig; btn.classList.remove('copied'); }, 1500);
  }
  window.EmiasCopy = copyText;
  document.addEventListener('click', function(e){
    var btn=e.target.closest('.copy-btn');
    if(!btn) return;
    var val=btn.getAttribute('data-copy') || btn.dataset.copy;
    if(!val){
      var wrap=btn.closest('.copy-wrap');
      if(wrap) val=wrap.getAttribute('data-copy') || wrap.dataset.copy;
    }
    if(!val && btn.previousElementSibling) val=btn.previousElementSibling.textContent.trim();
    copyText(val, btn);
  });
  // Запрет выделения уже через CSS, дополнительно блокируем Ctrl+C вне инпутов
  document.addEventListener('copy', function(e){
    var t=e.target;
    if(t && (t.tagName==='INPUT' || t.tagName==='TEXTAREA' || t.isContentEditable)) return;
    // Разрешаем только если есть data-copy кнопка рядом — иначе блокируем
    // Но CSS уже запретил выделение, так что просто не мешаем кнопке
  });
})();
