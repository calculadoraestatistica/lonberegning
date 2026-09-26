/* Loops explicativos: tocam sozinhos, mas só quando estão na tela e só para
   quem não pediu menos movimento. Sem isso o vídeo baixaria e rodaria mesmo
   no rodapé de uma página que ninguém rolou até o fim. */
(function () {
  "use strict";
  var videos = document.querySelectorAll("video[data-loop]");
  if (!videos.length) return;

  var reduz = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduz) {
    // Fica o poster parado e um botão para quem quiser ver mesmo assim.
    videos.forEach(function (v) {
      v.removeAttribute("autoplay");
      v.setAttribute("controls", "");
      v.pause();
    });
    return;
  }

  if (!("IntersectionObserver" in window)) {
    videos.forEach(function (v) { v.play().catch(function () {}); });
    return;
  }

  var obs = new IntersectionObserver(function (entradas) {
    entradas.forEach(function (e) {
      var v = e.target;
      if (e.isIntersecting) {
        if (v.preload !== "auto") v.preload = "auto";
        v.play().catch(function () { v.setAttribute("controls", ""); });
      } else if (!v.paused) {
        v.pause();
      }
    });
  }, { rootMargin: "120px 0px", threshold: 0.25 });

  videos.forEach(function (v) { obs.observe(v); });
})();
