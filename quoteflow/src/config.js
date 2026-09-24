/* Config de Supabase para QuoteFlow V0.3.
 * Mientras estos dos valores estén vacíos, la app funciona exactamente como
 * V0.2: sin cuentas, todo local. En cuanto se llenen, se activan cuentas y
 * negocios en la nube. El "anon key" es público (lo protege RLS en la base
 * de datos, no el secreto): es normal y seguro que viva en este archivo. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});
  QF.config = {
    supabaseUrl: 'https://rhdsbymoxllfegderalu.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJoZHNieW1veGxsZmVnZGVyYWx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyODEwMTYsImV4cCI6MjEwNTg1NzAxNn0.Y3fIkxHBNJdz0cMLf29-GiSxct2-yF3NvCQoTRweOuU',
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
