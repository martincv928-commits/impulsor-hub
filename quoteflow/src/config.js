/* Config de Supabase para QuoteFlow V0.3.
 * Mientras estos dos valores estén vacíos, la app funciona exactamente como
 * V0.2: sin cuentas, todo local. En cuanto se llenen, se activan cuentas y
 * negocios en la nube. El "anon key" es público (lo protege RLS en la base
 * de datos, no el secreto): es normal y seguro que viva en este archivo. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});
  QF.config = {
    supabaseUrl: '',
    supabaseAnonKey: '',
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
