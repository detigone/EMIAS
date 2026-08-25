/* ЕМИАС — API helper (window.API) */
(function () {
  'use strict';

  window.API = {
    /**
     * Wrapper around fetch with credentials and base URL.
     * Returns a standard Response object.
     */
    fetch: function (url, opts) {
      opts = opts || {};
      opts.credentials = opts.credentials || 'same-origin';
      opts.headers = opts.headers || {};
      return window.fetch(url, opts);
    }
  };
})();
