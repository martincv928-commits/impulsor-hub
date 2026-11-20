// Fábrica de conectores por tipo de fuente de datos de la empresa.
import type { ErpConnector } from './erp.ts';
import { FilesConnector, type DatasetLoader } from './files.ts';
import { GenericRestConnector, validateGenericConfig } from './generic.ts';
import { OdooConnector } from './odoo.ts';

export type SourceType = 'odoo' | 'generic_rest' | 'files';
export const SOURCE_TYPES: SourceType[] = ['odoo', 'generic_rest', 'files'];
export interface SourceRow { type: SourceType; config: Record<string, any>; secret: string | null }

export function buildConnector(src: SourceRow, deps: { loadDataset: DatasetLoader; fetcher?: typeof fetch }): ErpConnector {
  if (src.type === 'odoo') return new OdooConnector({ url: src.config.url, db: src.config.db, username: src.config.username, apiKey: src.secret ?? '' }, deps.fetcher);
  if (src.type === 'generic_rest') return new GenericRestConnector(validateGenericConfig(src.config), src.secret ?? '', deps.fetcher);
  if (src.type === 'files') return new FilesConnector(deps.loadDataset);
  throw new Error('Tipo de fuente desconocido');
}
