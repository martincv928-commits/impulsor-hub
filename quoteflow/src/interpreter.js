/* Contrato QuoteInterpreter.
 *   interpret(text: string, context: { catalog, settings }) => Promise<InterpretResult>
 *   InterpretResult = { quote, recognized[], doubtful[{field,message,id?}], unparsed[], confidence: 'alta'|'media'|'baja', interpreter }
 * Implementación actual: LocalQuoteInterpreter (sin red).
 * Un futuro AIQuoteInterpreter implementaría el mismo contrato y podría usarse
 * solo como fallback cuando confidence === 'baja'. No existe en V0.1. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});
  const P = QF.parser || (typeof require !== 'undefined' ? require('./parser.js') : null);

  class LocalQuoteInterpreter {
    get name() { return 'local'; }
    async interpret(text, context) {
      return Object.assign(P.parse(text, context), { interpreter: this.name });
    }
  }

  QF.LocalQuoteInterpreter = LocalQuoteInterpreter;
  QF.getInterpreter = () => new LocalQuoteInterpreter();
  if (typeof module !== 'undefined') module.exports = { LocalQuoteInterpreter };
})(typeof globalThis !== 'undefined' ? globalThis : this);
